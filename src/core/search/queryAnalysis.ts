export interface AnalyzedQuery {
  raw: string;
  tokens: string[];
  /** Likely filename / basename hints */
  pathHints: string[];
  /** Likely symbol / identifier hints */
  symbolHints: string[];
  /** Free-text terms for grep */
  textTerms: string[];
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "where",
  "what",
  "how",
  "why",
  "when",
  "who",
  "which",
  "does",
  "do",
  "did",
  "can",
  "could",
  "should",
  "would",
  "with",
  "from",
  "this",
  "that",
  "it",
  "as",
  "by",
  "at",
  "into",
  "about",
  "find",
  "show",
  "me",
  "please",
  "code",
  "file",
  "function",
  "class",
  "method",
]);

/**
 * Deterministic query analysis — no embeddings.
 */
export function analyzeQuery(query: string): AnalyzedQuery {
  const raw = query.trim();
  const pathHints: string[] = [];
  const symbolHints: string[] = [];

  // path-like tokens
  for (const m of raw.matchAll(/[\w./\\-]+\.[a-zA-Z0-9]+/g)) {
    pathHints.push(m[0]!.replace(/\\/g, "/"));
  }
  for (const m of raw.matchAll(/(?:^|\s)([\w-]+\/[\w./-]+)/g)) {
    pathHints.push(m[1]!.replace(/\\/g, "/"));
  }

  // CamelCase / snake / dotted symbols
  for (const m of raw.matchAll(/\b[A-Z][a-zA-Z0-9]{2,}\b/g)) {
    symbolHints.push(m[0]!);
  }
  for (const m of raw.matchAll(/\b[a-z][a-zA-Z0-9]{2,}(?:[A-Z][a-zA-Z0-9]*)+\b/g)) {
    symbolHints.push(m[0]!);
  }
  for (const m of raw.matchAll(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g)) {
    symbolHints.push(m[0]!);
  }
  for (const m of raw.matchAll(/\b[a-zA-Z_][a-zA-Z0-9_]*\s*\(/g)) {
    symbolHints.push(m[0]!.replace(/\s*\($/, ""));
  }

  const tokens = raw
    .toLowerCase()
    .split(/[^a-z0-9_]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));

  const textTerms = tokens.filter((t) => t.length >= 3);

  return {
    raw,
    tokens: [...new Set(tokens)],
    pathHints: [...new Set(pathHints)],
    symbolHints: [...new Set(symbolHints)],
    textTerms: [...new Set(textTerms)],
  };
}
