export interface ScenarioResult {
  name: string;
  baselineTokens: number;
  cursoryTokens: number;
  taskSuccess: boolean;
  detail: string;
  relevantItemsRetained?: number;
  relevantItemsTotal?: number;
  latencyMs?: number;
}

export interface RecoverabilityCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface BenchmarkReport {
  scenarios: ScenarioResult[];
  recoverability: RecoverabilityCheck[];
  rawRecoverabilityPct: number;
  tasksPassed: number;
  tasksTotal: number;
  totalBaseline: number;
  totalCursory: number;
  totalAvoidedPct: number;
}

export function avoidedPct(baseline: number, delivered: number): number {
  if (baseline <= 0) return 0;
  return Math.max(0, ((baseline - delivered) / baseline) * 100);
}
