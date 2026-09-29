import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { BenchmarkVariant } from "../liveRunSchema.js";

export interface WorktreeHandle {
  path: string;
  variant: BenchmarkVariant;
  index: number;
}

function git(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function resolveRepoRoot(repoPath: string, cwd = process.cwd()): string {
  return resolve(cwd, repoPath);
}

/**
 * Copy the fixture into a disposable git origin under the bench root.
 * Avoids creating a nested `.git` inside the Cursory checkout.
 */
export function materializeOriginRepo(
  sourceRepo: string,
  benchRoot: string,
  commit: string,
): { originRoot: string; commitSha: string } {
  if (!existsSync(sourceRepo)) {
    throw new Error(`Benchmark repo not found: ${sourceRepo}`);
  }

  const originRoot = join(benchRoot, "_origin");
  mkdirSync(benchRoot, { recursive: true });
  if (existsSync(originRoot)) {
    rmSync(originRoot, { recursive: true, force: true });
  }

  const sourceGit = join(sourceRepo, ".git");
  if (existsSync(sourceGit)) {
    // Local clone preserves history so `commit` pins work.
    execFileSync("git", ["clone", "--local", sourceRepo, originRoot], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    cpSync(sourceRepo, originRoot, {
      recursive: true,
      filter: (src) => {
        const rel = src.slice(sourceRepo.length).replace(/\\/g, "/");
        return !rel.includes("/node_modules") && !rel.includes("/.git");
      },
    });
    git(originRoot, ["init"]);
    git(originRoot, ["config", "user.email", "bench@cursory.local"]);
    git(originRoot, ["config", "user.name", "Cursory Bench"]);
    git(originRoot, ["add", "-A"]);
    git(originRoot, ["commit", "-m", "benchmark fixture baseline"]);
  }

  if (commit.trim()) {
    git(originRoot, ["rev-parse", "--verify", commit]);
    const commitSha = git(originRoot, ["rev-parse", commit]);
    git(originRoot, ["checkout", "--detach", commitSha]);
    return { originRoot, commitSha };
  }

  return {
    originRoot,
    commitSha: git(originRoot, ["rev-parse", "HEAD"]),
  };
}

export function createBenchRoot(baseDir?: string): string {
  const parent = baseDir?.trim()
    ? resolve(baseDir)
    : join(tmpdir(), "cursory-bench");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, "run-"));
}

export function addWorktree(
  repoRoot: string,
  commitSha: string,
  benchRoot: string,
  variant: BenchmarkVariant,
  index: number,
): WorktreeHandle {
  const path = join(
    benchRoot,
    `${variant}-${String(index).padStart(2, "0")}`,
  );
  mkdirSync(benchRoot, { recursive: true });
  git(repoRoot, ["worktree", "add", "--detach", path, commitSha]);
  return { path, variant, index };
}

export function removeWorktree(repoRoot: string, handle: WorktreeHandle): void {
  try {
    git(repoRoot, ["worktree", "remove", "--force", handle.path]);
  } catch {
    try {
      rmSync(handle.path, { recursive: true, force: true });
      git(repoRoot, ["worktree", "prune"]);
    } catch {
      // best-effort cleanup
    }
  }
}

export function writeVariantMcpConfig(
  worktreePath: string,
  variant: BenchmarkVariant,
  pluginRoot: string,
): void {
  const cursorDir = join(worktreePath, ".cursor");
  mkdirSync(cursorDir, { recursive: true });
  if (variant === "baseline") {
    // No Cursory MCP tools on the baseline arm.
    writeFileSync(
      join(cursorDir, "mcp.json"),
      `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
      "utf8",
    );
    return;
  }

  const entry = join(pluginRoot, "dist", "index.js");
  writeFileSync(
    join(cursorDir, "mcp.json"),
    `${JSON.stringify(
      {
        mcpServers: {
          cursory: {
            command: "node",
            args: [entry],
            env: {
              CURSORY_ENABLED: "1",
              CURSORY_WORKSPACE: worktreePath,
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

export function resolvePluginRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (env.CURSOR_PLUGIN_ROOT?.trim()) return env.CURSOR_PLUGIN_ROOT.trim();
  if (env.CURSORY_PLUGIN_ROOT?.trim()) return env.CURSORY_PLUGIN_ROOT.trim();
  const home = env.USERPROFILE ?? env.HOME ?? "";
  const local = join(home, ".cursor", "plugins", "local", "cursory");
  if (existsSync(join(local, "dist", "index.js"))) return local;
  // Fall back to this repo (dev).
  return resolve(process.cwd());
}
