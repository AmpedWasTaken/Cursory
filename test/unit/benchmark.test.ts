import { describe, expect, it } from "vitest";
import {
  benchmarkPassed,
  buildBenchmarkReport,
  formatBenchmarkReport,
} from "../../src/benchmark/index.js";

describe("Phase 9 benchmark", () => {
  it("beats baseline, recovers raw, and solves all tasks", () => {
    const report = buildBenchmarkReport();
    expect(report.scenarios).toHaveLength(12);
    expect(report.tasksPassed).toBe(12);
    expect(report.rawRecoverabilityPct).toBe(100);
    expect(report.totalCursory).toBeLessThan(report.totalBaseline);
    expect(benchmarkPassed(report)).toBe(true);
    const contextScenarios = report.scenarios.slice(0, 6);
    for (const scenario of contextScenarios) {
      expect(scenario.latencyMs).toBeLessThan(150);
      expect(scenario.cursoryTokens).toBeLessThanOrEqual(
        scenario.baselineTokens * 0.85,
      );
    }

    const text = formatBenchmarkReport(report);
    expect(text).toContain("CURSORY BENCHMARK");
    expect(text).toContain("Long conversation");
    expect(text).toContain("Large codebase context");
    expect(text).toContain("Repository discovery");
    expect(text).toContain("Raw recoverability: 100%");
    expect(text).toContain("Tests solved successfully: 12/12");
    expect(text).toMatch(/not Cursor billing/i);
  }, 60_000);
});
