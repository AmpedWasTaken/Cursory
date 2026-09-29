import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { BenchmarkMetrics, BenchmarkRun } from "../liveRunSchema.js";
import type { BenchmarkVariant } from "../liveRunSchema.js";
import { collectGitDiff, runVerification } from "./collect.js";
import { parseAgentOutput } from "./parseAgentOutput.js";
import { runCursorBenchmark, resolveAgentBinary } from "./runCursorAgent.js";
import { buildAgentReportSummary } from "./summarizeAgentReport.js";
import type {
  AgentBenchmarkReport,
  AgentRunRecord,
  BenchmarkTaskDef,
} from "./types.js";
import {
  addWorktree,
  createBenchRoot,
  materializeOriginRepo,
  removeWorktree,
  resolvePluginRoot,
  resolveRepoRoot,
  writeVariantMcpConfig,
} from "./worktree.js";

const require = createRequire(import.meta.url);
const pkg = require("../../../package.json") as { version?: string };

export interface OrchestrateOptions {
  task: BenchmarkTaskDef;
  /** Limit runs (overrides task.runs). */
  runs?: number;
  dryRun?: boolean;
  keepWorktrees?: boolean;
  benchRoot?: string;
  repoCwd?: string;
  agentBin?: string;
  timeoutMs?: number;
  /** Called after each variant completes. */
  onProgress?: (line: string) => void;
  /** Where to write the aggregate report JSON. */
  outDir?: string;
  /** Where to write live-schema run files for chart generation. */
  runsOutDir?: string;
}

function variantEnv(variant: BenchmarkVariant): NodeJS.ProcessEnv {
  return {
    CURSORY_ENABLED: variant === "cursory" ? "1" : "0",
    ...(variant === "baseline" ? { CURSORY_DISABLE_TAKEOVER: "1" } : {}),
  };
}

function dryRunAgentResult(variant: BenchmarkVariant, index: number) {
  const baseInput = variant === "baseline" ? 12_000 : 9_600;
  const jitter = index * 37;
  return {
    code: 0,
    stdout: JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: variant === "baseline" ? 8_000 + jitter : 6_500 + jitter,
      result: `dry-run ${variant} #${index}`,
      session_id: `dry-${variant}-${index}`,
      usage: {
        inputTokens: baseInput + jitter,
        outputTokens: 400 + (index % 5),
        cacheReadTokens: (variant === "baseline" ? 20_000 : 16_000) + jitter,
      },
    }),
    stderr: "",
    durationMs: variant === "baseline" ? 8_000 + jitter : 6_500 + jitter,
    timedOut: false,
  };
}

async function runOneVariant(
  options: OrchestrateOptions,
  variant: BenchmarkVariant,
  index: number,
  repoRoot: string,
  commitSha: string,
  benchRoot: string,
  pluginRoot: string,
): Promise<AgentRunRecord> {
  const log = options.onProgress ?? (() => undefined);
  const handle = addWorktree(repoRoot, commitSha, benchRoot, variant, index);
  writeVariantMcpConfig(handle.path, variant, pluginRoot);

  const timestamp = new Date().toISOString();
  try {
    const extraArgs = (process.env.CURSORY_AGENT_ARGS ?? "--trust --force")
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (variant === "cursory") {
      extraArgs.push("--plugin-dir", pluginRoot);
      extraArgs.push("--approve-mcps");
    }

    const cli = options.dryRun
      ? dryRunAgentResult(variant, index)
      : await runCursorBenchmark({
          workspace: handle.path,
          prompt: options.task.prompt,
          model: options.task.model,
          env: variantEnv(variant),
          agentBin: options.agentBin,
          timeoutMs: options.timeoutMs,
          outputFormat: "stream-json",
          extraArgs,
        });

    const parsed = options.dryRun
      ? {
          ...parseAgentOutput(cli.stdout),
          metricsSource: "dry-run" as const,
        }
      : parseAgentOutput(cli.stdout);

    const wallMs = cli.durationMs;
    const durationMs = parsed.durationMs ?? wallMs;
    const metrics: BenchmarkMetrics = {
      inputTokens: parsed.inputTokens ?? 0,
      outputTokens: parsed.outputTokens ?? 0,
      cacheReadTokens: parsed.cacheReadTokens ?? 0,
      durationMs,
    };

    const diff = await collectGitDiff(handle.path);
    let verification = options.task.verification
      ? await runVerification(
          handle.path,
          options.task.verification.command,
          options.task.verification.timeoutMs,
        )
      : undefined;

    // Dry-run: skip real verification failure on unfixed fixtures unless asked.
    if (options.dryRun && verification && verification.code !== 0) {
      verification = { ...verification, code: 0, stdout: "dry-run skip\n" };
    }

    const expectOk =
      !options.task.expectText ||
      (parsed.resultText ?? "").includes(options.task.expectText);
    const verifyOk = !verification || verification.code === 0;
    const agentOk = cli.code === 0 && !cli.timedOut;
    const success = agentOk && verifyOk && expectOk;

    const mark = success ? "✓" : "✗";
    log(`  ${variant === "baseline" ? "Baseline" : "Cursory "}  ${mark}`);

    return {
      variant,
      index,
      worktree: handle.path,
      timestamp,
      success,
      durationMs,
      metrics,
      metricsSource: parsed.metricsSource,
      verification,
      diff: {
        filesChanged: diff.filesChanged,
        insertions: diff.insertions,
        deletions: diff.deletions,
        patch: diff.patch.slice(0, 200_000),
      },
      agent: {
        exitCode: cli.code,
        sessionId: parsed.sessionId,
        timedOut: cli.timedOut,
        toolCalls: parsed.toolCalls,
      },
      error: success
        ? undefined
        : [
            !agentOk ? `agent exit ${cli.code}${cli.timedOut ? " (timeout)" : ""}` : "",
            verification && verification.code !== 0
              ? `verify exit ${verification.code}`
              : "",
            !expectOk ? "expectText miss" : "",
            cli.stderr.slice(0, 500),
          ]
            .filter(Boolean)
            .join("; "),
    };
  } finally {
    if (!options.keepWorktrees) {
      removeWorktree(repoRoot, handle);
    }
  }
}

