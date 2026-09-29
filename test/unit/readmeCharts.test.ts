import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "../../src/benchmark/costModel.js";
import { renderAllReadmeCharts } from "../../src/benchmark/liveRunCharts.js";
import type { BenchmarkRun } from "../../src/benchmark/liveRunSchema.js";
import { buildSummaryFile } from "../../src/benchmark/liveRunStats.js";

function run(
  variant: "baseline" | "cursory",
  input: number,
  index: number,
): BenchmarkRun {
  const metrics = {
    inputTokens: input,
    outputTokens: 400,
    cacheReadTokens: 20_000,
    durationMs: 10_000,
  };
  return {
    benchmark: { id: "fix-session-redirect", label: "Fix session" },
    environment: {
      editor: "Cursor CLI",
      model: "composer-2.5",
      cursoryVersion: "0.1.0",
    },
    variant,
    metrics,
    timestamp: `2026-09-29T09:0${index}:00.000Z`,
    success: true,
    qualityScore: 100,
    estimatedCostUsd: estimateCostUsd(metrics),
  };
}

describe("readme chart suite", () => {
  it("emits dark grouped, savings, scatter, line, and cost charts", () => {
    const runs = [
      run("baseline", 16_000, 1),
      run("cursory", 9_500, 2),
      run("baseline", 15_500, 3),
      run("cursory", 9_200, 4),
    ];
    const summary = buildSummaryFile(runs).benchmarks["fix-session-redirect"]!;
    const charts = renderAllReadmeCharts(summary, runs);
    for (const key of [
      "headline",
      "grouped",
      "savings",
      "quality-scatter",
      "tokens-over-runs",
      "cost-per-success",
    ]) {
      expect(charts[key]).toContain("#0a0a0a");
      expect(charts[key]).toContain("<svg");
    }
    expect(charts.grouped).toMatch(/Cursor|Tokens/);
    expect(charts.savings).toMatch(/Token usage|Savings/);
    expect(charts["quality-scatter"]).toMatch(/Quality/);
    expect(charts["cost-per-success"]).toMatch(/Cost \/ success|Avg cost/);
  });
});
