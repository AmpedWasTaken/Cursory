import { readFileSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { getContentHashCache } from "../../core/cache/contentCache.js";
import { hashString } from "../../core/cache/hashes.js";
import {
  DELTA_SLICE_KEY,
  FULL_SLICE_KEY,
  getSessionContentCache,
  makeRangeSliceKey,
  makeSymbolSliceKey,
} from "../../core/cache/sessionCache.js";
import { loadConfig, resolveBudget } from "../../core/config/config.js";
import { getFileDiffAgainstHead } from "../../core/git/diff.js";
import { detectGit } from "../../core/git/repository.js";
import { prefersExactTail } from "../../core/indexing/fileClassifier.js";
import {
  extractImportBlock,
  extractSymbols,
  findSymbol,
} from "../../core/indexing/symbols.js";
import { surroundingFromHunks, unifiedLineDiff } from "../../core/output/lineDiff.js";
import {
  level2Excerpts,
  level4Full,
  sliceLines,
  withLineNumbers,
} from "../../core/output/progressiveResult.js";
import { storeRawResult } from "../../core/output/rawStore.js";
import { truncateToBudget } from "../../core/output/tokenBudget.js";
import { analyzeQuery } from "../../core/search/queryAnalysis.js";
import { estimateTokensFromText } from "../../core/telemetry/estimator.js";
import {
  ensureSessionStats,
  recordCacheHit,
  recordCacheMiss,
  recordDuplicateBytesAvoided,
  recordOptimization,
  recordSmartRead,
} from "../../core/telemetry/sessionStats.js";
import { getCapLimits } from "../../hooks/capLimits.js";

export interface SmartReadOptions {
  workspaceRoot: string;
  path: string;
  intent?: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  maxTokens?: number;
  forceFull?: boolean;
}

export interface SmartReadResult {
  text: string;
  path: string;
  hash: string;
  totalLines: number;
  returnedLines: number;
  estimatedRawTokens: number;
  estimatedDeliveredTokens: number;
  selectionReason: string;
  cacheHit: boolean;
  sliceKey: string;
  delta: boolean;
  resultId?: string;
}

const SMALL_FILE_BYTES = getCapLimits("balanced").smallFileBytes;
const SMALL_FILE_LINES = 160;
const FORCE_FULL_HEAD_LINES = getCapLimits("balanced").readLineLimit;

function resolveSafePath(workspaceRoot: string, inputPath: string): string {
  const root = resolve(workspaceRoot);
  const candidate = resolve(root, inputPath);
  const rel = relative(root, candidate);
  if (rel.startsWith("..") || rel === "") {
    throw new Error(`Path escapes workspace: ${inputPath}`);
  }
  return candidate;
}

function toPosixRel(workspaceRoot: string, abs: string): string {
  return relative(workspaceRoot, abs).split(sep).join("/");
}

function selectByIntent(
  content: string,
  intent: string,
  filePath = "file.ts",
): { startLine: number; endLine: number; reason: string } | null {
  const q = analyzeQuery(intent);
  const symbols = extractSymbols(content, filePath);
  for (const hint of q.symbolHints) {
    const found = findSymbol(symbols, hint);
    if (found) {
      return {
        startLine: found.startLine,
        endLine: found.endLine,
        reason: `intent matched symbol ${found.name}`,
      };
    }
  }
  const terms = [...q.textTerms, ...q.symbolHints].map((t) => t.toLowerCase());
  if (terms.length === 0) return null;
  const lines = content.split(/\r?\n/);
  let bestIdx = -1;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i]!.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (lower.includes(t)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  return {
    startLine: Math.max(1, bestIdx - 5),
    endLine: Math.min(lines.length, bestIdx + 40),
    reason: `intent text density around line ${bestIdx + 1}`,
  };
}

function finishDelta(input: {
  rel: string;
  hash: string;
  prevHash: string;
  content: string;
  totalLines: number;
  estimatedRawTokens: number;
  maxTokens: number;
  patchText: string;
  surrounding: string;
  reason: string;
  workspaceRoot: string;
  sessionCache: ReturnType<typeof getSessionContentCache>;
}): SmartReadResult {
  const text = truncateToBudget(
    [
      `[delta] ${input.rel}`,
      `previous_hash=${input.prevHash.slice(0, 12)}…`,
      `current_hash=${input.hash.slice(0, 12)}…`,
      `totalLines=${input.totalLines}`,
      `reason: ${input.reason}`,
      `Expand with cursory_get_raw if this delta is insufficient.`,
      "",
      "--- unified diff (exact lines) ---",
      input.patchText || "(no line-level changes detected)",
      "",
      "--- surrounding exact source ---",
      input.surrounding || "(none)",
    ].join("\n"),
    input.maxTokens,
  );
  const estimatedDeliveredTokens = estimateTokensFromText(text).tokens;
  input.sessionCache.markDelivered({
    workspaceRoot: input.workspaceRoot,
    path: input.rel,
    contentHash: input.hash,
    sliceKey: DELTA_SLICE_KEY,
    estimatedTokens: estimatedDeliveredTokens,
    content: input.content,
  });
  recordOptimization({
    category: "diff",
    estimatedRawTokens: input.estimatedRawTokens,
    estimatedDeliveredTokens,
    rawBytes: Buffer.byteLength(input.content, "utf8"),
    deliveredBytes: Buffer.byteLength(text, "utf8"),
  });
  return {
    text,
    path: input.rel,
    hash: input.hash,
    totalLines: input.totalLines,
    returnedLines: input.patchText.split(/\r?\n/).length,
    estimatedRawTokens: input.estimatedRawTokens,
    estimatedDeliveredTokens,
    selectionReason: input.reason,
    cacheHit: false,
    sliceKey: DELTA_SLICE_KEY,
    delta: true,
  };
}

export function buildSmartRead(options: SmartReadOptions): SmartReadResult {
  const config = loadConfig(options.workspaceRoot);
  const maxTokens = resolveBudget(config, "read", options.maxTokens);
  ensureSessionStats(options.workspaceRoot);
  recordSmartRead();

  const abs = resolveSafePath(options.workspaceRoot, options.path);
  const rel = toPosixRel(options.workspaceRoot, abs);
  const st = statSync(abs);
  const content = readFileSync(abs, "utf8");
  const hashCache = getContentHashCache();
  let hash = hashCache.get(abs, st.size, st.mtimeMs);
  if (!hash) {
    hash = hashString(content);
    hashCache.set(abs, hash, st.size, st.mtimeMs);
  }

  const lines = content.split(/\r?\n/);
  const totalLines = lines.length;
  const estimatedRawTokens = estimateTokensFromText(content).tokens;
  const sessionCache = getSessionContentCache();

  let startLine = 1;
  let endLine = totalLines;
  let selectionReason = "full file";
  let sliceKey = FULL_SLICE_KEY;
  let forceFull = options.forceFull === true;

  // Delta context: content changed since last delivery this session
  if (
    !forceFull &&
    options.symbol == null &&
    options.startLine == null &&
    options.endLine == null
  ) {
    const stale = sessionCache.getStaleSnapshot(options.workspaceRoot, rel, hash);
    if (stale) {
      const { hunks, text: patchText } = unifiedLineDiff(stale.content, content, 3);
      const surrounding = surroundingFromHunks(content, hunks, 3);
      return finishDelta({
        rel,
        hash,
        prevHash: stale.contentHash,
        content,
        totalLines,
        estimatedRawTokens,
        maxTokens,
        patchText,
        surrounding,
        reason: "content hash changed since last delivery — delta only",
        workspaceRoot: options.workspaceRoot,
        sessionCache,
      });
    }
  }

  if (!forceFull && options.startLine != null && options.endLine != null) {
    startLine = options.startLine;
    endLine = options.endLine;
    selectionReason = `explicit range L${startLine}-${endLine}`;
    sliceKey = makeRangeSliceKey(startLine, endLine);
  } else if (!forceFull && options.symbol) {
    const symbols = extractSymbols(content, rel);
    const found = findSymbol(symbols, options.symbol);
    if (found) {
      startLine = Math.max(1, found.startLine - 2);
      endLine = Math.min(totalLines, found.endLine + 2);
      selectionReason = `symbol ${found.kind} ${found.name}`;
      sliceKey = makeSymbolSliceKey(found.name);
    } else {
      selectionReason = `symbol ${options.symbol} not found; falling back to intent/small-file heuristics`;
    }
  }

  if (!forceFull && options.intent && sliceKey === FULL_SLICE_KEY) {
    const sel = selectByIntent(content, options.intent, rel);
    if (sel) {
      startLine = sel.startLine;
      endLine = sel.endLine;
      selectionReason = sel.reason;
      sliceKey = makeRangeSliceKey(startLine, endLine);
    }
  }

  // Prefer Git working-tree diff hunks for changed files without explicit selection
  if (!forceFull && sliceKey === FULL_SLICE_KEY) {
    const git = detectGit(options.workspaceRoot);
    if (git.changedFiles.includes(rel) && (st.size > SMALL_FILE_BYTES || totalLines > SMALL_FILE_LINES)) {
      const patch = getFileDiffAgainstHead(options.workspaceRoot, rel);
      if (patch.trim()) {
        const surrounding = patch
          .split(/\r?\n/)
          .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
          .slice(0, 80)
          .map((l) => l.slice(1))
          .join("\n");
        return finishDelta({
          rel,
          hash,
          prevHash: "git:HEAD",
          content,
          totalLines,
          estimatedRawTokens,
          maxTokens,
          patchText: patch.trim(),
          surrounding: surrounding ? withLineNumbers(surrounding, 1) : "(see patch hunks)",
          reason: "git working-tree changes vs HEAD — delta patch",
          workspaceRoot: options.workspaceRoot,
          sessionCache,
        });
      }
      if (prefersExactTail(rel)) {
        startLine = Math.max(1, totalLines - 119);
        endLine = totalLines;
        selectionReason =
          "changed log: returning trailing section (use range or get_raw for more)";
      } else {
        startLine = 1;
        endLine = Math.min(totalLines, 120);
        selectionReason =
          "changed file: returning leading section (use symbol/range or get_raw for more)";
      }
      sliceKey = makeRangeSliceKey(startLine, endLine);
    } else if (st.size <= SMALL_FILE_BYTES && totalLines <= SMALL_FILE_LINES) {
      forceFull = true;
      selectionReason = "small file — returning full content";
      sliceKey = FULL_SLICE_KEY;
      startLine = 1;
      endLine = totalLines;
    } else if (prefersExactTail(rel)) {
      startLine = Math.max(1, totalLines - 159);
      endLine = totalLines;
      selectionReason =
        "large log without symbol/intent — returning tail (pass range or get_raw)";
      sliceKey = makeRangeSliceKey(startLine, endLine);
    } else {
      startLine = 1;
      endLine = Math.min(totalLines, 160);
      selectionReason =
        "large file without symbol/intent — returning head (pass symbol, intent, range, or get_raw)";
      sliceKey = makeRangeSliceKey(startLine, endLine);
    }
  }

  const largeFile = st.size > SMALL_FILE_BYTES || totalLines > SMALL_FILE_LINES;
  if (forceFull && largeFile) {
    if (prefersExactTail(rel)) {
      startLine = Math.max(1, totalLines - FORCE_FULL_HEAD_LINES + 1);
      endLine = totalLines;
      selectionReason =
        "force_full on large log — tail only; expand with cursory_get_raw";
    } else {
      startLine = 1;
      endLine = Math.min(totalLines, FORCE_FULL_HEAD_LINES);
      selectionReason =
        "force_full on large file — head only; expand with cursory_get_raw";
    }
    sliceKey = makeRangeSliceKey(startLine, endLine);
  } else if (forceFull) {
    startLine = 1;
    endLine = totalLines;
    sliceKey = FULL_SLICE_KEY;
    if (!selectionReason.includes("small file")) {
      selectionReason = "force_full";
    }
  }

  const cacheHit = sessionCache.has({
    workspaceRoot: options.workspaceRoot,
    path: rel,
    contentHash: hash,
    sliceKey,
  });

  if (cacheHit && !options.forceFull) {
    recordCacheHit();
    const sliced = sliceLines(content, startLine, endLine);
    const text = [
      `[cursory:duplicate] ${rel} ${sliceKey}`,
      `unchanged hash=${hash.slice(0, 12)}; source not resent`,
    ].join("\n");
    const delivered = truncateToBudget(text, maxTokens);
    const estimatedDeliveredTokens = estimateTokensFromText(delivered).tokens;
    recordDuplicateBytesAvoided(
      Math.max(0, Buffer.byteLength(sliced.text, "utf8") - Buffer.byteLength(delivered, "utf8")),
    );
    recordOptimization({
      category: "duplicate",
      estimatedRawTokens: estimateTokensFromText(sliced.text).tokens,
      estimatedDeliveredTokens,
      rawBytes: Buffer.byteLength(sliced.text, "utf8"),
      deliveredBytes: Buffer.byteLength(delivered, "utf8"),
    });
    return {
      text: delivered,
      path: rel,
      hash,
      totalLines,
      returnedLines: 0,
      estimatedRawTokens,
      estimatedDeliveredTokens,
      selectionReason: `${selectionReason} (session cache hit)`,
      cacheHit: true,
      sliceKey,
      delta: false,
    };
  }

  recordCacheMiss();

  const sliced = sliceLines(content, startLine, endLine);
  const imports =
    options.symbol || options.intent
      ? extractImportBlock(content)
      : { startLine: 1, endLine: 0, text: "" };

  const parts: string[] = [];
  parts.push(`path: ${rel}`);
  parts.push(`hash: ${hash}`);
  parts.push(`totalLines: ${totalLines}`);
  parts.push(`returned: L${sliced.startLine}-${sliced.endLine}`);
  parts.push(`reason: ${selectionReason}`);
  const meta =
    sliceKey === FULL_SLICE_KEY
      ? level4Full(selectionReason)
      : level2Excerpts(selectionReason);
  parts.push(`disclosure: level ${meta.level} — ${meta.expandHint}`);
  parts.push("");

  if (imports.endLine > 0 && sliced.startLine > imports.endLine) {
    parts.push("// --- imports (context) ---");
    parts.push(withLineNumbers(imports.text, imports.startLine));
    parts.push("// --- selected range ---");
  }

  parts.push(withLineNumbers(sliced.text, sliced.startLine));

  let body = truncateToBudget(parts.join("\n"), maxTokens);
  if (!largeFile && estimateTokensFromText(body).tokens > estimatedRawTokens) {
    body = content;
  }
  let resultId: string | undefined;
  if (largeFile && endLine - startLine + 1 < totalLines) {
    const meta = storeRawResult({
      command: `smart_read ${rel}`,
      cwd: options.workspaceRoot,
      exitCode: 0,
      timedOut: false,
      mode: "read",
      stdout: content,
      stderr: "",
      retainRawMinutes: config.terminal.retainRawMinutes,
    });
    resultId = meta.resultId;
    body = [
      body,
      "",
      `raw_result_id: ${meta.resultId}`,
      `Expand with: cursory_get_raw({ result_id: "${meta.resultId}" })`,
      `Raw retained until ${meta.expiresAt} (local temp; not uploaded).`,
    ].join("\n");
    body = truncateToBudget(body, maxTokens);
  }
  const estimatedDeliveredTokens = estimateTokensFromText(body).tokens;

  sessionCache.markDelivered({
    workspaceRoot: options.workspaceRoot,
    path: rel,
    contentHash: hash,
    sliceKey,
    estimatedTokens: estimatedDeliveredTokens,
    content,
  });

  recordOptimization({
    category: "read",
    estimatedRawTokens,
    estimatedDeliveredTokens,
    rawBytes: Buffer.byteLength(content, "utf8"),
    deliveredBytes: Buffer.byteLength(body, "utf8"),
  });

  return {
    text: body,
    path: rel,
    hash,
    totalLines,
    returnedLines: endLine - startLine + 1,
    estimatedRawTokens,
    estimatedDeliveredTokens,
    selectionReason,
    cacheHit: false,
    sliceKey,
    delta: false,
    resultId,
  };
}
