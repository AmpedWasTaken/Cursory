import { ensureSessionStats, getSessionStats } from "../../core/telemetry/sessionStats.js";
import {
  getCursoryDataDir,
  type SessionStatsSnapshot,
  type StatsCategory,
  totalsFromSnapshot,
} from "../../core/telemetry/stats.js";

const CATEGORY_LABELS: Record<StatsCategory, string> = {
  terminal: "Terminal noise",
  duplicate: "Duplicate content",
  workspace: "Repository exploration",
  read: "Source range filtering",
  search: "Search/file-tree output",
  diff: "Diff reduction",
};

export interface ContextStatsResult {
  text: string;
  hasActivity: boolean;
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString();
}

function fmtPct(n: number | null): string {
  if (n === null) return "n/a";
  return `${n.toFixed(1)}%`;
}

function categoryAvoided(
  snapshot: SessionStatsSnapshot,
): Array<{ label: string; avoided: number }> {
  const rows: Array<{ label: string; avoided: number }> = [];
  for (const [key, cat] of Object.entries(snapshot.categories) as Array<
    [StatsCategory, SessionStatsSnapshot["categories"][StatsCategory]]
  >) {
    const avoided = Math.max(0, cat.estimatedRawTokens - cat.estimatedDeliveredTokens);
    if (avoided > 0 || cat.calls > 0) {
      rows.push({ label: CATEGORY_LABELS[key], avoided });
    }
  }
  return rows.sort((a, b) => b.avoided - a.avoided);
}

function largestSave(snapshot: SessionStatsSnapshot): string {
  let best: { label: string; raw: number; delivered: number } | null = null;
  for (const [key, cat] of Object.entries(snapshot.categories) as Array<
    [StatsCategory, SessionStatsSnapshot["categories"][StatsCategory]]
  >) {
    if (cat.calls === 0) continue;
    if (
      !best ||
      cat.estimatedRawTokens - cat.estimatedDeliveredTokens > best.raw - best.delivered
    ) {
      best = {
        label: CATEGORY_LABELS[key],
        raw: cat.estimatedRawTokens,
        delivered: cat.estimatedDeliveredTokens,
      };
    }
  }
  if (!best || best.raw === 0) return "  (none yet)";
  const avoided = best.raw - best.delivered;
  const pct = (avoided / best.raw) * 100;
  return `  ${best.label}\n  ${fmt(best.raw)} → ${fmt(best.delivered)} tokens\n  ${pct.toFixed(1)}% avoided (estimate)`;
}

/**
 * Format local session stats for the Agent /cursory-stats command.
 * All token figures are estimates — not Cursor billing usage.
 */
export function buildContextStats(workspaceRoot: string): ContextStatsResult {
  let snapshot = getSessionStats();
  if (!snapshot) {
    snapshot = ensureSessionStats(workspaceRoot);
  }

  const totals = totalsFromSnapshot(snapshot);
  const cacheTotal = snapshot.cacheHits + snapshot.cacheMisses;
  const hitRate = cacheTotal === 0 ? null : (snapshot.cacheHits / cacheTotal) * 100;
  const byCat = categoryAvoided(snapshot);
  const hasActivity =
    totals.estimatedRawTokens > 0 ||
    snapshot.smartReads > 0 ||
    snapshot.smartSearches > 0 ||
    snapshot.terminalCommands > 0 ||
    snapshot.cacheHits > 0;

  const lines: string[] = [];
  lines.push("Cursory session");
  lines.push("──────────────────────────────────────");
  lines.push("");
  lines.push(`Workspace: ${snapshot.workspaceRoot}`);
  lines.push(`Session:   ${snapshot.sessionId.slice(0, 8)}…`);
  lines.push(`Local data: ${getCursoryDataDir()}`);
  lines.push("");
  lines.push("This session (estimates)");
  lines.push(`  Estimated context generated   ${fmt(totals.estimatedRawTokens)}`);
  lines.push(`  Delivered to Agent            ${fmt(totals.estimatedDeliveredTokens)}`);
  lines.push(`  Avoided                       ${fmt(totals.estimatedAvoided)}`);
  lines.push(`  Regression/increase           ${fmt(totals.estimatedRegression)}`);
  lines.push(`  Estimated reduction           ${fmtPct(totals.reductionPercent)}`);
  lines.push("");
  lines.push("By category (estimated avoided)");
  if (byCat.length === 0) {
    lines.push("  (no optimizations recorded yet in this MCP process)");
  } else {
    for (const row of byCat) {
      lines.push(`  ${row.label.padEnd(28)} ${fmt(row.avoided)}`);
    }
  }
  lines.push("");
  lines.push("Activity");
  lines.push(`  smart_search                      ${snapshot.smartSearches}`);
  lines.push(`  smart_read                        ${snapshot.smartReads}`);
  lines.push(`  terminal commands                 ${snapshot.terminalCommands}`);
  lines.push(`  raw expansions                    ${snapshot.rawExpansions}`);
  lines.push("");
  lines.push("Cache");
  lines.push(`  Hits                              ${snapshot.cacheHits}`);
  lines.push(`  Misses                            ${snapshot.cacheMisses}`);
  lines.push(`  Hit rate                          ${fmtPct(hitRate)}`);
  lines.push(`  Duplicate bytes avoided           ${fmt(snapshot.duplicateBytesAvoided)}`);
  lines.push("");
  lines.push("Largest save (estimate)");
  lines.push(largestSave(snapshot));
  lines.push("");
  lines.push("IMPORTANT");
  lines.push("  These are Cursory estimates, not Cursor billing tokens.");
  lines.push("  Stats live in this MCP process until restart; no external telemetry.");
  if (!hasActivity) {
    lines.push("");
    lines.push("Tip: use cursory_smart_search, smart_read, or smart_run first");
    lines.push("so this session has something to measure.");
  }

  return { text: lines.join("\n"), hasActivity };
}
