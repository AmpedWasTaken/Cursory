import type {
  ContextBreakdown,
  LifetimeStats,
  OptimizationRecord,
  PersistedStats,
  SessionStats,
} from "./models.js";

export const HISTORY_LIMIT = 50;

const emptyBreakdown = (): ContextBreakdown => ({
  currentPrompt: 0,
  recentConversation: 0,
  historicalSummary: 0,
  projectContext: 0,
  instructions: 0,
  metadata: 0,
});

const finite = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;

const percent = (saved: number, baseline: number): number =>
  baseline > 0 ? (saved / baseline) * 100 : 0;

export function createEmptySession(now = Date.now()): SessionStats {
  return {
    requestsSeen: 0,
    requestsOptimized: 0,
    requestsBypassed: 0,
    baselineTokens: 0,
    optimizedTokens: 0,
    tokensSaved: 0,
    reductionPercent: 0,
    duplicateTokensRemoved: 0,
    irrelevantTokensRemoved: 0,
    sessionStartedAt: now,
  };
}

export function createEmptyLifetime(): LifetimeStats {
  return {
    requestsOptimized: 0,
    baselineTokens: 0,
    optimizedTokens: 0,
    tokensSaved: 0,
    reductionPercent: 0,
  };
}

export function createEmptyStats(now = Date.now()): PersistedStats {
  return {
    version: 1,
    session: createEmptySession(now),
    lifetime: createEmptyLifetime(),
    history: [],
  };
}

export type OptimizationRecordInput = Omit<
  OptimizationRecord,
  "tokensSaved" | "reductionPercent" | "promptPreview"
> & {
  promptPreview: string;
  tokensSaved?: number;
  reductionPercent?: number;
};

export function normalizeRecord(input: OptimizationRecordInput): OptimizationRecord {
  const baselineTokens = finite(input.baselineTokens);
  const attemptedOptimizedTokens = finite(input.attemptedOptimizedTokens ?? input.optimizedTokens);
  const regressionRejected =
    input.regressionRejected === true || attemptedOptimizedTokens > baselineTokens;
  const bypassed = input.bypassed || regressionRejected;
  const optimizedTokens = bypassed ? baselineTokens : finite(input.optimizedTokens);
  const tokensSaved = bypassed ? 0 : Math.max(0, baselineTokens - optimizedTokens);

  return {
    ...input,
    id: String(input.id),
    timestamp: finite(input.timestamp) || Date.now(),
    promptPreview: input.promptPreview.trim().slice(0, 120),
    baselineTokens,
    optimizedTokens,
    tokensSaved,
    reductionPercent: percent(tokensSaved, baselineTokens),
    duplicateTokensRemoved: finite(input.duplicateTokensRemoved),
    irrelevantTokensRemoved: finite(input.irrelevantTokensRemoved),
    compressionSavings: finite(input.compressionSavings),
    bypassed,
    regressionRejected,
    attemptedOptimizedTokens: regressionRejected
      ? attemptedOptimizedTokens
      : input.attemptedOptimizedTokens,
    contextBreakdown: {
      ...emptyBreakdown(),
      ...Object.fromEntries(
        Object.entries(input.contextBreakdown ?? {}).map(([key, value]) => [key, finite(value)]),
      ),
    },
    relevantFiles: Array.isArray(input.relevantFiles) ? input.relevantFiles : [],
    latencyMs: finite(input.latencyMs),
  };
}

