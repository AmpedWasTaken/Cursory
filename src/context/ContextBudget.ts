import { DEFAULT_CONFIG } from "../core/config/config.js";
import { estimateTokens, truncateToTokens } from "./TokenEstimator.js";

export interface ContextBudgets {
  maxInjectedTokens: number;
  recentConversationBudget: number;
  historicalSummaryBudget: number;
  projectContextBudget: number;
  instructionsBudget: number;
  safetyMargin: number;
}

export const DEFAULT_CONTEXT_BUDGETS: ContextBudgets = {
  maxInjectedTokens: DEFAULT_CONFIG.context.maxInjectedTokens,
  recentConversationBudget:
    DEFAULT_CONFIG.context.recentConversationBudget,
  historicalSummaryBudget:
    DEFAULT_CONFIG.context.historicalSummaryBudget,
  projectContextBudget: DEFAULT_CONFIG.context.projectContextBudget,
  instructionsBudget: DEFAULT_CONFIG.context.instructionsBudget,
  safetyMargin: DEFAULT_CONFIG.context.safetyMargin,
};

export interface ContextCandidate {
  id: string;
  text: string;
  relevanceScore: number;
  kind: "recent" | "historical" | "project" | "instruction" | "metadata";
  sourceHash?: string;
  generatedByCursory?: boolean;
}

export interface SelectedCandidate extends ContextCandidate {
  estimatedTokens: number;
  roi: number;
}

function categoryLimit(
  budgets: ContextBudgets,
  kind: ContextCandidate["kind"],
): number {
  switch (kind) {
    case "recent":
      return budgets.recentConversationBudget;
    case "historical":
      return budgets.historicalSummaryBudget;
    case "project":
      return budgets.projectContextBudget;
    case "instruction":
      return budgets.instructionsBudget;
    case "metadata":
      return Math.min(100, budgets.instructionsBudget);
  }
}

/** Select highest signal-per-token candidates while enforcing every hard cap. */
export function selectByContextRoi(
  candidates: ContextCandidate[],
  budgets: ContextBudgets = DEFAULT_CONTEXT_BUDGETS,
): SelectedCandidate[] {
  const hardLimit = Math.max(
    0,
    budgets.maxInjectedTokens - budgets.safetyMargin,
  );
  const used = new Map<ContextCandidate["kind"], number>();
  let total = 0;
  const ranked = candidates
    .map((candidate) => {
      const estimatedTokens = estimateTokens(candidate.text);
      return {
        ...candidate,
        estimatedTokens,
        roi:
          estimatedTokens === 0
            ? candidate.relevanceScore
            : candidate.relevanceScore / estimatedTokens,
      };
    })
    .filter((candidate) => candidate.estimatedTokens > 0)
    .sort(
      (a, b) =>
        b.roi - a.roi ||
        b.relevanceScore - a.relevanceScore ||
        a.estimatedTokens - b.estimatedTokens,
    );

  const selected: SelectedCandidate[] = [];
  for (const candidate of ranked) {
    const categoryUsed = used.get(candidate.kind) ?? 0;
    const remainingCategory =
      categoryLimit(budgets, candidate.kind) - categoryUsed;
    const remainingTotal = hardLimit - total;
    const available = Math.min(remainingCategory, remainingTotal);
    if (available <= 0) continue;

    const text =
      candidate.estimatedTokens <= available
        ? candidate.text
        : truncateToTokens(candidate.text, available);
    const estimatedTokens = estimateTokens(text);
    if (!text || estimatedTokens <= 0) continue;
    selected.push({
      ...candidate,
      text,
      estimatedTokens,
      roi: candidate.relevanceScore / estimatedTokens,
    });
    used.set(candidate.kind, categoryUsed + estimatedTokens);
    total += estimatedTokens;
  }
  return selected;
}
