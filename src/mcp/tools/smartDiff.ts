import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, resolveBudget } from "../../core/config/config.js";
import { getGitDiff } from "../../core/git/diff.js";
import { reduceDiff } from "../../core/output/diffReducer.js";
import { storeRawResult } from "../../core/output/rawStore.js";
import {
  ensureSessionStats,
  recordOptimization,
} from "../../core/telemetry/sessionStats.js";
import { estimateTokensFromText } from "../../core/telemetry/estimator.js";

export interface SmartDiffOptions {
  workspaceRoot: string;
  base?: string;
  target?: string;
  path?: string;
  maxTokens?: number;
}

export interface SmartDiffResult {
  text: string;
  resultId: string | null;
  estimatedRawTokens: number;
  estimatedDeliveredTokens: number;
  filesChanged: number;
  additions: number;
  deletions: number;
}

export function buildSmartDiff(options: SmartDiffOptions): SmartDiffResult {
  const config = loadConfig(options.workspaceRoot);
  const maxTokens = resolveBudget(config, "diff", options.maxTokens);
  ensureSessionStats(options.workspaceRoot);

  const diff = getGitDiff({
    workspaceRoot: options.workspaceRoot,
    base: options.base,
    target: options.target,
    path: options.path,
  });

  if (!diff.ok) {
    return {
      text: `Git diff unavailable: ${diff.error ?? "unknown error"}\nIs this a Git repository?`,
      resultId: null,
      estimatedRawTokens: 0,
      estimatedDeliveredTokens: 40,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
    };
  }

  const fileContents = new Map<string, string>();
  for (const f of diff.files.slice(0, 20)) {
    const abs = join(options.workspaceRoot, f.path);
    if (existsSync(abs)) {
      try {
        const content = readFileSync(abs, "utf8");
        if (content.length < 400_000) fileContents.set(f.path, content);
      } catch {
        // skip
      }
    }
  }

  const reduced = reduceDiff({
    patch: diff.patch,
    files: diff.files,
    additions: diff.additions,
    deletions: diff.deletions,
    base: diff.base,
    target: diff.target,
    maxTokens,
    fileContents,
  });

  const meta = storeRawResult({
    command: `git diff ${diff.base} ${diff.target === "WORKTREE" ? "" : diff.target}`.trim(),
    cwd: options.workspaceRoot,
    exitCode: 0,
    timedOut: false,
    mode: "diff",
    stdout: diff.patch,
    stderr: "",
    retainRawMinutes: config.terminal.retainRawMinutes,
  });

  const reducedText = [
    reduced.text,
    "",
    `raw_result_id: ${meta.resultId}`,
    `Expand full patch: cursory_get_raw({ result_id: "${meta.resultId}" })`,
  ].join("\n");
  const text =
    estimateTokensFromText(reducedText).tokens <= reduced.estimatedRawTokens
      ? reducedText
      : diff.patch;
  const estimatedDeliveredTokens = estimateTokensFromText(text).tokens;

  recordOptimization({
    category: "diff",
    estimatedRawTokens: reduced.estimatedRawTokens,
    estimatedDeliveredTokens,
    rawBytes: Buffer.byteLength(diff.patch, "utf8"),
    deliveredBytes: Buffer.byteLength(text, "utf8"),
  });

  return {
    text,
    resultId: meta.resultId,
    estimatedRawTokens: reduced.estimatedRawTokens,
    estimatedDeliveredTokens,
    filesChanged: diff.files.length,
    additions: diff.additions,
    deletions: diff.deletions,
  };
}
