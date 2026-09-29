import { loadConfig, resolveBudget } from "../../core/config/config.js";
import { detectGit } from "../../core/git/repository.js";
import { createIgnoreEngine } from "../../core/indexing/ignore.js";
import { scanWorkspace, type WorkspaceScanResult } from "../../core/indexing/workspaceIndex.js";
import { truncateToBudget } from "../../core/output/tokenBudget.js";
import { estimateTokensFromText } from "../../core/telemetry/estimator.js";
import { ensureSessionStats, recordOptimization } from "../../core/telemetry/sessionStats.js";

export interface WorkspaceMapOptions {
  workspaceRoot: string;
  maxTokens?: number;
}

export interface WorkspaceMapResult {
  text: string;
  estimatedRawTokens: number;
  estimatedDeliveredTokens: number;
  scan: {
    indexedCount: number;
    omittedFromWalk: number;
    languages: Record<string, number>;
    frameworks: string[];
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function languagePercents(counts: Record<string, number>): string[] {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (total === 0) return ["(none detected)"];
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([lang, n]) => `${lang} ${Math.round((n / total) * 100)}%`);
}

function buildMapText(scan: WorkspaceScanResult, git: ReturnType<typeof detectGit>): string {
  const lines: string[] = [];
  lines.push(`Workspace: ${scan.name}`);
  lines.push(`Root: ${scan.root}`);
  lines.push(`Git: ${git.isRepo ? "yes" : "no"}`);
  if (git.isRepo) {
    lines.push(`Branch: ${git.branch ?? "(unknown)"}`);
  }
  lines.push("");
  lines.push("Languages:");
  for (const row of languagePercents(scan.languageCounts)) {
    lines.push(`  ${row}`);
  }
  lines.push("");
  lines.push("Frameworks:");
  if (scan.frameworks.length === 0) {
    lines.push("  (none detected from manifests)");
  } else {
    for (const fw of scan.frameworks) {
      lines.push(`  ${fw}`);
    }
  }
  lines.push("");
  lines.push("Manifests:");
  if (scan.manifests.length === 0) {
    lines.push("  (none)");
  } else {
    for (const m of scan.manifests.slice(0, 12)) {
      lines.push(`  ${m}`);
    }
  }
  lines.push("");
  lines.push("Important:");
  if (scan.importantDirs.length === 0) {
    lines.push("  (none ranked)");
  } else {
    for (const d of scan.importantDirs) {
      lines.push(`  ${d}`);
    }
  }
  lines.push("");
  lines.push("Entry points:");
  if (scan.entryPoints.length === 0) {
    lines.push("  (none detected)");
  } else {
    for (const e of scan.entryPoints) {
      lines.push(`  ${e}`);
    }
  }
  lines.push("");
  lines.push("Changed:");
  if (!git.isRepo || git.changedFiles.length === 0) {
    lines.push("  (none)");
  } else {
    for (const f of git.changedFiles.slice(0, 20)) {
      lines.push(`  ${f}`);
    }
    if (git.changedFiles.length > 20) {
      lines.push(`  … +${git.changedFiles.length - 20} more`);
    }
  }
  lines.push("");
  lines.push("Large files (indexed):");
  if (scan.largeFiles.length === 0) {
    lines.push("  (none)");
  } else {
    for (const f of scan.largeFiles) {
      lines.push(`  ${f.relativePath}  ${formatBytes(f.sizeBytes)}`);
    }
  }
  lines.push("");
  lines.push("Large ignored/generated:");
  if (scan.largeIgnoredDirs.length === 0) {
    lines.push("  (none at workspace root)");
  } else {
    for (const d of scan.largeIgnoredDirs) {
      lines.push(`  ${d.relativePath} ${formatBytes(d.sizeBytes)}`);
    }
  }
  lines.push("");
  lines.push(`Files indexed: ${scan.indexedCount}`);
  lines.push(`Files/dirs omitted from walk: ${scan.omittedFromWalk}`);
  lines.push(`Approx source size: ${formatBytes(scan.approximateSourceBytes)}`);
  lines.push("");
  lines.push("Ignore sources:");
  lines.push(
    `  gitignore patterns: ${scan.ignoreSources.gitignorePatterns}, cursorignore: ${scan.ignoreSources.cursorignorePatterns}, config extra: ${scan.ignoreSources.configExtra.length}`,
  );
  lines.push("");
  lines.push("Note: This is a compact map — not a full file tree dump.");
  return lines.join("\n");
}

function observedPathListing(scan: WorkspaceScanResult): string {
  // Baseline is derived only from paths actually observed by the scan. Do not
  // invent savings from estimated contents of ignored directories.
  return scan.files.map((f) => f.relativePath).join("\n");
}

/**
 * Build a compact workspace map without dumping thousands of paths.
 */
export function buildWorkspaceMap(options: WorkspaceMapOptions): WorkspaceMapResult {
  const config = loadConfig(options.workspaceRoot);
  const maxTokens = resolveBudget(
    config,
    "workspaceMap",
    options.maxTokens,
  );

  ensureSessionStats(options.workspaceRoot);
  const ignore = createIgnoreEngine(options.workspaceRoot, {
    extraPatterns: config.ignore.extra,
  });
  const scan = scanWorkspace(options.workspaceRoot, { ignore });
  const git = detectGit(options.workspaceRoot);
  const fullText = buildMapText(scan, git);

  const baselineText = observedPathListing(scan);
  const estimatedRawTokens = estimateTokensFromText(baselineText).tokens;
  const reducedText = truncateToBudget(fullText, maxTokens);
  const deliveredText =
    estimateTokensFromText(reducedText).tokens <= estimatedRawTokens
      ? reducedText
      : baselineText;
  const estimatedDeliveredTokens = estimateTokensFromText(deliveredText).tokens;

  recordOptimization({
    category: "workspace",
    estimatedRawTokens,
    estimatedDeliveredTokens,
    rawBytes: estimatedRawTokens * 4,
    deliveredBytes: Buffer.byteLength(deliveredText, "utf8"),
  });

  return {
    text: deliveredText,
    estimatedRawTokens,
    estimatedDeliveredTokens,
    scan: {
      indexedCount: scan.indexedCount,
      omittedFromWalk: scan.omittedFromWalk,
      languages: scan.languageCounts,
      frameworks: scan.frameworks,
    },
  };
}
