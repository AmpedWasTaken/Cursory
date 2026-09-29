import type { BenchmarkMetrics, BenchmarkVariant } from "../liveRunSchema.js";

export interface BenchmarkTaskDef {
  id: string;
  label?: string;
  /** Path relative to Cursory repo root, or absolute. */
  repo: string;
  /** Fixed starting commit SHA (or short SHA). Empty = current HEAD after ensure. */
  commit: string;
  model: string;
  prompt: string;
  verification?: {
    command: string;
    /** Milliseconds before verification is killed. */
    timeoutMs?: number;
  };
  /** Optional substring that must appear in the agent result text. */
  expectText?: string;
  runs: number;
}

export interface AgentCliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ParsedAgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  durationMs?: number;
  sessionId?: string;
  resultText?: string;
  /** How token fields were obtained. */
  metricsSource:
    | "agent-usage"
    | "stream-json-estimate"
    | "duration-only"
    | "dry-run";
  toolCalls: number;
  readChars: number;
}

export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
  patch: string;
}

export interface VerificationResult {
  command: string;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface AgentRunRecord {
  variant: BenchmarkVariant;
  index: number;
  worktree: string;
  timestamp: string;
  success: boolean;
  durationMs: number;
  metrics: BenchmarkMetrics;
  metricsSource: ParsedAgentUsage["metricsSource"];
  verification?: VerificationResult;
  diff: DiffStat;
  agent: {
    exitCode: number | null;
    sessionId?: string;
    timedOut: boolean;
    toolCalls: number;
  };
  error?: string;
}

export interface AgentBenchmarkReport {
  schemaVersion: 1;
  task: BenchmarkTaskDef;
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  environment: {
    editor: string;
    cursoryVersion: string;
    agentBinary: string;
  };
  runs: AgentRunRecord[];
  summary: {
    baseline: VariantSummary;
    cursory: VariantSummary;
    change: {
      inputTokensPercent: number;
      outputTokensPercent: number;
      cacheReadTokensPercent: number;
      durationPercent: number;
    };
  };
}

export interface VariantSummary {
  runs: number;
  successRate: number;
  median: BenchmarkMetrics;
  average: BenchmarkMetrics;
}
