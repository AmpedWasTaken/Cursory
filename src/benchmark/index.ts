export type { BenchmarkReport, ScenarioResult, RecoverabilityCheck } from "./types.js";
export { avoidedPct } from "./types.js";
export {
  buildBenchmarkReport,
  formatBenchmarkReport,
  benchmarkPassed,
} from "./runBenchmark.js";
export { runAllScenarios } from "./scenarios.js";
