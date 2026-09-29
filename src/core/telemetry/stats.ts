import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type StatsCategory =
  | "read"
  | "search"
  | "terminal"
  | "diff"
  | "workspace"
  | "duplicate";

export interface CategoryCounters {
  estimatedRawTokens: number;
  estimatedDeliveredTokens: number;
  rawBytes: number;
  deliveredBytes: number;
  calls: number;
}

export interface SessionStatsSnapshot {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  workspaceRoot: string;
  categories: Record<StatsCategory, CategoryCounters>;
  cacheHits: number;
  cacheMisses: number;
  smartReads: number;
  smartSearches: number;
  terminalCommands: number;
  rawExpansions: number;
  duplicateBytesAvoided: number;
}

function emptyCategory(): CategoryCounters {
  return {
    estimatedRawTokens: 0,
    estimatedDeliveredTokens: 0,
    rawBytes: 0,
    deliveredBytes: 0,
    calls: 0,
  };
}

export function createEmptySnapshot(
  sessionId: string,
  workspaceRoot: string,
): SessionStatsSnapshot {
  return {
    sessionId,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    workspaceRoot,
    categories: {
      read: emptyCategory(),
      search: emptyCategory(),
      terminal: emptyCategory(),
      diff: emptyCategory(),
      workspace: emptyCategory(),
      duplicate: emptyCategory(),
    },
    cacheHits: 0,
    cacheMisses: 0,
    smartReads: 0,
    smartSearches: 0,
    terminalCommands: 0,
    rawExpansions: 0,
    duplicateBytesAvoided: 0,
  };
}

export function totalsFromSnapshot(snapshot: SessionStatsSnapshot): {
  estimatedRawTokens: number;
  estimatedDeliveredTokens: number;
  estimatedAvoided: number;
  estimatedRegression: number;
  reductionPercent: number | null;
} {
  let estimatedRawTokens = 0;
  let estimatedDeliveredTokens = 0;
  for (const cat of Object.values(snapshot.categories)) {
    estimatedRawTokens += cat.estimatedRawTokens;
    estimatedDeliveredTokens += cat.estimatedDeliveredTokens;
  }
  const estimatedAvoided = Math.max(0, estimatedRawTokens - estimatedDeliveredTokens);
  const estimatedRegression = Math.max(
    0,
    estimatedDeliveredTokens - estimatedRawTokens,
  );
  const reductionPercent =
    estimatedRawTokens === 0 ? null : (estimatedAvoided / estimatedRawTokens) * 100;
  return {
    estimatedRawTokens,
    estimatedDeliveredTokens,
    estimatedAvoided,
    estimatedRegression,
    reductionPercent,
  };
}

/** OS-local Cursory data root (metrics/cache later). */
export function getCursoryDataDir(): string {
  const override = process.env.CURSORY_DATA_DIR;
  if (override && override.trim()) {
    return override.trim();
  }
  const home = homedir();
  switch (process.platform) {
    case "win32":
      return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "cursory");
    case "darwin":
      return join(home, "Library", "Application Support", "cursory");
    default:
      return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "cursory");
  }
}

export function ensureDataDir(): string {
  const dir = getCursoryDataDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}
