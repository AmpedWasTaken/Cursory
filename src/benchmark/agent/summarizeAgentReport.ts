import type { BenchmarkMetrics } from "../liveRunSchema.js";
import { median, mean, percentChange } from "../liveRunStats.js";
import type {
  AgentBenchmarkReport,
  AgentRunRecord,
  VariantSummary,
} from "./types.js";

function metricsList(
  runs: AgentRunRecord[],
  key: keyof BenchmarkMetrics,
): number[] {
  return runs.map((r) => r.metrics[key]);
}

function summarizeVariant(runs: AgentRunRecord[]): VariantSummary {
  const success = runs.filter((r) => r.success).length;
  const empty: BenchmarkMetrics = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    durationMs: 0,
  };
  if (runs.length === 0) {
    return { runs: 0, successRate: 0, median: empty, average: empty };
  }
  const medianMetrics: BenchmarkMetrics = {
    inputTokens: median(metricsList(runs, "inputTokens")),
    outputTokens: median(metricsList(runs, "outputTokens")),
    cacheReadTokens: median(metricsList(runs, "cacheReadTokens")),
    durationMs: median(metricsList(runs, "durationMs")),
  };
  const averageMetrics: BenchmarkMetrics = {
    inputTokens: mean(metricsList(runs, "inputTokens")),
    outputTokens: mean(metricsList(runs, "outputTokens")),
    cacheReadTokens: mean(metricsList(runs, "cacheReadTokens")),
    durationMs: mean(metricsList(runs, "durationMs")),
  };
  return {
    runs: runs.length,
    successRate: success / runs.length,
    median: medianMetrics,
    average: averageMetrics,
  };
}

export function buildAgentReportSummary(
  runs: AgentRunRecord[],
): AgentBenchmarkReport["summary"] {
  const baseline = summarizeVariant(
    runs.filter((r) => r.variant === "baseline"),
  );
  const cursory = summarizeVariant(runs.filter((r) => r.variant === "cursory"));
  return {
    baseline,
    cursory,
    change: {
      inputTokensPercent: percentChange(
        baseline.median.inputTokens,
        cursory.median.inputTokens,
      ),
      outputTokensPercent: percentChange(
        baseline.median.outputTokens,
        cursory.median.outputTokens,
      ),
      cacheReadTokensPercent: percentChange(
        baseline.median.cacheReadTokens,
        cursory.median.cacheReadTokens,
      ),
      durationPercent: percentChange(
        baseline.median.durationMs,
        cursory.median.durationMs,
      ),
    },
  };
}
