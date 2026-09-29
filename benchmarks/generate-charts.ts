/**
 * Aggregate benchmarks/runs/*.json → summary.json + assets/benchmarks/*.svg
 *
 *   pnpm bench:charts
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  chartSpecsForSummary,
  renderComparisonBarSvg,
} from "../src/benchmark/liveRunCharts.js";
import { parseBenchmarkRun } from "../src/benchmark/liveRunSchema.js";
import {
  buildSummaryFile,
  roundSummaryFile,
} from "../src/benchmark/liveRunStats.js";
import type { BenchmarkRun } from "../src/benchmark/liveRunSchema.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const runsDir = join(here, "runs");
const summaryPath = join(here, "summary.json");
const assetsDir = join(root, "assets", "benchmarks");

function loadRuns(): BenchmarkRun[] {
  if (!existsSync(runsDir)) {
    throw new Error(`Missing runs directory: ${runsDir}`);
  }
  const files = readdirSync(runsDir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const runs: BenchmarkRun[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const path = join(runsDir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, "utf8"));
    } catch (err) {
      errors.push(`${file}: invalid JSON (${String(err)})`);
      continue;
    }
    const parsed = parseBenchmarkRun(raw);
    if (!parsed) {
      errors.push(`${file}: failed schema validation`);
      continue;
    }
    runs.push(parsed);
  }

  if (errors.length) {
    console.error("Skipped invalid run files:");
    for (const e of errors) console.error(`  - ${e}`);
  }
  if (runs.length === 0) {
    throw new Error("No valid benchmark runs found under benchmarks/runs/");
  }
  return runs;
}

function pickPrimaryId(
  benchmarks: Record<string, { runs: { baseline: number; cursory: number } }>,
): string {
  const entries = Object.entries(benchmarks);
  entries.sort((a, b) => {
    const na = a[1].runs.baseline + a[1].runs.cursory;
    const nb = b[1].runs.baseline + b[1].runs.cursory;
    return nb - na || a[0].localeCompare(b[0]);
  });
  return entries[0]![0];
}

function main(): void {
  const runs = loadRuns();
  const summary = roundSummaryFile(buildSummaryFile(runs));
  mkdirSync(here, { recursive: true });
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const primaryId = pickPrimaryId(summary.benchmarks);
  const primary = summary.benchmarks[primaryId]!;
  const charts = chartSpecsForSummary(primary);

  const written: string[] = [];
  for (const [name, spec] of Object.entries(charts)) {
    const svg = renderComparisonBarSvg(spec);
    const out = join(assetsDir, `${name}.svg`);
    writeFileSync(out, svg, "utf8");
    written.push(out);

    // Also write per-benchmark copies for multi-suite repos.
    const keyed = join(assetsDir, `${primaryId}-${name}.svg`);
    writeFileSync(keyed, svg, "utf8");
    written.push(keyed);
  }

  // Extra chart sets when multiple benchmark ids exist.
  for (const [id, bench] of Object.entries(summary.benchmarks)) {
    if (id === primaryId) continue;
    const specs = chartSpecsForSummary(bench);
    for (const [name, spec] of Object.entries(specs)) {
      const out = join(assetsDir, `${id}-${name}.svg`);
      writeFileSync(out, renderComparisonBarSvg(spec), "utf8");
      written.push(out);
    }
  }

  console.log(`Wrote ${summaryPath}`);
  console.log(`Primary benchmark: ${primaryId}`);
  console.log(
    `  baseline n=${primary.runs.baseline}  cursory n=${primary.runs.cursory}`,
  );
  console.log(
    `  inputTokens ${primary.change.inputTokensPercent}%  duration ${primary.change.durationPercent}%  cache ${primary.change.cacheReadTokensPercent}%`,
  );
  for (const path of written) {
    console.log(`Wrote ${path}`);
  }
}

main();
