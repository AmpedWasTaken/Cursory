import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import type { AnalyzedQuery } from "./queryAnalysis.js";

export interface GrepHit {
  path: string;
  line: number;
  text: string;
  matchCount: number;
}

export interface GrepOptions {
  /** Absolute path → relative posix path */
  files: Array<{ absolutePath: string; relativePath: string }>;
  query: AnalyzedQuery;
  maxFileBytes?: number;
  maxHits?: number;
  includeGenerated?: boolean;
}

/**
 * Exact/substring text search over candidate files (no ripgrep dependency).
 */
export function grepFiles(options: GrepOptions): GrepHit[] {
  const maxFileBytes = options.maxFileBytes ?? 512_000;
  const maxHits = options.maxHits ?? 200;
  const terms = [
    ...options.query.textTerms,
    ...options.query.symbolHints.map((s) => s.toLowerCase()),
  ].filter((t) => t.length >= 2);

  if (terms.length === 0 && options.query.pathHints.length === 0) {
    // Fall back to raw query words
    const fallback = options.query.raw
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 3);
    terms.push(...fallback);
  }

  const hits: GrepHit[] = [];
  if (terms.length === 0) {
    return hits;
  }

  for (const file of options.files) {
    if (hits.length >= maxHits) break;
    let size = 0;
    try {
      size = statSync(file.absolutePath).size;
    } catch {
      continue;
    }
    if (size > maxFileBytes) continue;

    let content: string;
    try {
      content = readFileSync(file.absolutePath, "utf8");
    } catch {
      continue;
    }
    // Skip obvious binary
    if (content.includes("\u0000")) continue;

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= maxHits) break;
      const line = lines[i]!;
      const lower = line.toLowerCase();
      let matchCount = 0;
      for (const term of terms) {
        if (lower.includes(term.toLowerCase())) {
          matchCount += 1;
        }
      }
      if (matchCount > 0) {
        hits.push({
          path: file.relativePath,
          line: i + 1,
          text: line.trimEnd().slice(0, 240),
          matchCount,
        });
      }
    }
  }

  return hits;
}

export function filenameMatches(relativePath: string, query: AnalyzedQuery): boolean {
  const base = basename(relativePath).toLowerCase();
  for (const hint of query.pathHints) {
    const h = hint.toLowerCase().replace(/\\/g, "/");
    if (relativePath.toLowerCase() === h || relativePath.toLowerCase().endsWith("/" + h)) {
      return true;
    }
    if (base === basename(h).toLowerCase()) {
      return true;
    }
  }
  for (const token of query.tokens) {
    if (token.includes(".") && base === token.toLowerCase()) {
      return true;
    }
  }
  return false;
}

export function pathKeywordScore(relativePath: string, query: AnalyzedQuery): number {
  const lower = relativePath.toLowerCase();
  if (query.tokens.length === 0) return 0;
  let hits = 0;
  for (const token of query.tokens) {
    if (token.length >= 3 && lower.includes(token.toLowerCase())) {
      hits += 1;
    }
  }
  return Math.min(1, hits / Math.min(4, query.tokens.length));
}
