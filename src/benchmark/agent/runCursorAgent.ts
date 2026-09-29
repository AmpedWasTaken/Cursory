import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { AgentCliResult } from "./types.js";

export interface RunCursorBenchmarkOptions {
  workspace: string;
  prompt: string;
  model: string;
  /** Forwarded to the agent process (hooks inherit these). */
  env?: NodeJS.ProcessEnv;
  /** Override binary name/path. Default: agent, then cursor-agent. */
  agentBin?: string;
  /** Kill after this many ms. Default 15 minutes. */
  timeoutMs?: number;
  /**
   * Prefer stream-json so we can estimate context from tool results
   * when the final JSON object omits usage fields.
   */
  outputFormat?: "json" | "stream-json";
  /** Extra CLI args (e.g. --force / --trust). */
  extraArgs?: string[];
}

export function resolveAgentBinary(
  preferred?: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (preferred?.trim()) return preferred.trim();
  if (env.CURSORY_AGENT_BIN?.trim()) return env.CURSORY_AGENT_BIN.trim();
  return "agent";
}

export async function runCursorBenchmark(
  options: RunCursorBenchmarkOptions,
): Promise<AgentCliResult> {
  const bin = resolveAgentBinary(options.agentBin);
  const outputFormat = options.outputFormat ?? "stream-json";
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  const args = [
    "-p",
    options.prompt,
    "--model",
    options.model,
    "--workspace",
    options.workspace,
    "--output-format",
    outputFormat,
    ...(options.extraArgs ?? []),
  ];

  const start = performance.now();
  const env = { ...process.env, ...options.env };

  return await new Promise<AgentCliResult>((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: options.workspace,
      env,
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref?.();
    }, timeoutMs);

    child.stdout.on("data", (data: Buffer | string) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer | string) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        durationMs: performance.now() - start,
        timedOut,
      });
    });
  });
}
