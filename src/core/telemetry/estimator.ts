/**
 * Approximate token counting.
 *
 * Prefer a tiktoken-compatible estimator when a tokenizer is available later.
 * Phase 2 ships a deterministic character heuristic only — labelled as estimates.
 */

export type EstimateMethod = "chars" | "tiktoken";

export interface TokenEstimate {
  tokens: number;
  method: EstimateMethod;
  chars: number;
}

/** ~4 characters per token is a common English/code heuristic. */
const CHARS_PER_TOKEN = 4;

export function estimateTokensFromText(text: string): TokenEstimate {
  const chars = text.length;
  const tokens = chars === 0 ? 0 : Math.max(1, Math.ceil(chars / CHARS_PER_TOKEN));
  return { tokens, method: "chars", chars };
}

export function estimateTokensFromBytes(byteLength: number): TokenEstimate {
  const chars = byteLength;
  const tokens = byteLength === 0 ? 0 : Math.max(1, Math.ceil(byteLength / CHARS_PER_TOKEN));
  return { tokens, method: "chars", chars };
}

export function formatEstimateLabel(estimate: TokenEstimate): string {
  return `~${estimate.tokens.toLocaleString()} tokens (estimate via ${estimate.method})`;
}
