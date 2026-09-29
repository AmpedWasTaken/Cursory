import { estimateTokensFromText } from "../../core/telemetry/estimator.js";
import type { ParsedAgentUsage } from "./types.js";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstNumber(
  obj: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  return undefined;
}

function extractUsage(obj: Record<string, unknown>): {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
} {
  const usage = asRecord(obj.usage) ?? asRecord(obj.token_usage) ?? obj;
  return {
    inputTokens: firstNumber(usage, [
      "inputTokens",
      "input_tokens",
      "promptTokens",
      "prompt_tokens",
    ]),
    outputTokens: firstNumber(usage, [
      "outputTokens",
      "output_tokens",
      "completionTokens",
      "completion_tokens",
    ]),
    cacheReadTokens: firstNumber(usage, [
      "cacheReadTokens",
      "cache_read_tokens",
      "cacheRead",
      "cache_read",
      "cachedTokens",
      "cached_tokens",
    ]),
  };
}

function readToolChars(event: Record<string, unknown>): number {
  const toolCall = asRecord(event.tool_call);
  if (!toolCall) return 0;
  const read = asRecord(toolCall.readToolCall);
  if (!read) return 0;
  const result = asRecord(read.result);
  const success = result ? asRecord(result.success) : null;
  if (!success) return 0;
  if (typeof success.totalChars === "number") return success.totalChars;
  if (typeof success.content === "string") return success.content.length;
  return 0;
}

/**
 * Parse `agent --output-format json|stream-json` stdout into duration + usage.
 * Token fields are optional in Cursor's documented JSON; we fall back to
 * estimating from tool-call read sizes in stream-json.
 */
export function parseAgentOutput(stdout: string): ParsedAgentUsage {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let sessionId: string | undefined;
  let resultText: string | undefined;
  let durationMs: number | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  let toolCalls = 0;
  let readChars = 0;
  let sawStream = false;

  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    sawStream = true;

    if (typeof event.session_id === "string") sessionId = event.session_id;

    if (event.type === "result") {
      if (typeof event.result === "string") resultText = event.result;
      if (typeof event.duration_ms === "number") durationMs = event.duration_ms;
      const usage = extractUsage(event);
      inputTokens ??= usage.inputTokens;
      outputTokens ??= usage.outputTokens;
      cacheReadTokens ??= usage.cacheReadTokens;
    }

    if (event.type === "tool_call") {
      if (event.subtype === "started") toolCalls += 1;
      if (event.subtype === "completed") readChars += readToolChars(event);
    }

    // Some builds may put usage on system/init or assistant events.
    const usage = extractUsage(event);
    inputTokens ??= usage.inputTokens;
    outputTokens ??= usage.outputTokens;
    cacheReadTokens ??= usage.cacheReadTokens;
  }

  // Single-object json mode (not NDJSON).
  if (!sawStream && stdout.trim()) {
    try {
      const event = JSON.parse(stdout) as Record<string, unknown>;
      if (typeof event.session_id === "string") sessionId = event.session_id;
      if (typeof event.result === "string") resultText = event.result;
      if (typeof event.duration_ms === "number") durationMs = event.duration_ms;
      const usage = extractUsage(event);
      inputTokens = usage.inputTokens;
      outputTokens = usage.outputTokens;
      cacheReadTokens = usage.cacheReadTokens;
    } catch {
      // leave unset
    }
  }

  if (
    inputTokens !== undefined ||
    outputTokens !== undefined ||
    cacheReadTokens !== undefined
  ) {
    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      durationMs,
      sessionId,
      resultText,
      metricsSource: "agent-usage",
      toolCalls,
      readChars,
    };
  }

  if (readChars > 0 || resultText) {
    const estimatedInput = estimateTokensFromText(
      "x".repeat(Math.max(0, readChars)),
    ).tokens;
    const estimatedOutput = estimateTokensFromText(resultText ?? "").tokens;
    return {
      inputTokens: estimatedInput,
      outputTokens: estimatedOutput,
      cacheReadTokens: 0,
      durationMs,
      sessionId,
      resultText,
      metricsSource: "stream-json-estimate",
      toolCalls,
      readChars,
    };
  }

  return {
    durationMs,
    sessionId,
    resultText,
    metricsSource: "duration-only",
    toolCalls,
    readChars,
  };
}
