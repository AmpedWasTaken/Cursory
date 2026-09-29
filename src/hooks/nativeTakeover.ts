import { statSync } from "node:fs";
import { resolve } from "node:path";
import { prefersExactTail } from "../core/indexing/fileClassifier.js";
import { getCapLimits, type CapLimits } from "./capLimits.js";

/** @deprecated Prefer getCapLimits(). Kept for test imports. */
export const SMALL_FILE_BYTES = getCapLimits("balanced").smallFileBytes;
/** @deprecated Prefer getCapLimits(). */
export const READ_LINE_LIMIT = getCapLimits("balanced").readLineLimit;
/** @deprecated Prefer getCapLimits(). */
export const GREP_HEAD_LIMIT = getCapLimits("balanced").grepHeadLimit;
/** @deprecated Prefer getCapLimits(). */
export const SHELL_LINE_LIMIT = getCapLimits("balanced").shellLineLimit;

export interface FileStatLike {
  size: number;
}

export interface NativeTakeoverDeps {
  statSync: (path: string) => FileStatLike;
  limits?: CapLimits;
}

export interface PreToolUseInput {
  tool_name?: unknown;
  tool_input?: unknown;
  cwd?: unknown;
}

export type PreToolUseOutput = Record<string, unknown> & {
  permission: "allow";
  updated_input?: Record<string, unknown>;
};

const DEFAULT_DEPS: NativeTakeoverDeps = { statSync };

export function optimizeNativeTool(
  input: PreToolUseInput,
  deps: NativeTakeoverDeps = DEFAULT_DEPS,
): PreToolUseOutput {
  const toolName = normalizeToolName(input.tool_name);
  const toolInput = asRecord(input.tool_input);
  if (!toolName || !toolInput) {
    return { permission: "allow" };
  }
  if (toolName.includes("cursory") || toolName.startsWith("mcp:")) {
    return { permission: "allow" };
  }

  const limits = deps.limits ?? getCapLimits();
  const cwd =
    typeof input.cwd === "string" && input.cwd.trim()
      ? input.cwd.trim()
      : undefined;

  if (toolName === "read") {
    return allowMaybeUpdated(
      toolInput,
      optimizeRead(toolInput, cwd, deps, limits),
    );
  }
  if (toolName === "grep") {
    return allowMaybeUpdated(toolInput, optimizeGrep(toolInput, limits));
  }
  if (toolName === "shell") {
    return allowMaybeUpdated(toolInput, optimizeShell(toolInput, limits));
  }
  if (toolName === "glob" || toolName === "listdir") {
    return allowMaybeUpdated(toolInput, optimizeGlob(toolInput, limits));
  }

  return { permission: "allow" };
}

function allowMaybeUpdated(
  original: Record<string, unknown>,
  next: Record<string, unknown> | undefined,
): PreToolUseOutput {
  if (!next) return { permission: "allow" };
  return { permission: "allow", updated_input: { ...original, ...next } };
}

