/**
 * Append a live Cursor usage benchmark run under benchmarks/runs/.
 *
 * Example:
 *   pnpm bench:record -- \
 *     --variant cursory \
 *     --id standard-prompt \
 *     --label "Composer 2.5 · standard prompt" \
 *     --model "Composer 2.5" \
 *     --input 9119 --output 453 --cache 20430 --duration 14900
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import type {
  BenchmarkRun,
  BenchmarkVariant,
} from "../src/benchmark/liveRunSchema.js";
import { isBenchmarkVariant } from "../src/benchmark/liveRunSchema.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version?: string };

const here = dirname(fileURLToPath(import.meta.url));
const runsDir = join(here, "../benchmarks/runs");

function usage(): never {
  console.error(`Usage: pnpm bench:record -- [options]

Required:
  --variant baseline|cursory
  --input <n>          inputTokens
  --output <n>         outputTokens
  --cache <n>          cacheReadTokens
  --duration <n>       durationMs

Optional:
  --id <slug>          benchmark id (default: standard-prompt)
  --label <text>       human label
  --model <text>       model name (default: Composer 2.5)
  --editor <text>      editor (default: Cursor)
  --version <semver>   cursoryVersion (default: package.json)
  --timestamp <iso>    default: now
  --file <name.json>   override output filename
`);
  process.exit(1);
}

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function requireNumber(args: string[], name: string): number {
  const raw = argValue(args, name);
  if (raw === undefined) {
    console.error(`Missing ${name}`);
    usage();
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`Invalid ${name}: ${raw}`);
    usage();
  }
  return n;
}

function slugDate(ts: string): string {
  return ts.slice(0, 10);
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) usage();

  const variantRaw = argValue(args, "--variant");
  if (!variantRaw || !isBenchmarkVariant(variantRaw)) {
    console.error("--variant must be baseline or cursory");
    usage();
  }
  const variant: BenchmarkVariant = variantRaw;

  const id = argValue(args, "--id") ?? "standard-prompt";
  const label =
    argValue(args, "--label") ?? "Composer 2.5 · standard prompt";
  const model = argValue(args, "--model") ?? "Composer 2.5";
  const editor = argValue(args, "--editor") ?? "Cursor";
  const cursoryVersion =
    argValue(args, "--version") ?? pkg.version ?? "0.0.0";
  const timestamp = argValue(args, "--timestamp") ?? new Date().toISOString();

  const run: BenchmarkRun = {
    benchmark: { id, label },
    environment: { editor, model, cursoryVersion },
    variant,
    metrics: {
      inputTokens: requireNumber(args, "--input"),
      outputTokens: requireNumber(args, "--output"),
      cacheReadTokens: requireNumber(args, "--cache"),
      durationMs: requireNumber(args, "--duration"),
    },
    timestamp,
  };

  mkdirSync(runsDir, { recursive: true });
  const override = argValue(args, "--file");
  const stamp = `${slugDate(timestamp)}-${variant}`;
  const fileName =
    override ??
    `${stamp}-${String(Date.now()).slice(-4)}.json`.replace(/:/g, "-");
  const path = join(runsDir, fileName);
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  console.log(`Wrote ${path}`);
}

main();
