import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureDataDir } from "./stats.js";

export interface LiveEvalEvent {
  ts: string;
  tool: string;
  capped: boolean;
  applied: boolean;
  path?: string;
  pattern?: string;
  command?: string;
  offset?: number;
  limit?: number;
}

export interface LiveEvalSummary {
  total: number;
  capped: number;
  applied: number;
  reads: number;
  greps: number;
  shells: number;
  mcp: number;
  offsetFollowups: number;
}

const MAX_BYTES = 8 * 1024 * 1024;

export function liveEvalLogPath(): string {
  return join(ensureDataDir(), "live-eval.jsonl");
}

export function liveEvalEventFromHook(
  input: { tool_name?: unknown; tool_input?: unknown },
  output: { updated_input?: Record<string, unknown> },
  applied: boolean,
): LiveEvalEvent {
  const tool = typeof input.tool_name === "string" ? input.tool_name : "";
  const toolInput =
    input.tool_input && typeof input.tool_input === "object" && !Array.isArray(input.tool_input)
      ? (input.tool_input as Record<string, unknown>)
      : {};
  const merged = { ...toolInput, ...(output.updated_input ?? {}) };
  const path = firstString(merged, ["path", "file_path", "filePath"]);
  const pattern = firstString(merged, ["pattern", "query"]);
  const command = firstString(merged, ["command"]);
  const offset = firstNumber(merged, ["offset"]);
  const limit = firstNumber(merged, ["limit", "headLimit", "head_limit"]);
  return {
    ts: new Date().toISOString(),
    tool,
    capped: Boolean(output.updated_input),
    applied,
    ...(path ? { path } : {}),
    ...(pattern ? { pattern } : {}),
    ...(command ? { command } : {}),
    ...(offset !== undefined ? { offset } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

export function appendLiveEvalEvent(event: LiveEvalEvent): void {
  try {
    const dir = ensureDataDir();
    mkdirSync(dir, { recursive: true });
    const path = liveEvalLogPath();
    try {
      if (statSync(path).size > MAX_BYTES) {
        renameSync(path, `${path}.1`);
      }
    } catch {
      // first write
    }
    appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
  } catch {
    // fail open — live eval must never break the agent
  }
}

export function parseLiveEvalLines(text: string): LiveEvalEvent[] {
  const events: LiveEvalEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as LiveEvalEvent);
    } catch {
      // skip junk
    }
  }
  return events;
}

export function summarizeLiveEval(events: LiveEvalEvent[]): LiveEvalSummary {
  let capped = 0;
  let applied = 0;
  let reads = 0;
  let greps = 0;
  let shells = 0;
  let mcp = 0;
  const lastOffset = new Map<string, number>();
  let offsetFollowups = 0;

  for (const event of events) {
    const name = event.tool.toLowerCase().replace(/[\s_-]/g, "");
    if (event.capped) capped += 1;
    if (event.applied) applied += 1;
    if (name.includes("cursory") || name.startsWith("mcp")) mcp += 1;
    else if (name.includes("grep") || name === "rg") greps += 1;
    else if (name.startsWith("read")) reads += 1;
    else if (name.includes("shell") || name === "bash" || name === "terminal") shells += 1;

    if (name.startsWith("read") && event.path) {
      const offset = event.offset ?? 1;
      const prev = lastOffset.get(event.path);
      if (prev !== undefined && offset > prev) offsetFollowups += 1;
      lastOffset.set(event.path, offset);
    }
  }

  return {
    total: events.length,
    capped,
    applied,
    reads,
    greps,
    shells,
    mcp,
    offsetFollowups,
  };
}

export function formatLiveEvalSummary(summary: LiveEvalSummary): string {
  const lines = [
    "CURSORY LIVE EVAL",
    "────────────────────────────────",
    `Tool calls logged     ${summary.total}`,
    `Native caps proposed  ${summary.capped}`,
    `Native caps applied   ${summary.applied}`,
    `Reads / Greps / Shell ${summary.reads} / ${summary.greps} / ${summary.shells}`,
    `Cursory MCP calls     ${summary.mcp}`,
    `Read offset follow-ups ${summary.offsetFollowups}`,
    "",
    "offset follow-ups = same file read again at a later offset (retry tax).",
    "MCP calls staying at 0 means the model ignored smart_* and used native tools.",
  ];
  return lines.join("\n");
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