export function normalizeToolName(value: unknown): string {
  if (typeof value !== "string") return "";
  const compact = value
    .trim()
    .replace(/^MCP:\s*/i, "")
    .replace(/ToolCall$/i, "")
    .toLowerCase()
    .replace(/[\s_-]/g, "");
  if (compact.includes("cursory") || compact.startsWith("mcp")) {
    return `mcp:${compact}`;
  }
  if (compact.includes("grep") || compact === "rg") return "grep";
  if (compact.startsWith("read")) return "read";
  if (
    compact.includes("shell") ||
    compact === "bash" ||
    compact === "terminal"
  ) {
    return "shell";
  }
  if (compact.includes("glob") || compact === "findfiles") return "glob";
  if (compact.includes("listdir") || compact === "ls") return "listdir";
  return compact;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function optimizeRead(
  toolInput: Record<string, unknown>,
  cwd: string | undefined,
  deps: NativeTakeoverDeps,
  limits: CapLimits,
): Record<string, unknown> | undefined {
  const path = firstString(toolInput, ["path", "file_path", "filePath"]);
  if (!path) return undefined;

  const abs = resolvePath(path, cwd);
  let size = 0;
  try {
    size = deps.statSync(abs).size;
  } catch {
    return undefined;
  }

  const existingLimit = firstNumber(toolInput, [
    "limit",
    "line_limit",
    "lineLimit",
  ]);
  const updates: Record<string, unknown> = {};

  if (size <= limits.smallFileBytes) {
    // Tiny targeted reads stay native — but clamp absurd explicit limits.
    if (
      existingLimit !== undefined &&
      existingLimit > limits.readLineLimit * 2
    ) {
      updates.limit = limits.readLineLimit;
      return updates;
    }
    return undefined;
  }

  if (existingLimit !== undefined) {
    if (existingLimit > limits.readLineLimit) {
      updates.limit = limits.readLineLimit;
      return updates;
    }
    return undefined;
  }

  if (prefersExactTail(path)) {
    updates.offset = -limits.readLineLimit;
    updates.limit = limits.readLineLimit;
    return updates;
  }

  updates.limit = limits.readLineLimit;
  return updates;
}

function optimizeGrep(
  toolInput: Record<string, unknown>,
  limits: CapLimits,
): Record<string, unknown> | undefined {
  const mode = firstString(toolInput, [
    "outputMode",
    "output_mode",
  ])?.toLowerCase();
  if (mode === "count" || mode === "files_with_matches") {
    return undefined;
  }

  const updates: Record<string, unknown> = {};
  let changed = false;

  const existing = firstNumber(toolInput, ["headLimit", "head_limit"]);
  const headKey =
    "headLimit" in toolInput
      ? "headLimit"
      : "head_limit" in toolInput
        ? "head_limit"
        : "headLimit";
  if (existing === undefined || existing > limits.grepHeadLimit) {
    updates[headKey] = limits.grepHeadLimit;
    changed = true;
  }

  for (const key of ["context", "before", "after", "contextBefore", "contextAfter"]) {
    const value = firstNumber(toolInput, [key]);
    if (value !== undefined && value > limits.grepContextMax) {
      updates[key] = limits.grepContextMax;
      changed = true;
    }
  }

  return changed ? updates : undefined;
}

function optimizeGlob(
  toolInput: Record<string, unknown>,
  limits: CapLimits,
): Record<string, unknown> | undefined {
  // Cursor Glob often accepts head_limit / limit — clamp floods.
  const existing = firstNumber(toolInput, [
    "head_limit",
    "headLimit",
    "limit",
    "max_results",
    "maxResults",
  ]);
  const max = Math.max(limits.grepHeadLimit, 30);
  if (existing !== undefined && existing <= max) return undefined;

  if ("head_limit" in toolInput) return { head_limit: max };
  if ("headLimit" in toolInput) return { headLimit: max };
  if ("max_results" in toolInput) return { max_results: max };
  if ("maxResults" in toolInput) return { maxResults: max };
  return { head_limit: max };
}

function optimizeShell(
  toolInput: Record<string, unknown>,
  limits: CapLimits,
): Record<string, unknown> | undefined {
  const command = firstString(toolInput, ["command"]);
  if (!command) return undefined;
  const bounded =
    boundDumpCommand(command, limits.shellLineLimit) ??
    boundNoisyShellCommand(command, limits.shellLineLimit);
  if (!bounded || bounded === command) return undefined;
  return { command: bounded };
}

export function boundDumpCommand(
  command: string,
  shellLineLimit = getCapLimits().shellLineLimit,
): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  if (/[|;&]/.test(trimmed)) return undefined;
  if (/\b(-TotalCount|-Head|-First|-Tail)\b/i.test(trimmed)) return undefined;
  if (/\bhead\s+-n\b/i.test(trimmed) || /\btail\s+-n\b/i.test(trimmed)) {
    return undefined;
  }

  const dump = /^(?:cat|type|Get-Content|gc)(?:\.exe)?\s+(.+)$/i.exec(trimmed);
  if (!dump?.[1]) return undefined;
  const target = dump[1].trim();
  if (!target || /^-/.test(target)) return undefined;

  const tail = prefersExactTail(target.replace(/^['"]|['"]$/g, ""));
  if (process.platform === "win32") {
    return tail
      ? `Get-Content -Tail ${shellLineLimit} ${target}`
      : `Get-Content -TotalCount ${shellLineLimit} ${target}`;
  }
  return tail
    ? `tail -n ${shellLineLimit} -- ${target}`
    : `head -n ${shellLineLimit} -- ${target}`;
}

/**
 * Bound high-volume exploration commands. Never wraps test/build runners —
 * those must keep real exit codes (use cursory_smart_run instead).
 */
export function boundNoisyShellCommand(
  command: string,
  shellLineLimit = getCapLimits().shellLineLimit,
): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  if (/[|;&]/.test(trimmed)) return undefined;

  // Already bounded.
  if (/\b(-n\s+\d+|head\s+-n|Select-Object\s+-First)\b/i.test(trimmed)) {
    return undefined;
  }

  const git = /^(git)(?:\.exe)?\s+(diff|log|show|blame)(\s+.*)?$/i.exec(
    trimmed,
  );
  if (git) {
    const sub = git[2]!.toLowerCase();
    const rest = (git[3] ?? "").trim();
    if (/\b--stat\b|\b--shortstat\b|\b-n\s*\d+|\b--max-count=/.test(rest)) {
      return undefined;
    }
    if (sub === "log") {
      return `git --no-pager log -n 20 --oneline ${rest}`.trim();
    }
    if (sub === "blame") {
      return undefined; // keep exact blame lines
    }
    // diff / show: no-pager + line cap via head (exploration, not test gate)
    return wrapLineCap(`git --no-pager ${sub} ${rest}`.trim(), shellLineLimit);
  }

  if (
    /^(find|tree|fd|ls|dir|Get-ChildItem)(?:\.exe)?\b/i.test(trimmed) &&
    /\s(-R|--recursive|-r\b)/i.test(trimmed)
  ) {
    return wrapLineCap(trimmed, shellLineLimit);
  }

  if (/^(find|tree)(?:\.exe)?\b/i.test(trimmed)) {
    return wrapLineCap(trimmed, shellLineLimit);
  }

  return undefined;
}

function wrapLineCap(command: string, lines: number): string {
  if (process.platform === "win32") {
    return `${command} 2>&1 | Select-Object -First ${lines}`;
  }
  return `${command} 2>&1 | head -n ${lines}`;
}

function resolvePath(path: string, cwd?: string): string {
  if (!cwd) return resolve(path);
  return resolve(cwd, path);
}

function firstString(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(
  record: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}