function toLiveRun(
  task: BenchmarkTaskDef,
  record: AgentRunRecord,
  cursoryVersion: string,
): BenchmarkRun {
  return {
    benchmark: {
      id: task.id,
      label: task.label ?? task.id,
    },
    environment: {
      editor: "Cursor CLI",
      model: task.model,
      cursoryVersion,
    },
    variant: record.variant,
    metrics: record.metrics,
    timestamp: record.timestamp,
  };
}

export async function runAgentBenchmark(
  options: OrchestrateOptions,
): Promise<AgentBenchmarkReport> {
  const log = options.onProgress ?? (() => undefined);
  const runsN = options.runs ?? options.task.runs;
  const sourceRepo = resolveRepoRoot(
    options.task.repo,
    options.repoCwd ?? process.cwd(),
  );
  const benchRoot = options.benchRoot ?? createBenchRoot();
  const { originRoot: repoRoot, commitSha } = materializeOriginRepo(
    sourceRepo,
    benchRoot,
    options.task.commit,
  );
  const pluginRoot = resolvePluginRoot();
  const cursoryVersion = pkg.version ?? "0.0.0";
  const agentBinary = resolveAgentBinary(options.agentBin);
  const startedAt = new Date().toISOString();

  log("Preparing benchmark...");
  log("");
  log(`Cursor model: ${options.task.model}`);
  log(`Repo: ${sourceRepo}`);
  log(`Commit: ${commitSha.slice(0, 12)}`);
  log(`Runs: ${runsN} × baseline + ${runsN} × Cursory`);
  if (options.dryRun) log("Mode: dry-run (no agent binary)");
  log("");

  const records: AgentRunRecord[] = [];

  for (let i = 1; i <= runsN; i++) {
    log(`Run ${i}/${runsN}`);
    records.push(
      await runOneVariant(
        options,
        "baseline",
        i,
        repoRoot,
        commitSha,
        benchRoot,
        pluginRoot,
      ),
    );
    records.push(
      await runOneVariant(
        options,
        "cursory",
        i,
        repoRoot,
        commitSha,
        benchRoot,
        pluginRoot,
      ),
    );
    log("");
  }

  const finishedAt = new Date().toISOString();
  const summary = buildAgentReportSummary(records);
  const report: AgentBenchmarkReport = {
    schemaVersion: 1,
    task: options.task,
    startedAt,
    finishedAt,
    dryRun: Boolean(options.dryRun),
    environment: {
      editor: "Cursor CLI",
      cursoryVersion,
      agentBinary,
    },
    runs: records,
    summary,
  };

  if (options.outDir) {
    mkdirSync(options.outDir, { recursive: true });
    const stamp = startedAt.slice(0, 10);
    const reportPath = join(options.outDir, `${stamp}-${options.task.id}.json`);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    log(`Wrote ${reportPath}`);
  }

  if (options.runsOutDir) {
    const stamp = startedAt.slice(0, 10);
    mkdirSync(options.runsOutDir, { recursive: true });
    for (const record of records) {
      const live = toLiveRun(options.task, record, cursoryVersion);
      const name = `${stamp}-${record.variant}-${String(record.index).padStart(2, "0")}-${options.task.id}.json`;
      writeFileSync(
        join(options.runsOutDir, name),
        `${JSON.stringify(live, null, 2)}\n`,
        "utf8",
      );
    }
    log(`Wrote ${records.length} run files → ${options.runsOutDir}`);
  }

  return report;
}

export function formatAgentReport(report: AgentBenchmarkReport): string {
  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;
  const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  const b = report.summary.baseline;
  const c = report.summary.cursory;
  const ch = report.summary.change;

  const lines = [
    "Results",
    "────────────────────────────────────",
    `                    Baseline  Cursory`,
    `Median input        ${fmt(b.median.inputTokens).padStart(7)}  ${fmt(c.median.inputTokens).padStart(7)}`,
    `Median output       ${fmt(b.median.outputTokens).padStart(7)}  ${fmt(c.median.outputTokens).padStart(7)}`,
    `Median duration     ${sec(b.median.durationMs).padStart(7)}  ${sec(c.median.durationMs).padStart(7)}`,
    `Success rate        ${pct(b.successRate).padStart(7)}  ${pct(c.successRate).padStart(7)}`,
    "",
    `Input reduction               ${ch.inputTokensPercent.toFixed(1)}%`,
    `Duration change               ${ch.durationPercent.toFixed(1)}%`,
  ];
  return lines.join("\n");
}
