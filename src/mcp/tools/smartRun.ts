import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { loadConfig, resolveBudget } from "../../core/config/config.js";
import { reduceLogs } from "../../core/output/logReducer.js";
import { cleanupExpiredRawResults, storeRawResult } from "../../core/output/rawStore.js";
import { redactSecrets } from "../../core/output/secretRedaction.js";
import { reduceTerminal } from "../../core/output/terminalReducer.js";
import { reduceTests } from "../../core/output/testReducer.js";
import { truncateToBudget } from "../../core/output/tokenBudget.js";
import { estimateTokensFromText } from "../../core/telemetry/estimator.js";
import {
  ensureSessionStats,
  recordOptimization,
  recordTerminalCommand,
} from "../../core/telemetry/sessionStats.js";

export type SmartRunMode = "auto" | "raw" | "tests" | "logs" | "build";

export interface SmartRunOptions {
  workspaceRoot: string;
  command: string;
  cwd?: string;
  mode?: SmartRunMode;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface SmartRunResult {
  text: string;
  resultId: string;
  exitCode: number | null;
  timedOut: boolean;
  mode: string;
  estimatedRawTokens: number;
  estimatedDeliveredTokens: number;
  rawLines: number;
  keptLines: number;
}

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024; // 8MB soft cap in memory; still stored fully up to this

function resolveCwd(workspaceRoot: string, cwd?: string): string {
  const root = resolve(workspaceRoot);
  const candidate = cwd ? (isAbsolute(cwd) ? resolve(cwd) : resolve(root, cwd)) : root;
  const rel = relative(root, candidate);
  if (rel.startsWith("..")) {
    throw new Error(`cwd escapes workspace: ${cwd}`);
  }
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error(`cwd is not a directory: ${candidate}`);
  }
  return candidate;
}

export function detectMode(command: string, requested?: SmartRunMode): Exclude<SmartRunMode, "auto"> {
  if (requested && requested !== "auto") return requested;
  const c = command.toLowerCase();
  if (/\b(vitest|jest|mocha|pytest|phpunit|cargo test|go test|dotnet test|npm test|pnpm test|yarn test)\b/.test(c)) {
    return "tests";
  }
  if (/\b(tail|journalctl|kubectl logs|\.log\b|docker logs)\b/.test(c)) {
    return "logs";
  }
  if (/\b(build|tsc|webpack|vite build|next build|compile)\b/.test(c)) {
    return "build";
  }
  return "raw";
}

function runCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolvePromise) => {
    // shell:true is required for developer commands (pipes, &&, package scripts).
    // cwd is constrained to the workspace; timeout + capture caps apply.
    const child = spawn(command, {
      cwd,
      shell: true,
      windowsHide: true,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes <= MAX_CAPTURE_BYTES) {
        stdout += chunk.toString("utf8");
      } else if (!stdout.endsWith("\n… [stdout truncated at capture cap] …\n")) {
        stdout += "\n… [stdout truncated at capture cap] …\n";
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes <= MAX_CAPTURE_BYTES) {
        stderr += chunk.toString("utf8");
      } else if (!stderr.endsWith("\n… [stderr truncated at capture cap] …\n")) {
        stderr += "\n… [stderr truncated at capture cap] …\n";
      }
    });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode, timedOut });
    };

    child.on("error", (err) => {
      stderr += `\n[cursory] spawn error: ${err.message}\n`;
      finish(1);
    });
    child.on("close", (code) => finish(code));
  });
}

export async function buildSmartRun(options: SmartRunOptions): Promise<SmartRunResult> {
  const config = loadConfig(options.workspaceRoot);
  const maxTokens = resolveBudget(config, "terminal", options.maxTokens);
  const timeoutMs = options.timeoutMs ?? 120_000;
  const cwd = resolveCwd(options.workspaceRoot, options.cwd);
  const mode = detectMode(options.command, options.mode);

  ensureSessionStats(options.workspaceRoot);
  recordTerminalCommand();
  cleanupExpiredRawResults();

  const { stdout, stderr, exitCode, timedOut } = await runCommand(
    options.command,
    cwd,
    timeoutMs,
  );

  const meta = storeRawResult({
    command: options.command,
    cwd,
    exitCode,
    timedOut,
    mode,
    stdout,
    stderr,
    retainRawMinutes: config.terminal.retainRawMinutes,
  });

  const reduceInput = {
    stdout,
    stderr,
    exitCode,
    timedOut,
    command: options.command,
    maxTokens,
  };

  let reduced =
    mode === "tests"
      ? reduceTests(reduceInput)
      : mode === "logs"
        ? reduceLogs(reduceInput)
        : mode === "raw"
          ? {
              text: truncateToBudget(
                [
                  `command: ${options.command}`,
                  `exit: ${exitCode}${timedOut ? " (timed out)" : ""}`,
                  "",
                  stdout,
                  stderr ? `----- stderr -----\n${stderr}` : "",
                ].join("\n"),
                maxTokens,
              ),
              mode: "raw",
              keptLines: 0,
              rawLines: (stdout + stderr).split(/\r?\n/).length,
            }
          : reduceTerminal(reduceInput);

  if (mode === "build") {
    reduced = reduceTerminal(reduceInput);
    reduced = { ...reduced, mode: "build" };
  }

  const rawText = stdout + (stderr ? `\n----- stderr -----\n${stderr}` : "");
  const baselineText = [
    `command: ${options.command}`,
    `exit: ${exitCode}${timedOut ? " (timed out)" : ""}`,
    "",
    rawText,
  ].join("\n");
  const estimatedRawTokens = estimateTokensFromText(baselineText).tokens;

  const body = [
    reduced.text,
    "",
    `raw_result_id: ${meta.resultId}`,
    `Expand with: cursory_get_raw({ result_id: "${meta.resultId}" })`,
    `Raw retained until ${meta.expiresAt} (local temp; not uploaded).`,
  ].join("\n");

  // Redact only the delivered summary for accidental secret echo in reduced headers —
  // raw store keeps exact output for get_raw.
  const reducedText = redactSecrets(body);
  const deliveredText =
    estimateTokensFromText(reducedText).tokens <= estimatedRawTokens
      ? reducedText
      : redactSecrets(baselineText);
  const estimatedDeliveredTokens = estimateTokensFromText(deliveredText).tokens;

  recordOptimization({
    category: "terminal",
    estimatedRawTokens,
    estimatedDeliveredTokens,
    rawBytes: Buffer.byteLength(baselineText, "utf8"),
    deliveredBytes: Buffer.byteLength(deliveredText, "utf8"),
  });

  return {
    text: deliveredText,
    resultId: meta.resultId,
    exitCode,
    timedOut,
    mode: reduced.mode,
    estimatedRawTokens,
    estimatedDeliveredTokens,
    rawLines: reduced.rawLines || meta.totalLines,
    keptLines: reduced.keptLines,
  };
}
