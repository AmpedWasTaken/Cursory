import { join } from "node:path";
import { loadConfig, resolveBudget } from "../../core/config/config.js";
import { detectGit } from "../../core/git/repository.js";
import { getRecentFiles } from "../../core/git/recency.js";
import { createIgnoreEngine } from "../../core/indexing/ignore.js";
import {
  extractImportBlock,
  extractSymbols,
} from "../../core/indexing/symbols.js";
import { scanWorkspace } from "../../core/indexing/workspaceIndex.js";
import { truncateToBudget } from "../../core/output/tokenBudget.js";
import { filenameMatches, grepFiles, pathKeywordScore } from "../../core/search/grep.js";
import { analyzeQuery } from "../../core/search/queryAnalysis.js";
import { normalizeScores, scoreCandidate } from "../../core/search/ranking.js";
import { estimateTokensFromText } from "../../core/telemetry/estimator.js";
import {
  ensureSessionStats,
  recordOptimization,
  recordSmartSearch,
} from "../../core/telemetry/sessionStats.js";
import { readFileSync } from "node:fs";

export interface SmartSearchOptions {
  workspaceRoot: string;
  query: string;
  maxResults?: number;
  maxTokens?: number;
  includeGenerated?: boolean;
}

export interface SmartSearchHit {
  path: string;
  score: number;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  excerpt: string;
  reasons: string[];
}

export interface SmartSearchResult {
  text: string;
  hits: SmartSearchHit[];
  estimatedRawTokens: number;
  estimatedDeliveredTokens: number;
}

