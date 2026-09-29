import type {
  BenchmarkMetrics,
  BenchmarkRun,
  BenchmarkSummary,
  BenchmarkSummaryFile,
  MetricKey,
  MetricStats,
  VariantMetricBundle,
} from "./liveRunSchema.js";

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

/** Sample standard deviation (n − 1). Zero when n < 2. */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const sumSq = values.reduce((acc, v) => acc + (v - avg) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

export function metricStats(values: number[]): MetricStats {
  if (values.length === 0) {
    return { average: 0, median: 0, min: 0, max: 0, stdDev: 0, count: 0 };
  }
  return {
    average: mean(values),
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    stdDev: stdDev(values),
    count: values.length,
  };
}

export function percentChange(baseline: number, cursory: number): number {
  if (baseline === 0) return cursory === 0 ? 0 : 100;
  return ((cursory - baseline) / baseline) * 100;
}

function emptyMetrics(): BenchmarkMetrics {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    durationMs: 0,
  };
}

function bundleToMetrics(
  bundle: VariantMetricBundle,
  field: keyof MetricStats,
): BenchmarkMetrics {
  return {
    inputTokens: bundle.inputTokens[field],
    outputTokens: bundle.outputTokens[field],
    cacheReadTokens: bundle.cacheReadTokens[field],
    durationMs: bundle.durationMs[field],
  };
}

function statsForVariant(runs: BenchmarkRun[]): VariantMetricBundle {
  const pick = (key: MetricKey) => runs.map((r) => r.metrics[key]);
  return {
    inputTokens: metricStats(pick("inputTokens")),
    outputTokens: metricStats(pick("outputTokens")),
    cacheReadTokens: metricStats(pick("cacheReadTokens")),
    durationMs: metricStats(pick("durationMs")),
  };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function summarizeBenchmarkRuns(runs: BenchmarkRun[]): BenchmarkSummary {
  if (runs.length === 0) {
    throw new Error("Cannot summarize an empty run set");
  }
  const identity = runs[0]!.benchmark;
  const baseline = runs.filter((r) => r.variant === "baseline");
  const cursory = runs.filter((r) => r.variant === "cursory");
  const baseStats = statsForVariant(baseline);
  const cursoryStats = statsForVariant(cursory);

  const avgBase =
    baseline.length > 0
      ? bundleToMetrics(baseStats, "average")
      : emptyMetrics();
  const avgCursory =
    cursory.length > 0
      ? bundleToMetrics(cursoryStats, "average")
      : emptyMetrics();

  return {
    benchmark: identity,
    environment: {
      editors: uniqueSorted(runs.map((r) => r.environment.editor)),
      models: uniqueSorted(runs.map((r) => r.environment.model)),
      cursoryVersions: uniqueSorted(
        runs.map((r) => r.environment.cursoryVersion),
      ),
    },
    runs: {
      baseline: baseline.length,
      cursory: cursory.length,
    },
    average: { baseline: avgBase, cursory: avgCursory },
    median: {
      baseline:
        baseline.length > 0
          ? bundleToMetrics(baseStats, "median")
          : emptyMetrics(),
      cursory:
        cursory.length > 0
          ? bundleToMetrics(cursoryStats, "median")
          : emptyMetrics(),
    },
    min: {
      baseline:
        baseline.length > 0 ? bundleToMetrics(baseStats, "min") : emptyMetrics(),
      cursory:
        cursory.length > 0
          ? bundleToMetrics(cursoryStats, "min")
          : emptyMetrics(),
    },
    max: {
      baseline:
        baseline.length > 0 ? bundleToMetrics(baseStats, "max") : emptyMetrics(),
      cursory:
        cursory.length > 0
          ? bundleToMetrics(cursoryStats, "max")
          : emptyMetrics(),
    },
    stdDev: {
      baseline:
        baseline.length > 0
          ? bundleToMetrics(baseStats, "stdDev")
          : emptyMetrics(),
      cursory:
        cursory.length > 0
          ? bundleToMetrics(cursoryStats, "stdDev")
          : emptyMetrics(),
    },
    change: {
      inputTokensPercent: percentChange(
        avgBase.inputTokens,
        avgCursory.inputTokens,
      ),
      outputTokensPercent: percentChange(
        avgBase.outputTokens,
        avgCursory.outputTokens,
      ),
      cacheReadTokensPercent: percentChange(
        avgBase.cacheReadTokens,
        avgCursory.cacheReadTokens,
      ),
      durationPercent: percentChange(avgBase.durationMs, avgCursory.durationMs),
    },
  };
}

export function buildSummaryFile(
  runs: BenchmarkRun[],
  generatedAt = new Date().toISOString(),
): BenchmarkSummaryFile {
  const byId = new Map<string, BenchmarkRun[]>();
  for (const run of runs) {
    const list = byId.get(run.benchmark.id) ?? [];
    list.push(run);
    byId.set(run.benchmark.id, list);
  }

  const benchmarks: Record<string, BenchmarkSummary> = {};
  for (const [id, group] of [...byId.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    benchmarks[id] = summarizeBenchmarkRuns(group);
  }

  return {
    generatedAt,
    schemaVersion: 1,
    benchmarks,
  };
}

/** Round for JSON / chart labels without noisy floats. */
export function roundMetric(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function roundSummaryForJson(summary: BenchmarkSummary): BenchmarkSummary {
  const roundMetrics = (m: BenchmarkMetrics): BenchmarkMetrics => ({
    inputTokens: roundMetric(m.inputTokens, 1),
    outputTokens: roundMetric(m.outputTokens, 1),
    cacheReadTokens: roundMetric(m.cacheReadTokens, 1),
    durationMs: roundMetric(m.durationMs, 1),
  });
  const roundSide = (side: {
    baseline: BenchmarkMetrics;
    cursory: BenchmarkMetrics;
  }) => ({
    baseline: roundMetrics(side.baseline),
    cursory: roundMetrics(side.cursory),
  });

  return {
    ...summary,
    average: roundSide(summary.average),
    median: roundSide(summary.median),
    min: roundSide(summary.min),
    max: roundSide(summary.max),
    stdDev: roundSide(summary.stdDev),
    change: {
      inputTokensPercent: roundMetric(summary.change.inputTokensPercent),
      outputTokensPercent: roundMetric(summary.change.outputTokensPercent),
      cacheReadTokensPercent: roundMetric(summary.change.cacheReadTokensPercent),
      durationPercent: roundMetric(summary.change.durationPercent),
    },
  };
}

export function roundSummaryFile(
  file: BenchmarkSummaryFile,
): BenchmarkSummaryFile {
  const benchmarks: Record<string, BenchmarkSummary> = {};
  for (const [id, summary] of Object.entries(file.benchmarks)) {
    benchmarks[id] = roundSummaryForJson(summary);
  }
  return { ...file, benchmarks };
}
