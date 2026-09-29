import { estimateTokensFromText } from "../core/telemetry/estimator.js";

/** Deterministic estimate used consistently by context selection and telemetry. */
export function estimateTokens(text: string): number {
  return estimateTokensFromText(text).tokens;
}

export function truncateToTokens(text: string, maxTokens: number): string {
  if (maxTokens <= 0 || text.length === 0) return "";
  if (estimateTokens(text) <= maxTokens) return text;
  return text.slice(0, Math.max(0, maxTokens * 4)).trimEnd();
}
