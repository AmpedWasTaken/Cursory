import { avoidedPct, type BenchmarkReport } from "./types.js";
import { runAllScenarios } from "./scenarios.js";

export function buildBenchmarkReport(): BenchmarkReport {
  const { scenarios, recoverability } = runAllScenarios();
  const totalBaseline = scenarios.reduce((s, r) => s + r.baselineTokens, 0);
  const totalCursory = scenarios.reduce((s, r) => s + r.cursoryTokens, 0);
  const tasksPassed = scenarios.filter((s) => s.taskSuccess).length;
  const recoverOk = recoverability.filter((c) => c.ok).length;
  const rawRecoverabilityPct =
    recoverability.length === 0 ? 0 : (recoverOk / recoverability.length) * 100;

  return {
    scenarios,
    recoverability,
    rawRecoverabilityPct,
    tasksPassed,
    tasksTotal: scenarios.length,
    totalBaseline,
    totalCursory,
    totalAvoidedPct: avoidedPct(totalBaseline, totalCursory),
  };
}

export function formatBenchmarkReport(report: BenchmarkReport): string {
  const pad = (s: string, n: number) => s.padEnd(n);
  const rpad = (s: string, n: number) => s.padStart(n);
  const tok = (n: number) => Math.round(n).toLocaleString("en-US");
  const pct = (baseline: number, delivered: number) =>
    `${avoidedPct(baseline, delivered).toFixed(1)}%`;

  const lines: string[] = [];
  lines.push("CURSORY BENCHMARK");
  lines.push("────────────────────────────────────────────────");
  lines.push("");
  lines.push(
    `${pad("Scenario", 24)}${rpad("Baseline", 12)}${rpad("Cursory", 12)}${rpad("Avoided", 10)}${rpad("Relevant", 11)}${rpad("Latency", 10)}`,
  );

  for (const s of report.scenarios) {
    const relevant =
      s.relevantItemsTotal == null
        ? "n/a"
        : `${s.relevantItemsRetained}/${s.relevantItemsTotal}`;
    const latency = s.latencyMs == null ? "n/a" : `${s.latencyMs.toFixed(1)}ms`;
    lines.push(
      `${pad(s.name, 24)}${rpad(tok(s.baselineTokens), 12)}${rpad(tok(s.cursoryTokens), 12)}${rpad(pct(s.baselineTokens, s.cursoryTokens), 10)}${rpad(relevant, 11)}${rpad(latency, 10)}`,
    );
  }

  lines.push("");
  lines.push(
    `${pad("TOTAL", 24)}${rpad(tok(report.totalBaseline), 12)}${rpad(tok(report.totalCursory), 12)}${rpad(`${report.totalAvoidedPct.toFixed(1)}%`, 10)}`,
  );
  lines.push("");
  lines.push(
    `Raw recoverability: ${report.rawRecoverabilityPct.toFixed(0)}%` +
      ` (${report.recoverability.filter((c) => c.ok).length}/${report.recoverability.length} checks)`,
  );
  lines.push(
    `Tests solved successfully: ${report.tasksPassed}/${report.tasksTotal}`,
  );
  lines.push("");
  lines.push(
    "Estimates use a ~4 chars/token heuristic. These are not Cursor billing tokens.",
  );

  const failedTasks = report.scenarios.filter((s) => !s.taskSuccess);
  const failedRec = report.recoverability.filter((c) => !c.ok);
  if (failedTasks.length || failedRec.length) {
    lines.push("");
    lines.push("Failures:");
    for (const s of failedTasks) {
      lines.push(`  - ${s.name}: ${s.detail}`);
    }
    for (const c of failedRec) {
      lines.push(`  - ${c.name}: ${c.detail}`);
    }
  }

  return lines.join("\n");
}

export function benchmarkPassed(report: BenchmarkReport): boolean {
  return (
    report.tasksPassed === report.tasksTotal &&
    report.rawRecoverabilityPct >= 100 &&
    report.totalCursory <= report.totalBaseline &&
    report.scenarios.every(
      (scenario) => scenario.cursoryTokens <= scenario.baselineTokens,
    )
  );
}
