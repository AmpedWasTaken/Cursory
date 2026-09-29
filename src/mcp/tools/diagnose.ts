import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { loadConfig } from "../../core/config/config.js";
import { DEFAULT_IGNORE_DIRS } from "../../core/config/defaults.js";
import { createIgnoreEngine } from "../../core/indexing/ignore.js";
import { scanWorkspace } from "../../core/indexing/workspaceIndex.js";
import { ensureSessionStats } from "../../core/telemetry/sessionStats.js";

export interface DiagnoseOptions {
  workspaceRoot: string;
}

export interface DiagnoseFinding {
  severity: "high" | "medium" | "low";
  kind: string;
  path: string;
  detail: string;
  suggestIgnore?: string;
}

export interface DiagnoseResult {
  text: string;
  findings: DiagnoseFinding[];
  recommendedIgnores: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

function approxDirSize(dirPath: string, maxEntries = 4_000): number {
  let total = 0;
  let seen = 0;
  const stack = [dirPath];
  while (stack.length > 0 && seen < maxEntries) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries) break;
      const full = join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try {
          total += statSync(full).size;
        } catch {
          // skip
        }
      }
    }
  }
  return total;
}

function loadIgnoreLines(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

const WASTE_NAME_HINTS = [
  { re: /\.map$/i, kind: "source-map", suggest: "*.map" },
  { re: /\.min\.(js|css)$/i, kind: "minified", suggest: "*.min.js\n*.min.css" },
  { re: /\.log$/i, kind: "log", suggest: "*.log" },
  {
    re: /\.(hprof|heapdump|heapsnapshot)$/i,
    kind: "heap-dump",
    suggest: "*.hprof\n*.heapsnapshot",
  },
  { re: /\.(sql|dump)$/i, kind: "db-dump", suggest: "*.dump" },
  { re: /coverage/i, kind: "coverage", suggest: "coverage/" },
  { re: /\.next/i, kind: "next-build", suggest: ".next/" },
  { re: /node_modules/i, kind: "dependencies", suggest: "node_modules/" },
  { re: /dist|build|out\b/i, kind: "build-output", suggest: "dist/\nbuild/" },
  { re: /vendor/i, kind: "vendored", suggest: "vendor/" },
  { re: /\.cache/i, kind: "cache", suggest: ".cache/" },
];

/**
 * Analyze workspace for likely context waste. Never modifies .cursorignore.
 */
export function buildDiagnose(options: DiagnoseOptions): DiagnoseResult {
  const config = loadConfig(options.workspaceRoot);
  ensureSessionStats(options.workspaceRoot);

  const findings: DiagnoseFinding[] = [];
  const recommended = new Set<string>();

  const cursorignorePath = join(options.workspaceRoot, ".cursorignore");
  const gitignorePath = join(options.workspaceRoot, ".gitignore");
  const existing = new Set([
    ...loadIgnoreLines(cursorignorePath),
    ...loadIgnoreLines(gitignorePath),
    ...config.ignore.extra,
  ]);

  const hasCursorignore = existsSync(cursorignorePath);

  // Root-level generated/low-value dirs
  for (const name of DEFAULT_IGNORE_DIRS) {
    const full = join(options.workspaceRoot, name);
    if (!existsSync(full)) continue;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const size = approxDirSize(full);
    const suggest = name.endsWith("/") ? name : `${name}/`;
    const covered =
      existing.has(suggest) ||
      existing.has(name) ||
      existing.has(`/${suggest}`) ||
      [...existing].some((e) => e.replace(/^\//, "") === suggest || e.includes(name));

    findings.push({
      severity: size > 50 * 1024 * 1024 ? "high" : size > 5 * 1024 * 1024 ? "medium" : "low",
      kind: "generated-or-vendor-dir",
      path: `${name}/`,
      detail: `Present at workspace root (~${formatBytes(size)} sampled).`,
      suggestIgnore: covered ? undefined : suggest,
    });
    if (!covered) recommended.add(suggest);
  }

  // Scan indexed files for wasteful types that slipped through
  const ignore = createIgnoreEngine(options.workspaceRoot, {
    extraPatterns: config.ignore.extra,
  });
  const scan = scanWorkspace(options.workspaceRoot, { ignore, maxFiles: 12_000 });

  for (const file of scan.files) {
    const base = basename(file.relativePath);
    for (const hint of WASTE_NAME_HINTS) {
      if (!hint.re.test(file.relativePath) && !hint.re.test(base)) continue;
      if (file.sizeBytes < 100_000 && hint.kind !== "heap-dump") continue;
      findings.push({
        severity: file.sizeBytes > 2_000_000 ? "high" : "medium",
        kind: hint.kind,
        path: file.relativePath,
        detail: `Indexed file ${formatBytes(file.sizeBytes)} may pollute context if read broadly.`,
        suggestIgnore: hint.suggest.split("\n")[0],
      });
      for (const s of hint.suggest.split("\n")) {
        if (![...existing].some((e) => e === s || e.includes(s.replace(/\*/g, "")))) {
          recommended.add(s);
        }
      }
    }
    if (file.sizeBytes >= 1_500_000) {
      findings.push({
        severity: "high",
        kind: "huge-file",
        path: file.relativePath,
        detail: `Large indexed file (${formatBytes(file.sizeBytes)}). Prefer smart_read with symbol/intent; consider ignoring if generated.`,
      });
    }
  }

  // Lockfiles note (usually OK to ignore for agent unless dependency task)
  for (const lock of ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "composer.lock"]) {
    const full = join(options.workspaceRoot, lock);
    if (!existsSync(full)) continue;
    const size = statSync(full).size;
    if (size > 200_000) {
      findings.push({
        severity: "low",
        kind: "lockfile",
        path: lock,
        detail: `Large lockfile (${formatBytes(size)}). Usually skip unless debugging dependencies.`,
        suggestIgnore: lock,
      });
    }
  }

  // Sort & cap
  const severityRank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const top = findings.slice(0, 40);

  const lines: string[] = [];
  lines.push("Cursory diagnose");
  lines.push("──────────────────────────────────────");
  lines.push(`Workspace: ${options.workspaceRoot}`);
  lines.push(`Files indexed: ${scan.indexedCount}`);
  lines.push(`Omitted from walk: ${scan.omittedFromWalk}`);
  lines.push(`.cursorignore: ${hasCursorignore ? "present" : "missing"}`);
  lines.push("");
  lines.push("Findings (potential context waste)");
  if (top.length === 0) {
    lines.push("  (none notable)");
  } else {
    for (const f of top) {
      lines.push(`  [${f.severity}] ${f.kind}: ${f.path}`);
      lines.push(`           ${f.detail}`);
    }
  }
  lines.push("");
  lines.push("Recommended .cursorignore additions");
  lines.push("(Cursory will NOT modify .cursorignore unless you explicitly ask.)");
  if (recommended.size === 0) {
    lines.push("  (no new suggestions — defaults/gitignore may already cover these)");
  } else {
    for (const s of [...recommended].sort()) {
      lines.push(`  ${s}`);
    }
  }
  lines.push("");
  lines.push("Next steps");
  lines.push("  - Route broad search, large reads, and verbose commands through Cursory");
  lines.push("  - Review suggestions before editing .cursorignore");
  lines.push("  - Explicit user intent overrides ignore optimization");

  return {
    text: lines.join("\n"),
    findings: top,
    recommendedIgnores: [...recommended].sort(),
  };
}
