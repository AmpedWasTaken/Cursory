import type { OptimizationStats } from "./ContextStats.js";

export interface ContextBreakdown {
  originalUserPrompt: number;
  recentConversation: number;
  historicalConversation: number;
  historicalSummary: number;
  workspaceContext: number;
  selectedFiles: number;
  codeSummaries: number;
  dependencyContext: number;
  cursoryInstructions: number;
  metadata: number;
  duplicateContextDetected: number;
  finalInjectedContext: number;
}

export interface ContextDebugReport {
  breakdown: ContextBreakdown;
  stats: OptimizationStats;
  generatedAt: string;
}

export function calculateContextBreakdown(
  partial: Partial<ContextBreakdown>,
): ContextBreakdown {
  return {
    originalUserPrompt: 0,
    recentConversation: 0,
    historicalConversation: 0,
    historicalSummary: 0,
    workspaceContext: 0,
    selectedFiles: 0,
    codeSummaries: 0,
    dependencyContext: 0,
    cursoryInstructions: 0,
    metadata: 0,
    duplicateContextDetected: 0,
    finalInjectedContext: 0,
    ...partial,
  };
}

export function formatContextDebugReport(report: ContextDebugReport): string {
  const b = report.breakdown;
  return [
    "Cursory Context Report",
    `Original prompt: ${b.originalUserPrompt}`,
    `Recent conversation: ${b.recentConversation}`,
    `Historical conversation: ${b.historicalConversation}`,
    `History summary: ${b.historicalSummary}`,
    `Workspace context: ${b.workspaceContext}`,
    `Selected files: ${b.selectedFiles}`,
    `Code summaries: ${b.codeSummaries}`,
    `Dependency context: ${b.dependencyContext}`,
    `Cursory instructions: ${b.cursoryInstructions}`,
    `Metadata: ${b.metadata}`,
    `Injected context: ${b.finalInjectedContext}`,
    `Potential duplicates: ${b.duplicateContextDetected}`,
    `Net useful context: ${Math.max(0, b.finalInjectedContext - b.duplicateContextDetected)}`,
    `Tokens saved: ${report.stats.tokensSaved}`,
    `Regression tokens: ${report.stats.regressionTokens}`,
  ].join("\n");
}
