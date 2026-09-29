import { readFileSync, existsSync } from "node:fs";
import { basename, extname, join, relative, sep } from "node:path";
import {
  DEFAULT_IGNORE_DIRS,
  DEFAULT_IGNORE_FILE_GLOBS,
} from "../config/defaults.js";

export interface IgnoreEngine {
  ignores(absoluteOrRelativePath: string, isDirectory?: boolean): boolean;
  /** Patterns contributed by defaults / gitignore / cursorignore / config. */
  sources: IgnoreSourceSummary;
}

export interface IgnoreSourceSummary {
  defaultDirs: string[];
  defaultFileGlobs: string[];
  gitignorePatterns: number;
  cursorignorePatterns: number;
  configExtra: string[];
}

interface CompiledRule {
  raw: string;
  negated: boolean;
  dirOnly: boolean;
  /** Match against posix-style relative path from workspace root. */
  test: (relPosix: string, isDirectory: boolean) => boolean;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function normalizeRel(workspaceRoot: string, inputPath: string): string {
  const abs = inputPath;
  const rel = relative(workspaceRoot, abs);
  if (rel.startsWith("..")) {
    // Outside workspace — treat as ignored for safety in scanner.
    return "";
  }
  if (!rel || rel === ".") {
    return "";
  }
  return toPosix(rel);
}

/**
 * Minimal gitignore-style matcher (deterministic subset).
 * Supports: comments, negation (!), dir-only (/), *, **, path segments.
 * Not a full gitignore implementation — good enough for Cursory defaults.
 */
function compilePattern(rawLine: string): CompiledRule | null {
  let line = rawLine.trim();
  if (!line || line.startsWith("#")) {
    return null;
  }
  let negated = false;
  if (line.startsWith("!")) {
    negated = true;
    line = line.slice(1);
  }
  let dirOnly = false;
  if (line.endsWith("/")) {
    dirOnly = true;
    line = line.slice(0, -1);
  }
  // Anchored if starts with /
  const anchored = line.startsWith("/");
  if (anchored) {
    line = line.slice(1);
  }

  const regex = globToRegExp(line, anchored);
  return {
    raw: rawLine,
    negated,
    dirOnly,
    test(relPosix, isDirectory) {
      if (dirOnly && !isDirectory) {
        // Still match the directory itself; files under it matched via parent walk skip.
        if (!regex.test(relPosix) && !regex.test(relPosix + "/")) {
          // Check if any parent segment matches dir pattern as path prefix
        }
      }
      if (dirOnly && !isDirectory) {
        // File path: ignore if any prefix directory matches this dir rule
        const parts = relPosix.split("/");
        let acc = "";
        for (let i = 0; i < parts.length - 1; i++) {
          acc = acc ? `${acc}/${parts[i]}` : parts[i]!;
          if (regex.test(acc)) {
            return true;
          }
        }
        return regex.test(relPosix);
      }
      return regex.test(relPosix);
    },
  };
}

function globToRegExp(pattern: string, anchored: boolean): RegExp {
  let i = 0;
  let out = "";
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        out += "(?:.*/)?";
        i += 3;
        continue;
      }
      out += ".*";
      i += 2;
      continue;
    }
    if (c === "*") {
      out += "[^/]*";
      i += 1;
      continue;
    }
    if (c === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    if ("+.^$()[]{}|\\".includes(c)) {
      out += `\\${c}`;
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  const body = anchored ? `^${out}(?:/.*)?$` : `(^|/)${out}(?:/.*)?$`;
  return new RegExp(body);
}

function loadPatternFile(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    return readFileSync(filePath, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

function compileFileGlob(glob: string): CompiledRule {
  // Only basename-style globs in defaults (e.g. *.map, package-lock.json)
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  const re = new RegExp(`(^|/)${escaped}$`, "i");
  return {
    raw: glob,
    negated: false,
    dirOnly: false,
    test(relPosix) {
      return re.test(relPosix) || re.test(basename(relPosix));
    },
  };
}

export function createIgnoreEngine(
  workspaceRoot: string,
  options?: { extraPatterns?: string[] },
): IgnoreEngine {
  const rules: CompiledRule[] = [];

  for (const dir of DEFAULT_IGNORE_DIRS) {
    const compiled = compilePattern(`${dir}/`);
    if (compiled) {
      rules.push(compiled);
    }
  }
  for (const glob of DEFAULT_IGNORE_FILE_GLOBS) {
    rules.push(compileFileGlob(glob));
  }

  const gitLines = loadPatternFile(join(workspaceRoot, ".gitignore"));
  const cursorLines = loadPatternFile(join(workspaceRoot, ".cursorignore"));
  const extra = options?.extraPatterns ?? [];

  let gitCount = 0;
  for (const line of gitLines) {
    const c = compilePattern(line);
    if (c) {
      rules.push(c);
      gitCount += 1;
    }
  }
  let cursorCount = 0;
  for (const line of cursorLines) {
    const c = compilePattern(line);
    if (c) {
      rules.push(c);
      cursorCount += 1;
    }
  }
  for (const line of extra) {
    const c = compilePattern(line);
    if (c) {
      rules.push(c);
    }
  }

  const sources: IgnoreSourceSummary = {
    defaultDirs: [...DEFAULT_IGNORE_DIRS],
    defaultFileGlobs: [...DEFAULT_IGNORE_FILE_GLOBS],
    gitignorePatterns: gitCount,
    cursorignorePatterns: cursorCount,
    configExtra: [...extra],
  };

  return {
    sources,
    ignores(inputPath: string, isDirectory = false): boolean {
      const rel = normalizeRel(workspaceRoot, inputPath);
      if (rel === "") {
        // workspace root itself never ignored; outside paths ignored
        const outside = relative(workspaceRoot, inputPath).startsWith("..");
        return outside;
      }

      // Also ignore if any path segment is a default ignore dir name
      const segments = rel.split("/");
      for (const seg of segments) {
        if ((DEFAULT_IGNORE_DIRS as readonly string[]).includes(seg)) {
          return true;
        }
      }

      let ignored = false;
      for (const rule of rules) {
        if (rule.test(rel, isDirectory)) {
          ignored = !rule.negated;
        }
      }

      // Extension / basename quick checks for binary-ish defaults already in rules
      void extname(rel);
      return ignored;
    },
  };
}
