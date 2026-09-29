import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatAgentReport,
  runAgentBenchmark,
} from "../benchmark/agent/orchestrate.js";
import {
  listTaskFiles,
  loadTaskFile,
  resolveTaskId,
} from "../benchmark/agent/loadTask.js";
import type { BenchmarkTaskDef } from "../benchmark/agent/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");
const tasksDir = join(repoRoot, "benchmarks", "tasks");
const resultsDir = join(repoRoot, "benchmarks", "results");

function printHelp(): void {
  console.log(`cursory benchmark

Usage:
  cursory benchmark [task-id] [options]
  cursory benchmark                 Interactive picker

Options:
  --runs <n>         Override task.runs
  --dry-run          Simulate agent (no Cursor CLI required)
  --write-runs       Also write dry-run metrics into benchmarks/runs/
  --keep-worktrees   Leave worktrees under the temp bench root
  --model <id>       Override task model
  --timeout-ms <n>   Per-agent timeout (default 900000)
  --list             List available tasks
  --help             Show this help

Environment:
  CURSORY_ENABLED=0|1     Forwarded per arm by the runner
  CURSORY_AGENT_BIN       Override agent binary (default: agent)
  CURSORY_AGENT_ARGS      Extra CLI flags (default: --trust)
  CURSORY_PLUGIN_ROOT     Plugin install used for MCP on the Cursory arm
`);
}

function argValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function interactivePick(): Promise<{
  task: BenchmarkTaskDef;
  runs: number;
  model: string;
} | null> {
  const files = listTaskFiles(tasksDir);
  if (files.length === 0) {
    console.error(`No tasks in ${tasksDir}`);
    return null;
  }
  const tasks = files.map((f) => loadTaskFile(f));
  const rl = createInterface({ input, output });
  try {
    console.log("Cursory Benchmark\n");
    console.log("Tasks");
    tasks.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.label ?? t.id}  (${t.id})`);
    });
    const taskAns = (await rl.question(`\nTask number [1]: `)).trim() || "1";
    const taskIdx = Math.max(0, Math.min(tasks.length - 1, Number(taskAns) - 1));
    const task = tasks[taskIdx]!;

    const model =
      (await rl.question(`Model [${task.model}]: `)).trim() || task.model;
    const runsRaw =
      (await rl.question(`Runs per variant [${task.runs}]: `)).trim() ||
      String(task.runs);
    const runs = Math.max(1, Math.floor(Number(runsRaw)) || task.runs);

    console.log("\n[ Run benchmark ]\n");
    return { task: { ...task, model, runs }, runs, model };
  } finally {
    rl.close();
  }
}

export async function runBenchmarkCli(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }
  if (argv.includes("--list")) {
    for (const f of listTaskFiles(tasksDir)) {
      const t = loadTaskFile(f);
      console.log(`${t.id}\t${t.label ?? ""}\t${t.model}\truns=${t.runs}`);
    }
    return 0;
  }

  const dryRun = argv.includes("--dry-run");
  const keepWorktrees = argv.includes("--keep-worktrees");
  const runsArg = argValue(argv, "--runs");
  const modelArg = argValue(argv, "--model");
  const timeoutArg = argValue(argv, "--timeout-ms");
  const positional = argv.find(
    (a) => !a.startsWith("-") && a !== "benchmark",
  );

  let task: BenchmarkTaskDef;
  let runs: number | undefined;

  if (!positional) {
    if (!process.stdin.isTTY) {
      printHelp();
      return 1;
    }
    const picked = await interactivePick();
    if (!picked) return 1;
    task = picked.task;
    runs = picked.runs;
  } else {
    task = resolveTaskId(tasksDir, positional);
    runs = runsArg ? Number(runsArg) : undefined;
  }

  if (modelArg) task = { ...task, model: modelArg };
  if (runsArg) runs = Number(runsArg);

  const report = await runAgentBenchmark({
    task,
    runs,
    dryRun,
    keepWorktrees,
    outDir: resultsDir,
    // Dry-runs stay out of the public chart corpus unless you pass --write-runs.
    runsOutDir:
      !dryRun || argv.includes("--write-runs")
        ? join(repoRoot, "benchmarks", "runs")
        : undefined,
    repoCwd: repoRoot,
    timeoutMs: timeoutArg ? Number(timeoutArg) : undefined,
    onProgress: (line) => console.log(line),
  });

  console.log(formatAgentReport(report));
  console.log("");
  console.log("Next: pnpm bench:charts   # refresh README SVGs from benchmarks/runs");
  return report.runs.every((r) => r.success) ? 0 : 1;
}
