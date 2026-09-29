import { analyzeQuery } from "../core/search/queryAnalysis.js";
import type { ContextCandidate } from "./ContextBudget.js";
import { estimateTokens } from "./TokenEstimator.js";

export interface ProjectContextItem {
  id: string;
  path: string;
  text: string;
  source?: "user" | "cursor" | "cursory";
  type?: "file" | "summary" | "metadata";
  version?: number;
  sourceHash?: string;
  createdAt?: number;
  symbols?: string[];
  dependencies?: string[];
  changed?: boolean;
  recentlyEdited?: boolean;
}

function termOverlap(prompt: string, item: ProjectContextItem): number {
  const query = analyzeQuery(prompt);
  const terms = [...query.textTerms, ...query.symbolHints].map((term) =>
    term.toLowerCase(),
  );
  if (terms.length === 0) return 0;
  const haystack = [
    item.path,
    item.text,
    ...(item.symbols ?? []),
    ...(item.dependencies ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length / terms.length;
}

export function scoreProjectContext(
  prompt: string,
  item: ProjectContextItem,
): number {
  const lowerPrompt = prompt.toLowerCase();
  const path = item.path.toLowerCase();
  const filename = path.split("/").at(-1) ?? path;
  const symbolMatch = (item.symbols ?? []).some((symbol) =>
    lowerPrompt.includes(symbol.toLowerCase()),
  );
  const fileMention =
    lowerPrompt.includes(path) || lowerPrompt.includes(filename);
  const dependencyRelation = (item.dependencies ?? []).some((dependency) =>
    lowerPrompt.includes(dependency.toLowerCase()),
  );
  const lexicalSimilarity = termOverlap(prompt, item);
  const recency = item.recentlyEdited || item.changed ? 1 : 0;
  return Math.min(
    1,
    lexicalSimilarity * 0.35 +
      Number(symbolMatch) * 0.25 +
      Number(fileMention) * 0.2 +
      Number(dependencyRelation) * 0.1 +
      recency * 0.1,
  );
}

export function selectProjectContextCandidates(
  prompt: string,
  items: ProjectContextItem[],
  relevanceThreshold = 0.12,
): ContextCandidate[] {
  return items
    .map((item) => ({
      id: item.id,
      text: item.text,
      relevanceScore: scoreProjectContext(prompt, item),
      kind: "project" as const,
      estimatedTokens: estimateTokens(item.text),
    }))
    .filter(
      (item) =>
        item.relevanceScore >= relevanceThreshold &&
        item.estimatedTokens > 0,
    )
    .map(({ estimatedTokens: _estimatedTokens, ...candidate }) => candidate);
}
