import { spawnSync } from "node:child_process";

/**
 * Recently touched files under the workspace directory only.
 */
export function getRecentFiles(workspaceRoot: string, limit = 20): string[] {
  try {
    const result = spawnSync(
      "git",
      [
        "log",
        "--name-only",
        "--pretty=format:",
        "-n",
        String(Math.min(limit, 25)),
        "--",
        ".",
      ],
      {
        cwd: workspaceRoot,
        encoding: "utf8",
        windowsHide: true,
        timeout: 5_000,
        maxBuffer: 1024 * 1024,
      },
    );
    if (result.error || result.status !== 0 || !result.stdout) {
      return [];
    }
    const files = new Set<string>();
    for (const line of result.stdout.split(/\r?\n/)) {
      const t = line.trim().replace(/\\/g, "/");
      if (t) files.add(t);
    }
    return [...files];
  } catch {
    return [];
  }
}