export function buildSmartSearch(options: SmartSearchOptions): SmartSearchResult {
  const config = loadConfig(options.workspaceRoot);
  const maxResults = options.maxResults ?? 8;
  const maxTokens = resolveBudget(config, "search", options.maxTokens);
  ensureSessionStats(options.workspaceRoot);
  recordSmartSearch();

  const query = analyzeQuery(options.query);
  const ignore = createIgnoreEngine(options.workspaceRoot, {
    extraPatterns: options.includeGenerated ? [] : config.ignore.extra,
  });
  // If includeGenerated, still use defaults for node_modules safety unless explicitly asked —
  // product says never assume ignored is irrelevant if user explicitly asks. includeGenerated
  // only relaxes Cursory config extras for now; defaults still protect node_modules.
  const scan = scanWorkspace(options.workspaceRoot, {
    ignore: options.includeGenerated
      ? createIgnoreEngine(options.workspaceRoot, { extraPatterns: [] })
      : ignore,
    maxFiles: 8_000,
  });

  const git = detectGit(options.workspaceRoot);
  const changed = new Set(git.changedFiles);
  const recent = new Set(getRecentFiles(options.workspaceRoot, 40));

  const files = scan.files
    .filter((f) => f.kind === "source" || f.kind === "test" || f.kind === "config" || f.kind === "manifest")
    .map((f) => ({
      absolutePath: join(options.workspaceRoot, f.relativePath),
      relativePath: f.relativePath,
    }));

  const grepHits = grepFiles({
    files,
    query,
    maxHits: 300,
  });

  // Aggregate by path
  const byPath = new Map<
    string,
    { matchLines: number; matchWeight: number; bestLine: number; snippets: string[] }
  >();

  for (const hit of grepHits) {
    const cur = byPath.get(hit.path) ?? {
      matchLines: 0,
      matchWeight: 0,
      bestLine: hit.line,
      snippets: [] as string[],
    };
    cur.matchLines += 1;
    cur.matchWeight += hit.matchCount;
    if (hit.matchCount >= (byPath.get(hit.path)?.matchWeight ?? 0)) {
      cur.bestLine = hit.line;
    }
    if (cur.snippets.length < 3) {
      cur.snippets.push(`L${hit.line}: ${hit.text}`);
    }
    byPath.set(hit.path, cur);
  }

  // Also consider filename-only matches with no text hits
  for (const f of files) {
    if (filenameMatches(f.relativePath, query) && !byPath.has(f.relativePath)) {
      byPath.set(f.relativePath, {
        matchLines: 0,
        matchWeight: 0,
        bestLine: 1,
        snippets: ["(filename match)"],
      });
    }
  }

  const ranked: SmartSearchHit[] = [];

  for (const [path, agg] of byPath) {
    let symbol: string | undefined;
    let startLine: number | undefined;
    let endLine: number | undefined;
    let exactSymbol = false;
    let importRelationship = false;

    try {
      const content = readFileSync(join(options.workspaceRoot, path), "utf8");
      const symbols = extractSymbols(content, path);
      const imports = extractImportBlock(content).text.toLowerCase();
      importRelationship = [
        ...query.textTerms,
        ...query.symbolHints,
      ].some((term) => imports.includes(term.toLowerCase()));
      for (const hint of query.symbolHints) {
        const found = symbols.find((s) => s.name === hint || s.name.toLowerCase() === hint.toLowerCase());
        if (found) {
          exactSymbol = true;
          symbol = `${found.name}()`;
          startLine = found.startLine;
          endLine = found.endLine;
          break;
        }
      }
    } catch {
      // ignore read errors
    }

    if (startLine === undefined) {
      startLine = Math.max(1, agg.bestLine - 2);
      endLine = agg.bestLine + 8;
    }

    const density = Math.min(1, agg.matchWeight / 8);
    const scored = scoreCandidate({
      exactSymbol,
      exactFilename: filenameMatches(path, query),
      changedFile: changed.has(path),
      gitRecent: recent.has(path),
      pathKeywordScore: pathKeywordScore(path, query),
      textDensityScore: density,
      importRelationship,
    });

    const reasons: string[] = [];
    for (const [k, v] of Object.entries(scored.breakdown)) {
      if (v && v > 0) reasons.push(`${k}=${v.toFixed(2)}`);
    }

    ranked.push({
      path,
      score: scored.score,
      symbol,
      startLine,
      endLine,
      excerpt: agg.snippets.join("\n"),
      reasons,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  const top = normalizeScores(ranked.slice(0, maxResults));

  const lines: string[] = [];
  lines.push(`Query: ${options.query}`);
  lines.push(`Results: ${top.length} (of ${ranked.length} candidates)`);
  lines.push("");

  top.forEach((hit, idx) => {
    lines.push(`${idx + 1}. ${hit.path}`);
    if (hit.symbol) lines.push(`   ${hit.symbol}`);
    if (hit.startLine && hit.endLine) lines.push(`   lines ${hit.startLine}-${hit.endLine}`);
    lines.push(`   score ${hit.score.toFixed(3)}`);
    if (hit.reasons.length) lines.push(`   signals: ${hit.reasons.join(", ")}`);
    lines.push("");
    for (const ex of hit.excerpt.split("\n")) {
      lines.push(`   ${ex}`);
    }
    lines.push("");
  });

  if (top.length === 0) {
    lines.push("No matches. Try a more specific symbol/path, or set include_generated if needed.");
  }

  lines.push("Tip: use cursory_smart_read on a hit path with symbol/intent for exact excerpts.");

  const fullText = lines.join("\n");
  // Raw baseline: dump all grep hit lines + full files would be huge; use hit volume * avg
  const rawProxy = grepHits.map((h) => `${h.path}:${h.line}:${h.text}`).join("\n");
  const estimatedRawTokens = Math.max(
    estimateTokensFromText(rawProxy).tokens,
    estimateTokensFromText(fullText).tokens,
  );
  const deliveredText = truncateToBudget(fullText, maxTokens);
  const estimatedDeliveredTokens = estimateTokensFromText(deliveredText).tokens;

  recordOptimization({
    category: "search",
    estimatedRawTokens,
    estimatedDeliveredTokens,
    rawBytes: Buffer.byteLength(rawProxy, "utf8"),
    deliveredBytes: Buffer.byteLength(deliveredText, "utf8"),
  });

  return {
    text: deliveredText,
    hits: top,
    estimatedRawTokens,
    estimatedDeliveredTokens,
  };
}
