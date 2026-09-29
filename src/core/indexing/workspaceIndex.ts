import { readdirSync, statSync, readFileSync, existsSync, lstatSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import {
  FRAMEWORK_DEPS,
  IMPORTANT_DIR_HINTS,
  MANIFEST_FILES,
} from "../config/defaults.js";
import { type IgnoreEngine, createIgnoreEngine } from "./ignore.js";
import { classifyFile, isProbablySource } from "./fileClassifier.js";

export interface IndexedFile {
  relativePath: string;
  sizeBytes: number;
  kind: ReturnType<typeof classifyFile>["kind"];
  language: string | null;
}

export interface DirSizeInfo {
  relativePath: string;
  sizeBytes: number;
  reason: "generated" | "ignored" | "large";
}

export interface WorkspaceScanResult {
  root: string;
  name: string;
  files: IndexedFile[];
  indexedCount: number;
  omittedFromWalk: number;
  languageCounts: Record<string, number>;
  manifests: string[];
  importantDirs: string[];
  entryPoints: string[];
  largeFiles: IndexedFile[];
  largeIgnoredDirs: DirSizeInfo[];
  frameworks: string[];
  approximateSourceBytes: number;
  ignoreSources: IgnoreEngine["sources"];
}

export interface ScanOptions {
  ignore?: IgnoreEngine;
  /** Max files to index (safety). */
  maxFiles?: number;
  /** Skip hashing / deep content — Phase 2 map only needs metadata. */
  maxLargeFiles?: number;
  /** Cap how many large ignored dirs to size. */
  maxIgnoredDirReports?: number;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function safeStat(path: string): { isDirectory: boolean; isFile: boolean; isSymbolicLink: boolean; size: number } | null {
  try {
    const lst = lstatSync(path);
    if (lst.isSymbolicLink()) {
      return { isDirectory: false, isFile: false, isSymbolicLink: true, size: 0 };
    }
    const st = statSync(path);
    return {
      isDirectory: st.isDirectory(),
      isFile: st.isFile(),
      isSymbolicLink: false,
      size: st.size,
    };
  } catch {
    return null;
  }
}

/** Approximate directory size with entry cap to stay responsive. */
function approxDirSize(dirPath: string, maxEntries = 5_000): number {
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
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
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

function detectFrameworks(workspaceRoot: string): string[] {
  const pkgPath = join(workspaceRoot, "package.json");
  if (!existsSync(pkgPath)) {
    return [];
  }
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const found = new Set<string>();
    for (const [name, label] of Object.entries(FRAMEWORK_DEPS)) {
      if (deps[name]) {
        found.add(label);
      }
    }
    return [...found].sort();
  } catch {
    return [];
  }
}

function detectEntryPoints(workspaceRoot: string, files: IndexedFile[]): string[] {
  const candidates = [
    "src/index.ts",
    "src/index.js",
    "src/main.ts",
    "src/main.js",
    "src/app.ts",
    "src/app/page.tsx",
    "src/app/layout.tsx",
    "app/page.tsx",
    "app/layout.tsx",
    "index.ts",
    "index.js",
    "main.go",
    "cmd/main.go",
    "src/main.rs",
  ];
  const present = new Set(files.map((f) => f.relativePath));
  const hits = candidates.filter((c) => present.has(c) || existsSync(join(workspaceRoot, c)));

  const pkgPath = join(workspaceRoot, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
        main?: string;
        bin?: string | Record<string, string>;
      };
      if (pkg.main) hits.push(toPosix(pkg.main));
      if (typeof pkg.bin === "string") hits.push(toPosix(pkg.bin));
      if (pkg.bin && typeof pkg.bin === "object") {
        hits.push(...Object.values(pkg.bin).map(toPosix));
      }
    } catch {
      // ignore
    }
  }
  return [...new Set(hits)].slice(0, 12);
}

