import { analyzeQuery } from "../core/search/queryAnalysis.js";
import {
  CONTEXT_SUMMARIZER_VERSION,
  type ContextCache,
  createSummaryCacheKey,
  getContextCache,
} from "./ContextCache.js";
import { normalizeForComparison } from "./DuplicateDetector.js";
import { estimateTokens, truncateToTokens } from "./TokenEstimator.js";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt?: number;
  source?: "user" | "cursor" | "cursory";
  type?: "message" | "summary" | "metadata";
  sourceHash?: string;
}

export interface ConversationSelectionOptions {
  messages: ConversationMessage[];
  currentPrompt: string;
  recentBudget: number;
  historicalBudget: number;
  relevanceThreshold?: number;
  cache?: ContextCache;
}

export interface ConversationSelection {
  recent: ConversationMessage[];
  historicalSummary: string;
  skippedGenerated: number;
  skippedIrrelevant: number;
  historicalTokens: number;
  skippedIrrelevantTokens: number;
  summaryCacheHit: boolean;
}

function isGenerated(message: ConversationMessage): boolean {
  return (
    message.source === "cursory" ||
    /^\s*\[CURSORY_CONTEXT\b/i.test(message.content) ||
    /^\s*Cursory (?:hint|context|metadata):/i.test(message.content)
  );
}

function terms(text: string): Set<string> {
  const query = analyzeQuery(text);
  return new Set(
    [...query.textTerms, ...query.symbolHints]
      .map((term) => term.toLowerCase())
      .filter((term) => term.length > 1),
  );
}

export function conversationRelevance(
  content: string,
  currentPrompt: string,
): number {
  const promptTerms = terms(currentPrompt);
  if (promptTerms.size === 0) return 0;
  const contentTerms = terms(content);
  let overlap = 0;
  for (const term of promptTerms) {
    if (contentTerms.has(term) || content.toLowerCase().includes(term)) {
      overlap++;
    }
  }
  return overlap / promptTerms.size;
}

function buildExtractiveSummary(
  messages: ConversationMessage[],
  maxTokens: number,
): string {
  const lines: string[] = [];
  for (const message of messages) {
    const compact = message.content
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s+/)
      .slice(0, 2)
      .join(" ");
    if (compact) lines.push(`${message.role}: ${compact}`);
  }
  return truncateToTokens(lines.join("\n"), maxTokens);
}

/**
 * Preserve relevant recent turns, summarize relevant older turns once, and
 * exclude all prior Cursory-generated material from future source context.
 */
export function selectConversationContext(
  options: ConversationSelectionOptions,
): ConversationSelection {
  const threshold = options.relevanceThreshold ?? 0.12;
  const cache = options.cache ?? getContextCache();
  const currentNormalized = normalizeForComparison(options.currentPrompt);
  const skippedGenerated = options.messages.filter(isGenerated).length;
  const eligible = options.messages.filter(
    (message) =>
      !isGenerated(message) &&
      normalizeForComparison(message.content) !== currentNormalized,
  );

  const recent: ConversationMessage[] = [];
  const recentIds = new Set<string>();
  let recentTokens = 0;
  for (let i = eligible.length - 1; i >= 0; i--) {
    const message = eligible[i]!;
    const relevance = conversationRelevance(
      message.content,
      options.currentPrompt,
    );
    const isVeryRecent = i >= eligible.length - 2;
    if (!isVeryRecent && relevance < threshold) continue;
    const cost = estimateTokens(message.content);
    if (recentTokens + cost > options.recentBudget) continue;
    recent.unshift(message);
    recentIds.add(message.id);
    recentTokens += cost;
  }

  const historical = eligible.filter(
    (message) =>
      !recentIds.has(message.id) &&
      conversationRelevance(message.content, options.currentPrompt) >= threshold,
  );
  const skippedIrrelevant =
    eligible.length - recent.length - historical.length;
  const historicalTokens = historical.reduce(
    (sum, message) => sum + estimateTokens(message.content),
    0,
  );
  const skippedIrrelevantTokens = eligible
    .filter(
      (message) =>
        !recentIds.has(message.id) && !historical.includes(message),
    )
    .reduce((sum, message) => sum + estimateTokens(message.content), 0);
  if (historical.length === 0 || options.historicalBudget <= 0) {
    return {
      recent,
      historicalSummary: "",
      skippedGenerated,
      skippedIrrelevant,
      historicalTokens,
      skippedIrrelevantTokens,
      summaryCacheHit: false,
    };
  }

  const source = historical
    .map((message) => `${message.role}:${message.content}`)
    .join("\n");
  const settings = {
    maxTokens: options.historicalBudget,
    version: CONTEXT_SUMMARIZER_VERSION,
  };
  const key = createSummaryCacheKey(source, settings);
  const cached = cache.getSummary(key);
  if (cached) {
    return {
      recent,
      historicalSummary: cached.summary,
      skippedGenerated,
      skippedIrrelevant,
      historicalTokens,
      skippedIrrelevantTokens,
      summaryCacheHit: true,
    };
  }
  const summary = buildExtractiveSummary(
    historical,
    options.historicalBudget,
  );
  cache.setSummary(key, source, summary);
  return {
    recent,
    historicalSummary: summary,
    skippedGenerated,
    skippedIrrelevant,
    historicalTokens,
    skippedIrrelevantTokens,
    summaryCacheHit: false,
  };
}
