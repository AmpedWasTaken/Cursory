import { estimateTokensFromText } from "../telemetry/estimator.js";

export interface BudgetState {
  maxTokens: number;
  usedTokens: number;
}

export function createBudget(maxTokens: number): BudgetState {
  return { maxTokens, usedTokens: 0 };
}

export function remaining(budget: BudgetState): number {
  return Math.max(0, budget.maxTokens - budget.usedTokens);
}

export function canFit(budget: BudgetState, text: string): boolean {
  return estimateTokensFromText(text).tokens <= remaining(budget);
}

export function consume(budget: BudgetState, text: string): boolean {
  const cost = estimateTokensFromText(text).tokens;
  if (cost > remaining(budget)) {
    return false;
  }
  budget.usedTokens += cost;
  return true;
}

export function truncateToBudget(text: string, maxTokens: number): string {
  const estimate = estimateTokensFromText(text);
  if (estimate.tokens <= maxTokens) {
    return text;
  }
  const approxChars = Math.max(0, maxTokens * 4 - 80);
  return `${text.slice(0, approxChars)}\n\n… truncated to ~${maxTokens} token budget …`;
}
