import { loadConfig, resolveBudget } from "../../core/config/config.js";
import { truncateToBudget } from "../../core/output/tokenBudget.js";
import {
  listRecentRawResults,
  loadRawCombined,
  loadRawMeta,
} from "../../core/output/rawStore.js";
import { estimateTokensFromText } from "../../core/telemetry/estimator.js";
import {
  ensureSessionStats,
  recordRawExpansion,
} from "../../core/telemetry/sessionStats.js";

export interface GetRawOptions {
  workspaceRoot: string;
  resultId?: string;
  startLine?: number;
  endLine?: number;
  search?: string;
  maxTokens?: number;
}

export interface GetRawResult {
  text: string;
  resultId: string;
  found: boolean;
  estimatedRawTokens: number;
  estimatedDeliveredTokens: number;
}

export function buildGetRaw(options: GetRawOptions): GetRawResult {
  ensureSessionStats(options.workspaceRoot);
  const config = loadConfig(options.workspaceRoot);
  const maxTokens = resolveBudget(config, "read", options.maxTokens);

  if (!options.resultId?.trim()) {
    const recent = listRecentRawResults(12);
    const lines = [
      "recent stored raw results (exact, local; not summarized):",
      ...recent.map(
        (item) =>
          `${item.resultId}  ${item.mode}  ${item.totalLines} lines  ${item.command.slice(0, 80)}  expires ${item.expiresAt}`,
      ),
      recent.length === 0 ? "(none — run cursory_smart_run or a large smart_read first)" : "",
      'Pass result_id to expand a dump. Search with { result_id, search: "..." }.',
    ].filter((line) => line !== "");
    const text = truncateToBudget(lines.join("\n"), maxTokens);
    return {
      text,
      resultId: "",
      found: recent.length > 0,
      estimatedRawTokens: estimateTokensFromText(text).tokens,
      estimatedDeliveredTokens: estimateTokensFromText(text).tokens,
    };
  }

  const meta = loadRawMeta(options.resultId);
  const combined = loadRawCombined(options.resultId);
  if (!meta || combined === null) {
    return {
      text: [
        `raw_result_id: ${options.resultId}`,
        "Status: not found or expired.",
        "Raw terminal output is retained temporarily (see terminal.retainRawMinutes).",
        "Re-run cursory_smart_run if you still need the output.",
      ].join("\n"),
      resultId: options.resultId,
      found: false,
      estimatedRawTokens: 0,
      estimatedDeliveredTokens: 20,
    };
  }

  recordRawExpansion();

  const lines = combined.split(/\r?\n/);
  let selected = lines;
  let note = `full combined output (${lines.length} lines)`;

  if (options.search && options.search.trim()) {
    const q = options.search.trim().toLowerCase();
    const hits: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(q)) {
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 3);
        hits.push(`--- match at L${i + 1} ---`);
        for (let j = start; j < end; j++) {
          hits.push(`${String(j + 1).padStart(6, " ")}|${lines[j]}`);
        }
      }
    }
    selected = hits.length > 0 ? hits : [`(no matches for search: ${options.search})`];
    note = `search=${JSON.stringify(options.search)}`;
  } else if (options.startLine != null || options.endLine != null) {
    const start = Math.max(1, options.startLine ?? 1);
    const end = Math.min(lines.length, options.endLine ?? lines.length);
    selected = lines.slice(start - 1, end).map((l, idx) => {
      const n = start + idx;
      return `${String(n).padStart(6, " ")}|${l}`;
    });
    note = `lines ${start}-${end}`;
  } else {
    selected = lines.map((l, idx) => `${String(idx + 1).padStart(6, " ")}|${l}`);
  }

  const header = [
    `raw_result_id: ${meta.resultId}`,
    `command: ${meta.command}`,
    `exit: ${meta.exitCode}${meta.timedOut ? " (timed out)" : ""}`,
    `mode: ${meta.mode}`,
    `slice: ${note}`,
    `expires: ${meta.expiresAt}`,
    "",
  ];

  const rawTokens = estimateTokensFromText(combined).tokens;
  const candidate = truncateToBudget(
    [...header, ...selected].join("\n"),
    maxTokens,
  );
  const body =
    estimateTokensFromText(candidate).tokens <= rawTokens
      ? candidate
      : truncateToBudget(combined, maxTokens);
  const deliveredTokens = estimateTokensFromText(body).tokens;

  return {
    text: body,
    resultId: meta.resultId,
    found: true,
    estimatedRawTokens: rawTokens,
    estimatedDeliveredTokens: deliveredTokens,
  };
}
