import { relative } from "node:path";
import { runGit } from "./exec.js";

export interface GitDiffOptions {
  workspaceRoot: string;
  base?: string;
  target?: string;
  path?: string;
}

export interface GitDiffFileStat {
  path: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface GitDiffResult {
  ok: boolean;
  base: string;
  target: string;
  pathFilter: string | null;
  patch: string;
  files: GitDiffFileStat[];
  additions: number;
  deletions: number;
  error?: string;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Git diff scoped to the workspace.
 * Defaults: working tree vs HEAD (includes staged+unstaged via `git diff HEAD`).
 */
export function getGitDiff(options: GitDiffOptions): GitDiffResult {
  const base = options.base?.trim() || "HEAD";
  const target = options.target?.trim() || ""; // empty = working tree / compare base to WT
  const pathFilter = options.path?.trim() ? toPosix(options.path.trim()) : null;

  // git diff [base] [target] -- [path]
  // working tree vs HEAD: git diff HEAD -- .
  // between commits: git diff base target -- .
  const args = ["diff", "--no-color", "--find-renames"];
  if (target) {
    args.push(base, target);
  } else {
    args.push(base);
  }
  args.push("--");
  if (pathFilter) {
    args.push(pathFilter);
  } else {
    args.push(".");
  }

  const result = runGit(options.workspaceRoot, args, { maxBuffer: 8 * 1024 * 1024 });
  if (!result.ok && result.status === null) {
    return {
      ok: false,
      base,
      target: target || "WORKTREE",
      pathFilter,
      patch: "",
      files: [],
      additions: 0,
      deletions: 0,
      error: result.stderr || "git diff failed",
    };
  }

  const numstatArgs = ["diff", "--numstat", "--find-renames"];
  if (target) numstatArgs.push(base, target);
  else numstatArgs.push(base);
  numstatArgs.push("--");
  if (pathFilter) numstatArgs.push(pathFilter);
  else numstatArgs.push(".");

  const numstat = runGit(options.workspaceRoot, numstatArgs);
  const files: GitDiffFileStat[] = [];
  let additions = 0;
  let deletions = 0;
  if (numstat.stdout.trim()) {
    for (const line of numstat.stdout.trim().split(/\r?\n/)) {
      const parts = line.split("\t");
      if (parts.length < 3) continue;
      const [a, d, file] = parts;
      const add = a === "-" ? 0 : Number(a);
      const del = d === "-" ? 0 : Number(d);
      additions += add || 0;
      deletions += del || 0;
      files.push({
        path: toPosix(file!),
        additions: add || 0,
        deletions: del || 0,
        status: "modified",
      });
    }
  }

  // Rewrite paths if we're inside a nested workspace of a larger repo — keep as git returns
  // relative to cwd (workspaceRoot), which is what we want with `-- .`.
  void relative;

  return {
    ok: true,
    base,
    target: target || "WORKTREE",
    pathFilter,
    patch: result.stdout,
    files,
    additions,
    deletions,
  };
}

/** Diff a single file vs HEAD (working tree). */
export function getFileDiffAgainstHead(workspaceRoot: string, relativePath: string): string {
  const result = getGitDiff({
    workspaceRoot,
    base: "HEAD",
    path: relativePath,
  });
  return result.patch;
}
