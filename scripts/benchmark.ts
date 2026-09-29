/**
 * Cursory Phase 9 benchmark suite.
 * Compares naive baseline context vs Cursory delivered estimates,
 * plus raw recoverability and task-success checks.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  benchmarkPassed,
  buildBenchmarkReport,
  formatBenchmarkReport,
} from "../src/benchmark/index.js";

const dataDir = mkdtempSync(join(tmpdir(), "cursory-bench-data-"));
process.env.CURSORY_DATA_DIR = dataDir;

try {
  const report = buildBenchmarkReport();
  console.log(formatBenchmarkReport(report));
  if (!benchmarkPassed(report)) {
    process.exitCode = 1;
  }
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
