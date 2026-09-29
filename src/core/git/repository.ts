import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative } from "node:path";

export interface GitInfo {
  isRepo: boolean;
  root: string | null;
  branch: string | null;
  changedFiles: string[];
}

function runGit(cwd: string, args: string[]): { ok: boolean; stdout: string } {
  try {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 8_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      return { ok: false, stdout: "" };
    }
    return { ok: true, stdout: (result.stdout ?? "").trim() };
  } catch {
    return { ok: false, stdout: "" };
  }
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Detect Git metadata scoped to the workspace folder.
 * If the Git toplevel is a parent of the workspace, paths are rewritten relative
 * to the workspace and files outside it are dropped (avoids huge parent repos).
 */
export function detectGit(workspaceRoot: string): GitInfo {
  const inside = runGit(workspaceRoot, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.stdout !== "true") {
    if (!existsSync(join(workspaceRoot, ".git"))) {
      return { isRepo: false, root: null, branch: null, changedFiles: [] };
    }
    return { isRepo: false, root: null, branch: null, changedFiles: [] };
  }

  const rootResult = runGit(workspaceRoot, ["rev-parse", "--show-toplevel"]);
  const branchResult = runGit(workspaceRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  // Path-scoped status keeps parent-monorepo noise out of Cursory results.
  const statusResult = runGit(workspaceRoot, ["status", "--porcelain", "-uall", "--", "."]);

  const gitRoot = rootResult.ok ? toPosix(rootResult.stdout) : toPosix(workspaceRoot);
  const workspacePosix = toPosix(workspaceRoot);
  const prefixFromGitRoot = toPosix(relative(gitRoot, workspacePosix));
  const prefix =
    prefixFromGitRoot && prefixFromGitRoot !== "." && !prefixFromGitRoot.startsWith("..")
      ? `${prefixFromGitRoot}/`
      : "";

  const changed = new Set<string>();
  if (statusResult.ok && statusResult.stdout) {
    for (const line of statusResult.stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let pathPart = line.slice(3);
      if (pathPart.includes(" -> ")) {
        const parts = pathPart.split(" -> ");
        pathPart = parts[parts.length - 1]!;
      }
      let rel = toPosix(pathPart.trim());
      if (prefix) {
        if (!rel.startsWith(prefix)) continue;
        rel = rel.slice(prefix.length);
      }
      if (rel) changed.add(rel);
    }
  }

  return {
    isRepo: true,
    root: gitRoot,
    branch: branchResult.ok ? branchResult.stdout : null,
    changedFiles: [...changed].sort(),
  };
}