function importantDirsFromFiles(files: IndexedFile[]): string[] {
  const counts = new Map<string, number>();
  for (const f of files) {
    if (!isProbablySource(f.kind)) continue;
    const parts = f.relativePath.split("/");
    if (parts.length < 2) continue;
    const top = parts[0]!;
    if ((IMPORTANT_DIR_HINTS as readonly string[]).includes(top) || top === "src" || top === "app") {
      // Prefer two-level for src/*
      const key = parts.length >= 2 && (top === "src" || top === "app" || top === "packages")
        ? `${parts[0]}/${parts[1]}`
        : top;
      counts.set(key.endsWith("/") ? key : `${key}/`, (counts.get(key.endsWith("/") ? key : `${key}/`) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k]) => k);
}

export function scanWorkspace(workspaceRoot: string, options: ScanOptions = {}): WorkspaceScanResult {
  const ignore = options.ignore ?? createIgnoreEngine(workspaceRoot);
  const maxFiles = options.maxFiles ?? 20_000;
  const maxLargeFiles = options.maxLargeFiles ?? 8;
  const maxIgnoredDirReports = options.maxIgnoredDirReports ?? 8;

  const files: IndexedFile[] = [];
  let omittedFromWalk = 0;
  const languageCounts: Record<string, number> = {};
  const manifests: string[] = [];
  let approximateSourceBytes = 0;

  const stack: string[] = [workspaceRoot];
  const largeIgnoredDirs: DirSizeInfo[] = [];
  const rootEntriesForIgnoreSize: string[] = [];

  while (stack.length > 0 && files.length < maxFiles) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      omittedFromWalk += 1;
      continue;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      const full = join(current, entry.name);
      const meta = safeStat(full);
      if (!meta || meta.isSymbolicLink) {
        omittedFromWalk += 1;
        continue;
      }

      const rel = toPosix(relative(workspaceRoot, full));
      if (!rel || rel === ".") continue;

      if (meta.isDirectory) {
        if (ignore.ignores(full, true)) {
          omittedFromWalk += 1;
          if (dirname(full) === workspaceRoot || current === workspaceRoot) {
            rootEntriesForIgnoreSize.push(full);
          }
          continue;
        }
        stack.push(full);
        continue;
      }

      if (!meta.isFile) {
        omittedFromWalk += 1;
        continue;
      }

      if (ignore.ignores(full, false)) {
        omittedFromWalk += 1;
        continue;
      }

      const classified = classifyFile(rel);
      const indexed: IndexedFile = {
        relativePath: rel,
        sizeBytes: meta.size,
        kind: classified.kind,
        language: classified.language,
      };
      files.push(indexed);
      if (classified.language && isProbablySource(classified.kind)) {
        languageCounts[classified.language] = (languageCounts[classified.language] ?? 0) + 1;
        approximateSourceBytes += meta.size;
      }
      if ((MANIFEST_FILES as readonly string[]).includes(basename(rel)) || classified.kind === "manifest") {
        manifests.push(rel);
      }
    }
  }

  // Size a few ignored/generated dirs at repo root
  for (const full of rootEntriesForIgnoreSize.slice(0, maxIgnoredDirReports)) {
    const rel = toPosix(relative(workspaceRoot, full));
    const sizeBytes = approxDirSize(full);
    largeIgnoredDirs.push({
      relativePath: rel.endsWith("/") ? rel : `${rel}/`,
      sizeBytes,
      reason: "generated",
    });
  }
  largeIgnoredDirs.sort((a, b) => b.sizeBytes - a.sizeBytes);

  const largeFiles = [...files]
    .filter((f) => f.kind === "source" || f.kind === "other" || f.kind === "docs")
    .sort((a, b) => b.sizeBytes - a.sizeBytes)
    .slice(0, maxLargeFiles);

  return {
    root: workspaceRoot,
    name: basename(workspaceRoot),
    files,
    indexedCount: files.length,
    omittedFromWalk,
    languageCounts,
    manifests: [...new Set(manifests)].sort(),
    importantDirs: importantDirsFromFiles(files),
    entryPoints: detectEntryPoints(workspaceRoot, files),
    largeFiles,
    largeIgnoredDirs,
    frameworks: detectFrameworks(workspaceRoot),
    approximateSourceBytes,
    ignoreSources: ignore.sources,
  };
}
