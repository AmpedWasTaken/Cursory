import { hashString } from "../core/cache/hashes.js";
import { estimateTokens } from "./TokenEstimator.js";

const GENERATED_PREFIXES = [
  /^\[\/?CURSORY_CONTEXT[^\]]*\]\s*$/gim,
  /^Cursory (?:hint|context|metadata):.*$/gim,
  /^generated-by:\s*cursory.*$/gim,
];

export interface DuplicateBlock {
  text: string;
  normalized: string;
  hash: string;
  tokens: number;
}

export interface DuplicateMatch {
  candidate: DuplicateBlock;
  similarity: number;
  kind: "exact" | "normalized" | "fuzzy";
  duplicateTokens: number;
}

export interface DuplicateDetectionResult {
  unique: string[];
  duplicates: DuplicateMatch[];
  trimmed: string[];
  duplicateTokens: number;
}

export function normalizeForComparison(text: string): string {
  let normalized = text.replace(/\r\n?/g, "\n");
  for (const prefix of GENERATED_PREFIXES) {
    normalized = normalized.replace(prefix, "");
  }
  return normalized
    .replace(/^\s*```[^\n]*$/gm, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .toLowerCase();
}

function block(text: string): DuplicateBlock {
  const normalized = normalizeForComparison(text);
  return {
    text,
    normalized,
    hash: hashString(normalized),
    tokens: estimateTokens(text),
  };
}

function shingles(text: string, size = 5): Set<string> {
  const words = normalizeForComparison(text).split(/\s+/).filter(Boolean);
  if (words.length < size) return new Set(words);
  const result = new Set<string>();
  for (let i = 0; i <= words.length - size; i++) {
    result.add(words.slice(i, i + size).join(" "));
  }
  return result;
}

export function jaccardSimilarity(left: string, right: string): number {
  const a = shingles(left);
  const b = shingles(right);
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection++;
  }
  return intersection / (a.size + b.size - intersection);
}

function trimOverlappingLines(candidate: string, existing: string[]): string {
  const seen = new Set(
    existing.flatMap((value) =>
      value
        .split(/\r?\n/)
        .map(normalizeForComparison)
        .filter((line) => line.length >= 12),
    ),
  );
  return candidate
    .split(/\r?\n/)
    .filter((line) => {
      const normalized = normalizeForComparison(line);
      return normalized.length < 12 || !seen.has(normalized);
    })
    .join("\n")
    .trim();
}

/**
 * Remove exact/normalized duplicates and trim obvious line overlap for fuzzy
 * matches. This intentionally uses local hashes and shingles, never an LLM.
 */
export function detectDuplicateBlocks(
  candidates: string[],
  existing: string[],
  thresholds = { duplicate: 0.9, overlap: 0.7 },
): DuplicateDetectionResult {
  const reference = existing.map(block).filter((item) => item.normalized.length > 0);
  const accepted: DuplicateBlock[] = [];
  const unique: string[] = [];
  const duplicates: DuplicateMatch[] = [];
  const trimmed: string[] = [];
  let duplicateTokens = 0;

  for (const text of candidates) {
    const candidate = block(text);
    if (!candidate.normalized) continue;
    const comparisons = [...reference, ...accepted];
    let best = 0;
    let bestKind: DuplicateMatch["kind"] = "fuzzy";
    for (const prior of comparisons) {
      if (candidate.text === prior.text) {
        best = 1;
        bestKind = "exact";
        break;
      }
      if (candidate.hash === prior.hash) {
        best = 1;
        bestKind = "normalized";
        break;
      }
      best = Math.max(best, jaccardSimilarity(candidate.normalized, prior.normalized));
    }
    if (best >= thresholds.duplicate) {
      duplicates.push({
        candidate,
        similarity: best,
        kind: bestKind,
        duplicateTokens: candidate.tokens,
      });
      duplicateTokens += candidate.tokens;
      continue;
    }
    if (best >= thresholds.overlap) {
      const novel = trimOverlappingLines(text, comparisons.map((item) => item.text));
      if (!novel) {
        duplicates.push({
          candidate,
          similarity: best,
          kind: "fuzzy",
          duplicateTokens: candidate.tokens,
        });
        duplicateTokens += candidate.tokens;
        continue;
      }
      trimmed.push(novel);
      const acceptedBlock = block(novel);
      accepted.push(acceptedBlock);
      unique.push(novel);
      duplicateTokens += Math.max(0, candidate.tokens - acceptedBlock.tokens);
      continue;
    }
    accepted.push(candidate);
    unique.push(text);
  }

  return { unique, duplicates, trimmed, duplicateTokens };
}
