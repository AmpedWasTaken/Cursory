import { statSync } from "node:fs";
import { resolve } from "node:path";
import { prefersExactTail } from "../core/indexing/fileClassifier.js";

/** Match smartRead: files at or under this size stay on native Read unchanged. */
export const SMALL_FILE_BYTES = 12_000;
export const READ_LINE_LIMIT = 200;
export const GREP_HEAD_LIMIT = 40;
export const SHELL_LINE_LIMIT = 200;

export interface FileStatLike {
  size: number;
}

export interface NativeTakeoverDeps {
  statSync: (path: string) => FileStatLike;
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

  const cwd = typeof input.cwd === "string" && input.cwd.trim() ? input.cwd.trim() : undefined;

  if (toolName === "read") {
    return allowMaybeUpdated(toolInput, optimizeRead(toolInput, cwd, deps));
  }
  if (toolName === "grep") {
    return allowMaybeUpdated(toolInput, optimizeGrep(toolInput));
  }
  if (toolName === "shell") {
    return allowMaybeUpdated(toolInput, optimizeShell(toolInput));
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
  if (compact.includes("cursory") || compact.startsWith("mcp")) return `mcp:${compact}`;
  if (compact.includes("grep") || compact === "rg") return "grep";
  if (compact.startsWith("read")) return "read";
  if (compact.includes("shell") || compact === "bash" || compact === "terminal") return "shell";
  return compact;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function optimizeRead(
  toolInput: Record<string, unknown>,
  cwd: string | undefined,
  deps: NativeTakeoverDeps,
): Record<string, unknown> | undefined {
  if (hasPositiveNumber(toolInput, ["limit", "line_limit", "lineLimit"])) {
    return undefined;
  }
  const path = firstString(toolInput, ["path", "file_path", "filePath"]);
  if (!path) return undefined;

  const abs = resolvePath(path, cwd);
  let size = 0;
  try {
    size = deps.statSync(abs).size;
  } catch {
    return undefined;
  }
  if (size <= SMALL_FILE_BYTES) return undefined;

  if (prefersExactTail(path)) {
    return { offset: -READ_LINE_LIMIT, limit: READ_LINE_LIMIT };
  }

  return { limit: READ_LINE_LIMIT };
}

function optimizeGrep(toolInput: Record<string, unknown>): Record<string, unknown> | undefined {
  const mode = firstString(toolInput, ["outputMode", "output_mode"])?.toLowerCase();
  if (mode === "count" || mode === "files_with_matches") {
    return undefined;
  }
  const existing = firstNumber(toolInput, ["headLimit", "head_limit"]);
  if (existing !== undefined && existing <= GREP_HEAD_LIMIT) {
    return undefined;
  }
  const key = "headLimit" in toolInput ? "headLimit" : "head_limit" in toolInput ? "head_limit" : "headLimit";
  return { [key]: GREP_HEAD_LIMIT };
}

function optimizeShell(toolInput: Record<string, unknown>): Record<string, unknown> | undefined {
  const command = firstString(toolInput, ["command"]);
  if (!command) return undefined;
  const bounded = boundDumpCommand(command);
  if (!bounded || bounded === command) return undefined;
  return { command: bounded };
}

export function boundDumpCommand(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  if (/[|;&]/.test(trimmed)) return undefined;
  if (/\b(-TotalCount|-Head|-First|-Tail)\b/i.test(trimmed)) return undefined;
  if (/\bhead\s+-n\b/i.test(trimmed) || /\btail\s+-n\b/i.test(trimmed)) return undefined;

  const dump = /^(?:cat|type|Get-Content|gc)(?:\.exe)?\s+(.+)$/i.exec(trimmed);
  if (!dump?.[1]) return undefined;
  const target = dump[1].trim();
  if (!target || /^-/.test(target)) return undefined;

  const tail = prefersExactTail(target.replace(/^['"]|['"]$/g, ""));
  if (process.platform === "win32") {
    return tail
      ? `Get-Content -Tail ${SHELL_LINE_LIMIT} ${target}`
      : `Get-Content -TotalCount ${SHELL_LINE_LIMIT} ${target}`;
  }
  return tail
    ? `tail -n ${SHELL_LINE_LIMIT} -- ${target}`
    : `head -n ${SHELL_LINE_LIMIT} -- ${target}`;
}

function resolvePath(path: string, cwd?: string): string {
  if (!cwd) return resolve(path);
  return resolve(cwd, path);
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function hasPositiveNumber(record: Record<string, unknown>, keys: string[]): boolean {
  const value = firstNumber(record, keys);
  return value !== undefined && value > 0;
}
