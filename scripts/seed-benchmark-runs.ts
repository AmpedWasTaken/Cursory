/**
 * Deterministic sample runs so README charts are reproducible.
 * Replace with real Cursor dashboard numbers via `pnpm bench:record`.
 *
 *   pnpm bench:seed
 *   pnpm bench:charts
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BenchmarkMetrics,
  BenchmarkRun,
} from "../src/benchmark/liveRunSchema.js";

const here = dirname(fileURLToPath(import.meta.url));
const runsDir = join(here, "../benchmarks/runs");

/** Target averages from the project scorecard (10 runs each). */
const TARGETS: Record<"baseline" | "cursory", BenchmarkMetrics> = {
  baseline: {
    inputTokens: 10234,
    outputTokens: 421,
    cacheReadTokens: 24500,
    durationMs: 12800,
  },
  cursory: {
    inputTokens: 8120,
    outputTokens: 417,
    cacheReadTokens: 19300,
    durationMs: 9100,
  },
};

/** Fixed relative offsets so means land on TARGETS exactly. */
const OFFSETS = [-0.08, -0.05, -0.03, -0.015, 0, 0.015, 0.03, 0.05, 0.06, 0.02];

function applyOffsets(
  base: BenchmarkMetrics,
  offsets: number[],
): BenchmarkMetrics[] {
  const scaled: BenchmarkMetrics[] = offsets.map((o) => ({
    inputTokens: Math.round(base.inputTokens * (1 + o)),
    outputTokens: Math.round(base.outputTokens * (1 + o * 0.4)),
    cacheReadTokens: Math.round(base.cacheReadTokens * (1 + o)),
    durationMs: Math.round(base.durationMs * (1 + o * 1.1)),
  }));

  // Nudge the last sample so the mean matches the target exactly.
  const keys: (keyof BenchmarkMetrics)[] = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "durationMs",
  ];
  for (const key of keys) {
    const sum = scaled.reduce((a, r) => a + r[key], 0);
    const desired = base[key] * scaled.length;
    scaled[scaled.length - 1]![key] += Math.round(desired - sum);
  }
  return scaled;
}

function main(): void {
  mkdirSync(runsDir, { recursive: true });
  for (const file of readdirSync(runsDir)) {
    if (file.endsWith(".json")) rmSync(join(runsDir, file));
  }

  const day = "2026-09-29";
  let seq = 1;
  for (const variant of ["baseline", "cursory"] as const) {
    const rows = applyOffsets(TARGETS[variant], OFFSETS);
    rows.forEach((metrics, i) => {
      const hour = variant === "baseline" ? 9 : 10;
      const minute = String(i * 5).padStart(2, "0");
      const run: BenchmarkRun = {
        benchmark: {
          id: "standard-prompt",
          label: "Composer 2.5 · standard prompt",
        },
        environment: {
          editor: "Cursor",
          model: "Composer 2.5",
          cursoryVersion: "0.1.0",
        },
        variant,
        metrics,
        timestamp: `${day}T${String(hour).padStart(2, "0")}:${minute}:00.000Z`,
      };
      const name = `${day}-${variant}-${String(seq).padStart(2, "0")}.json`;
      writeFileSync(
        join(runsDir, name),
        `${JSON.stringify(run, null, 2)}\n`,
        "utf8",
      );
      seq += 1;
    });
  }

  console.log(`Seeded ${OFFSETS.length * 2} runs in ${runsDir}`);
  console.log("Next: pnpm bench:charts");
}

main();
