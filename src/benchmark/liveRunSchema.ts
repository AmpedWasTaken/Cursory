/**
 * Future-proof schema for live Cursor usage benchmarks
 * (dashboard tokens / duration), distinct from offline fixture estimates.
 */

export type BenchmarkVariant = "baseline" | "cursory";

export interface BenchmarkIdentity {
  id: string;
  label: string;
}

export interface BenchmarkEnvironment {
  editor: string;
  model: string;
  cursoryVersion: string;
}

export interface BenchmarkMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  durationMs: number;
}

export interface BenchmarkRun {
  benchmark: BenchmarkIdentity;
  environment: BenchmarkEnvironment;
  variant: BenchmarkVariant;
  metrics: BenchmarkMetrics;
  timestamp: string;
}

export type MetricKey = keyof BenchmarkMetrics;

export const METRIC_KEYS: MetricKey[] = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "durationMs",
];

export interface MetricStats {
  average: number;
  median: number;
  min: number;
  max: number;
  stdDev: number;
  count: number;
}

export interface VariantMetricBundle {
  inputTokens: MetricStats;
  outputTokens: MetricStats;
  cacheReadTokens: MetricStats;
  durationMs: MetricStats;
}

export interface BenchmarkSummary {
  benchmark: BenchmarkIdentity;
  environment: {
    editors: string[];
    models: string[];
    cursoryVersions: string[];
  };
  runs: {
    baseline: number;
    cursory: number;
  };
  average: {
    baseline: BenchmarkMetrics;
    cursory: BenchmarkMetrics;
  };
  median: {
    baseline: BenchmarkMetrics;
    cursory: BenchmarkMetrics;
  };
  min: {
    baseline: BenchmarkMetrics;
    cursory: BenchmarkMetrics;
  };
  max: {
    baseline: BenchmarkMetrics;
    cursory: BenchmarkMetrics;
  };
  stdDev: {
    baseline: BenchmarkMetrics;
    cursory: BenchmarkMetrics;
  };
  change: {
    inputTokensPercent: number;
    outputTokensPercent: number;
    cacheReadTokensPercent: number;
    durationPercent: number;
  };
}

export interface BenchmarkSummaryFile {
  generatedAt: string;
  schemaVersion: 1;
  benchmarks: Record<string, BenchmarkSummary>;
}

export function isBenchmarkVariant(value: unknown): value is BenchmarkVariant {
  return value === "baseline" || value === "cursory";
}

export function parseBenchmarkRun(raw: unknown): BenchmarkRun | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  const benchmark = o.benchmark;
  if (!benchmark || typeof benchmark !== "object" || Array.isArray(benchmark)) {
    return null;
  }
  const b = benchmark as Record<string, unknown>;
  if (typeof b.id !== "string" || !b.id.trim()) return null;
  if (typeof b.label !== "string" || !b.label.trim()) return null;

  const environment = o.environment;
  if (
    !environment ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    return null;
  }
  const e = environment as Record<string, unknown>;
  if (typeof e.editor !== "string" || !e.editor.trim()) return null;
  if (typeof e.model !== "string" || !e.model.trim()) return null;
  if (typeof e.cursoryVersion !== "string" || !e.cursoryVersion.trim()) {
    return null;
  }

  if (!isBenchmarkVariant(o.variant)) return null;

  const metrics = o.metrics;
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return null;
  }
  const m = metrics as Record<string, unknown>;
  for (const key of METRIC_KEYS) {
    if (typeof m[key] !== "number" || !Number.isFinite(m[key]) || m[key] < 0) {
      return null;
    }
  }

  if (typeof o.timestamp !== "string" || !o.timestamp.trim()) return null;

  return {
    benchmark: { id: b.id.trim(), label: b.label.trim() },
    environment: {
      editor: e.editor.trim(),
      model: e.model.trim(),
      cursoryVersion: e.cursoryVersion.trim(),
    },
    variant: o.variant,
    metrics: {
      inputTokens: m.inputTokens as number,
      outputTokens: m.outputTokens as number,
      cacheReadTokens: m.cacheReadTokens as number,
      durationMs: m.durationMs as number,
    },
    timestamp: o.timestamp.trim(),
  };
}
