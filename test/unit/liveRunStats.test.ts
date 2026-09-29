import { describe, expect, it } from "vitest";
import type { BenchmarkRun } from "../../src/benchmark/liveRunSchema.js";
import { parseBenchmarkRun } from "../../src/benchmark/liveRunSchema.js";
import {
  buildSummaryFile,
  mean,
  median,
  percentChange,
  stdDev,
  summarizeBenchmarkRuns,
} from "../../src/benchmark/liveRunStats.js";
import { renderComparisonBarSvg } from "../../src/benchmark/liveRunCharts.js";

function run(
  variant: "baseline" | "cursory",
  metrics: BenchmarkRun["metrics"],
  n = 1,
): BenchmarkRun {
  return {
    benchmark: { id: "standard-prompt", label: "Standard prompt" },
    environment: {
      editor: "Cursor",
      model: "Composer 2.5",
      cursoryVersion: "0.1.0",
    },
    variant,
    metrics,
    timestamp: `2026-09-29T09:0${n}:00.000Z`,
  };
}

describe("live run stats", () => {
  it("computes mean, median, and sample stdDev", () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([1, 2, 3])).toBe(2);
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it("summarizes baseline vs cursory with percent change", () => {
    const runs = [
      run("baseline", {
        inputTokens: 10000,
        outputTokens: 400,
        cacheReadTokens: 20000,
        durationMs: 10000,
      }),
      run(
        "baseline",
        {
          inputTokens: 12000,
          outputTokens: 440,
          cacheReadTokens: 24000,
          durationMs: 14000,
        },
        2,
      ),
      run(
        "cursory",
        {
          inputTokens: 8000,
          outputTokens: 400,
          cacheReadTokens: 16000,
          durationMs: 8000,
        },
        3,
      ),
      run(
        "cursory",
        {
          inputTokens: 8400,
          outputTokens: 420,
          cacheReadTokens: 16800,
          durationMs: 9000,
        },
        4,
      ),
    ];

    const summary = summarizeBenchmarkRuns(runs);
    expect(summary.runs).toEqual({ baseline: 2, cursory: 2 });
    expect(summary.average.baseline.inputTokens).toBe(11000);
    expect(summary.average.cursory.inputTokens).toBe(8200);
    expect(summary.change.inputTokensPercent).toBeCloseTo(
      percentChange(11000, 8200),
      5,
    );
    expect(summary.min.baseline.durationMs).toBe(10000);
    expect(summary.max.cursory.cacheReadTokens).toBe(16800);
  });

  it("parses the future-proof run schema", () => {
    const parsed = parseBenchmarkRun({
      benchmark: { id: "simple-refactor", label: "Simple refactor" },
      environment: {
        editor: "Cursor",
        model: "Composer 2.5",
        cursoryVersion: "0.1.0",
      },
      variant: "cursory",
      metrics: {
        inputTokens: 9119,
        outputTokens: 453,
        cacheReadTokens: 20430,
        durationMs: 14900,
      },
      timestamp: "2026-09-29T09:30:00Z",
    });
    expect(parsed?.benchmark.id).toBe("simple-refactor");
    expect(parseBenchmarkRun({ variant: "nope" })).toBeNull();
  });

  it("builds a summary file keyed by benchmark id", () => {
    const file = buildSummaryFile([
      run("baseline", {
        inputTokens: 100,
        outputTokens: 10,
        cacheReadTokens: 50,
        durationMs: 1000,
      }),
      {
        ...run("cursory", {
          inputTokens: 80,
          outputTokens: 10,
          cacheReadTokens: 40,
          durationMs: 800,
        }),
        benchmark: { id: "other", label: "Other" },
      },
    ]);
    expect(Object.keys(file.benchmarks).sort()).toEqual([
      "other",
      "standard-prompt",
    ]);
    expect(file.schemaVersion).toBe(1);
  });

  it("renders dark README-ready SVG with run counts and change", () => {
    const svg = renderComparisonBarSvg({
      title: "Input token usage",
      subtitle: "n=20",
      unit: "tok",
      baseline: 10234,
      cursory: 8120,
      baselineMin: 9000,
      baselineMax: 11000,
      cursoryMin: 7500,
      cursoryMax: 8800,
      changePercent: -20.66,
      baselineRuns: 10,
      cursoryRuns: 10,
    });
    expect(svg).toContain("<svg");
    expect(svg).toContain("#111111");
    expect(svg).toContain("n=10");
    expect(svg).toContain("-20.7%");
    expect(svg).toContain("Baseline");
    expect(svg).toContain("Cursory");
  });
});
