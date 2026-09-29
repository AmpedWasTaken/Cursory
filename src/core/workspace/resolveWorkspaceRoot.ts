import { existsSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const WORKSPACE_ENV_KEYS = [
  "CURSORY_WORKSPACE",
  "CURSOR_WORKSPACE",
  "CURSOR_PROJECT_DIR",
  "CURSOR_PROJECT_ROOT",
  "WORKSPACE_FOLDER",
] as const;

const PROJECT_MARKERS = [".git", "package.json", "pnpm-workspace.yaml", ".cursor"] as const;

export function isPluginInstallDir(dir: string): boolean {
  const normalized = dir.replace(/\\/g, "/").toLowerCase();
  return /\/\.cursor\/plugins\//.test(normalized);
}

export function isUsableWorkspace(dir: string): boolean {
  if (!dir.trim()) return false;
  const abs = resolve(dir.trim());
  if (isPluginInstallDir(abs)) return false;
  if (abs === "${workspaceFolder}" || abs.includes("${")) return false;
  return existsSync(abs);
}

export function findProjectRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (let i = 0; i < 24; i++) {
    if (isPluginInstallDir(dir)) return undefined;
    if (PROJECT_MARKERS.some((marker) => existsSync(resolve(dir, marker)))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function fromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const key of WORKSPACE_ENV_KEYS) {
    const value = env[key];
    if (value && isUsableWorkspace(value)) {
      return resolve(value.trim());
    }
  }
  return undefined;
}

function fromPathHint(pathHint?: string): string | undefined {
  if (!pathHint?.trim()) return undefined;
  const hint = pathHint.trim();
  if (!isAbsolute(hint) || !existsSync(hint)) return undefined;
  const start = statSync(hint).isDirectory() ? hint : dirname(hint);
  return findProjectRoot(start);
}

/**
 * Prefer the user's open project, never the Cursory plugin install directory.
 */
export function resolveWorkspaceRoot(
  explicit?: string,
  pathHint?: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): string {
  if (explicit?.trim() && isUsableWorkspace(explicit)) {
    return resolve(explicit.trim());
  }
  const hinted = fromPathHint(pathHint);
  if (hinted) return hinted;
  const envRoot = fromEnv(env);
  if (envRoot) return envRoot;
  if (isUsableWorkspace(cwd)) {
    return findProjectRoot(cwd) ?? resolve(cwd);
  }
  throw new Error(
    "Cursory could not resolve the user workspace (MCP cwd is the plugin install). Pass workspace_root as the folder Cursor has open.",
  );
}
