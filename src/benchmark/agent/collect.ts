import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DiffStat, VerificationResult } from "./types.js";

const execFileAsync = promisify(execFile);

export async function collectGitDiff(worktree: string): Promise<DiffStat> {
  try {
    const [{ stdout: stat }, { stdout: patch }] = await Promise.all([
      execFileAsync("git", ["diff", "--shortstat"], {
        cwd: worktree,
        encoding: "utf8",
      }),
      execFileAsync("git", ["diff"], {
        cwd: worktree,
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
      }),
    ]);

    const files =
      Number(/(\d+)\s+files? changed/.exec(stat)?.[1] ?? 0) ||
      (patch.trim() ? 1 : 0);
    const insertions = Number(/(\d+)\s+insertions?/.exec(stat)?.[1] ?? 0);
    const deletions = Number(/(\d+)\s+deletions?/.exec(stat)?.[1] ?? 0);

    return {
      filesChanged: files,
      insertions,
      deletions,
      patch,
    };
  } catch {
    return { filesChanged: 0, insertions: 0, deletions: 0, patch: "" };
  }
}

export async function runVerification(
  worktree: string,
  command: string,
  timeoutMs = 120_000,
): Promise<VerificationResult> {
  const shell = process.platform === "win32";
  try {
    const { stdout, stderr } = await execFileAsync(
      shell ? "cmd.exe" : "bash",
      shell ? ["/d", "/s", "/c", command] : ["-lc", command],
      {
        cwd: worktree,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 4 * 1024 * 1024,
        env: process.env,
      },
    );
    return {
      command,
      code: 0,
      stdout,
      stderr,
      timedOut: false,
    };
  } catch (err) {
    const e = err as {
      code?: number;
      killed?: boolean;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    return {
      command,
      code: typeof e.code === "number" ? e.code : 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? e.message ?? String(err),
      timedOut: Boolean(e.killed),
    };
  }
}