export function addRecord(current: PersistedStats, input: OptimizationRecordInput): PersistedStats {
  const record = normalizeRecord(input);
  const optimized = !record.bypassed && record.tokensSaved > 0;
  const session = {
    ...current.session,
    requestsSeen: current.session.requestsSeen + 1,
    requestsOptimized: current.session.requestsOptimized + (optimized ? 1 : 0),
    requestsBypassed: current.session.requestsBypassed + (record.bypassed ? 1 : 0),
    baselineTokens: current.session.baselineTokens + record.baselineTokens,
    optimizedTokens: current.session.optimizedTokens + record.optimizedTokens,
    tokensSaved: current.session.tokensSaved + record.tokensSaved,
    duplicateTokensRemoved: current.session.duplicateTokensRemoved + record.duplicateTokensRemoved,
    irrelevantTokensRemoved:
      current.session.irrelevantTokensRemoved + record.irrelevantTokensRemoved,
  };
  session.reductionPercent = percent(session.tokensSaved, session.baselineTokens);

  const lifetime = {
    ...current.lifetime,
    requestsOptimized: current.lifetime.requestsOptimized + (optimized ? 1 : 0),
    baselineTokens: current.lifetime.baselineTokens + record.baselineTokens,
    optimizedTokens: current.lifetime.optimizedTokens + record.optimizedTokens,
    tokensSaved: current.lifetime.tokensSaved + record.tokensSaved,
  };
  lifetime.reductionPercent = percent(lifetime.tokensSaved, lifetime.baselineTokens);

  return {
    version: 1,
    session,
    lifetime,
    history: [record, ...current.history.filter((item) => item.id !== record.id)].slice(
      0,
      HISTORY_LIMIT,
    ),
  };
}

export function recoverStats(value: unknown, now = Date.now()): PersistedStats {
  if (!value || typeof value !== "object") return createEmptyStats(now);
  const candidate = value as Partial<PersistedStats>;
  if (!candidate.session || !candidate.lifetime || !Array.isArray(candidate.history)) {
    return createEmptyStats(now);
  }

  const recovered = createEmptyStats(now);
  for (const raw of candidate.history.slice().reverse()) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as OptimizationRecord;
    if (typeof item.id !== "string" || typeof item.promptPreview !== "string") continue;
    try {
      const normalized = normalizeRecord(item);
      recovered.history.unshift(normalized);
    } catch {
      // Ignore malformed local records rather than breaking the extension host.
    }
  }
  recovered.history = recovered.history.slice(0, HISTORY_LIMIT);

  const session = candidate.session as Partial<SessionStats>;
  recovered.session = {
    requestsSeen: finite(session.requestsSeen),
    requestsOptimized: finite(session.requestsOptimized),
    requestsBypassed: finite(session.requestsBypassed),
    baselineTokens: finite(session.baselineTokens),
    optimizedTokens: finite(session.optimizedTokens),
    tokensSaved: finite(session.tokensSaved),
    reductionPercent: finite(session.reductionPercent),
    duplicateTokensRemoved: finite(session.duplicateTokensRemoved),
    irrelevantTokensRemoved: finite(session.irrelevantTokensRemoved),
    sessionStartedAt: finite(session.sessionStartedAt) || now,
  };
  const lifetime = candidate.lifetime as Partial<LifetimeStats>;
  recovered.lifetime = {
    requestsOptimized: finite(lifetime.requestsOptimized),
    baselineTokens: finite(lifetime.baselineTokens),
    optimizedTokens: finite(lifetime.optimizedTokens),
    tokensSaved: finite(lifetime.tokensSaved),
    reductionPercent: finite(lifetime.reductionPercent),
  };
  return recovered;
}

export function formatCompactTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens));
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}K`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

export function statusBarText(
  display: "name" | "percent" | "saved" | "hidden",
  status: "active" | "idle" | "optimizing" | "bypassed" | "error" | "off",
  session: SessionStats,
): string {
  if (display === "hidden") return "";
  if (status === "off") return "Cursory · Off";
  if (status === "optimizing") return "Cursory · Optimizing…";
  if (status === "bypassed") return "Cursory · Bypass";
  if (status === "error") return "Cursory · Error";
  if (display === "name") return "Cursory";
  if (display === "saved") return `Cursory · ${formatCompactTokens(session.tokensSaved)} saved`;
  return `Cursory · ${Math.round(session.reductionPercent)}%`;
}
