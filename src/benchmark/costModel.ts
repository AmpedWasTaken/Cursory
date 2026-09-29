import type { BenchmarkMetrics } from "./liveRunSchema.js";

/**
 * Transparent heuristic for README charts — not Cursor invoice dollars.
 * Rates are USD per 1M tokens (Composer-class ballpark).
 */
export const COST_MODEL = {
  inputUsdPerMTok: 3.0,
  outputUsdPerMTok: 15.0,
  cacheReadUsdPerMTok: 0.3,
  label: "estimated · not Cursor billing",
} as const;

export function estimateCostUsd(metrics: BenchmarkMetrics): number {
  return (
    (metrics.inputTokens / 1_000_000) * COST_MODEL.inputUsdPerMTok +
    (metrics.outputTokens / 1_000_000) * COST_MODEL.outputUsdPerMTok +
    (metrics.cacheReadTokens / 1_000_000) * COST_MODEL.cacheReadUsdPerMTok
  );
}

export function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(3)}`;
}
