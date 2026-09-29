import { spawnSync } from "node:child_process";

export function runGit(
  cwd: string,
  args: string[],
  options?: { timeoutMs?: number; maxBuffer?: number },
): { ok: boolean; stdout: string; stderr: string; status: number | null } {
  try {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: options?.timeoutMs ?? 15_000,
      maxBuffer: options?.maxBuffer ?? 4 * 1024 * 1024,
    });
    return {
      ok: !result.error && (result.status === 0 || result.status === 1), // diff returns 1 when differences
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      status: result.status,
    };
  } catch {
    return { ok: false, stdout: "", stderr: "", status: null };
  }
}
