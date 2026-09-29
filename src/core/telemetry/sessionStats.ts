import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CategoryCounters,
  createEmptySnapshot,
  ensureDataDir,
  type SessionStatsSnapshot,
  type StatsCategory,
  totalsFromSnapshot,
} from "./stats.js";

let active: SessionStatsSnapshot | null = null;

export function startSessionStats(workspaceRoot: string, sessionId?: string): SessionStatsSnapshot {
  active = createEmptySnapshot(sessionId ?? randomUUID(), workspaceRoot);
  return active;
}

export function getSessionStats(): SessionStatsSnapshot | null {
  return active;
}

export function ensureSessionStats(workspaceRoot: string): SessionStatsSnapshot {
  if (!active || active.workspaceRoot !== workspaceRoot) {
    return startSessionStats(workspaceRoot);
  }
  return active;
}

export function recordOptimization(input: {
  category: StatsCategory;
  estimatedRawTokens: number;
  estimatedDeliveredTokens: number;
  rawBytes?: number;
  deliveredBytes?: number;
}): void {
  if (!active) {
    return;
  }
  const cat: CategoryCounters = active.categories[input.category];
  cat.estimatedRawTokens += Math.max(0, input.estimatedRawTokens);
  cat.estimatedDeliveredTokens += Math.max(0, input.estimatedDeliveredTokens);
  cat.rawBytes += Math.max(0, input.rawBytes ?? 0);
  cat.deliveredBytes += Math.max(0, input.deliveredBytes ?? 0);
  cat.calls += 1;
  active.updatedAt = new Date().toISOString();
}

export function recordCacheHit(): void {
  if (!active) return;
  active.cacheHits += 1;
  active.updatedAt = new Date().toISOString();
}

export function recordCacheMiss(): void {
  if (!active) return;
  active.cacheMisses += 1;
  active.updatedAt = new Date().toISOString();
}

export function recordSmartRead(): void {
  if (!active) return;
  active.smartReads += 1;
  active.updatedAt = new Date().toISOString();
}

export function recordSmartSearch(): void {
  if (!active) return;
  active.smartSearches += 1;
  active.updatedAt = new Date().toISOString();
}

export function recordDuplicateBytesAvoided(bytes: number): void {
  if (!active) return;
  active.duplicateBytesAvoided += Math.max(0, bytes);
  active.updatedAt = new Date().toISOString();
}

export function recordTerminalCommand(): void {
  if (!active) return;
  active.terminalCommands += 1;
  active.updatedAt = new Date().toISOString();
}

export function recordRawExpansion(): void {
  if (!active) return;
  active.rawExpansions += 1;
  active.updatedAt = new Date().toISOString();
}

export function persistSessionStats(): string | null {
  if (!active) {
    return null;
  }
  const dir = ensureDataDir();
  const path = join(dir, `session-${active.sessionId}.json`);
  const payload = {
    ...active,
    totals: totalsFromSnapshot(active),
    disclaimer:
      "Token numbers are estimates, not Cursor billing usage. No external telemetry was sent.",
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  return path;
}
