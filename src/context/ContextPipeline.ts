import { randomUUID } from "node:crypto";
import { loadConfig } from "../core/config/config.js";
import {
  DEFAULT_CONTEXT_BUDGETS,
  type ContextBudgets,
  type ContextCandidate,
  selectByContextRoi,
} from "./ContextBudget.js";
import { calculateContextBreakdown, type ContextDebugReport } from "./ContextDebug.js";
import { detectDuplicateBlocks } from "./DuplicateDetector.js";
import {
  conversationRelevance,
  type ConversationMessage,
  selectConversationContext,
} from "./ConversationSelector.js";
import {
  type ProjectContextItem,
  selectProjectContextCandidates,
} from "./ProjectContextSelector.js";
import { calculateOptimizationStats, type OptimizationStats } from "./ContextStats.js";
import { estimateTokens, truncateToTokens } from "./TokenEstimator.js";
import { publishContextOptimization } from "./OptimizationEvents.js";

export interface ContextPipelineOptions {
  currentPrompt: string;
  workspaceRoot?: string;
  messages?: ConversationMessage[];
  projectContext?: ProjectContextItem[];
  existingContext?: string[];
  budgets?: Partial<ContextBudgets>;
  mode?: "additive" | "replacement";
  relevanceThreshold?: number;
  allowRegression?: boolean;
  debug?: boolean;
}

export interface ContextPipelineResult {
  originalPrompt: string;
  injectedContext: string;
  optimizedContext: string;
  selected: ContextCandidate[];
  noInjectionReason?: string;
  stats: OptimizationStats;
  debug?: ContextDebugReport;
}

function finishPipeline(
  options: ContextPipelineOptions,
  result: ContextPipelineResult,
  startedAt: number,
): ContextPipelineResult {
  publishContextOptimization({
    id: randomUUID(),
    timestamp: Date.now(),
    prompt: options.currentPrompt,
    result,
    latencyMs: Math.max(0, Date.now() - startedAt),
  });
  return result;
}

function baselineText(options: ContextPipelineOptions, includeProjectCandidates: boolean): string {
  return [
    options.currentPrompt,
    ...(options.messages ?? []).map((message) => message.content),
    ...(options.existingContext ?? []),
    ...(includeProjectCandidates ? (options.projectContext ?? []).map((item) => item.text) : []),
  ]
    .filter(Boolean)
    .join("\n");
}

function noInjection(
  options: ContextPipelineOptions,
  baselineTokens: number,
  baseline: string,
  reason: string,
): ContextPipelineResult {
  const stats = calculateOptimizationStats({
    baselineTokens,
    optimizedTokens: baselineTokens,
  });
  return {
    originalPrompt: options.currentPrompt,
    injectedContext: "",
    optimizedContext: baseline,
    selected: [],
    noInjectionReason: reason,
    stats,
  };
}

/**
 * Build replacement context from relevance-selected candidates. Cursor plugins
 * cannot replace the host conversation today, so additive mode deliberately
 * returns no context: appending a summary to intact source is a regression.
 */
export function buildOptimizedContext(options: ContextPipelineOptions): ContextPipelineResult {
  const startedAt = Date.now();
  const workspaceContext = options.workspaceRoot
    ? loadConfig(options.workspaceRoot).context
    : undefined;
  const budgets: ContextBudgets = {
    ...DEFAULT_CONTEXT_BUDGETS,
    ...(workspaceContext
      ? {
          maxInjectedTokens: workspaceContext.maxInjectedTokens,
          recentConversationBudget: workspaceContext.recentConversationBudget,
          historicalSummaryBudget: workspaceContext.historicalSummaryBudget,
          projectContextBudget: workspaceContext.projectContextBudget,
          instructionsBudget: workspaceContext.instructionsBudget,
          safetyMargin: workspaceContext.safetyMargin,
        }
      : {}),
    ...options.budgets,
  };
  const allowRegression = options.allowRegression ?? workspaceContext?.allowRegression ?? false;
  const debugEnabled = options.debug ?? workspaceContext?.debug ?? false;
  const mode = options.mode ?? "additive";
  const baseline = baselineText(options, mode === "replacement");
  const baselineTokens = estimateTokens(baseline);

  if (mode === "additive" && !allowRegression) {
    return finishPipeline(
      options,
      noInjection(
        options,
        baselineTokens,
        baseline,
        "host context is additive; Cursory cannot replace the original context",
      ),
      startedAt,
    );
  }

  const conversation = selectConversationContext({
    messages: options.messages ?? [],
    currentPrompt: options.currentPrompt,
    recentBudget: budgets.recentConversationBudget,
    historicalBudget: budgets.historicalSummaryBudget,
    relevanceThreshold: options.relevanceThreshold,
  });
  const candidates: ContextCandidate[] = conversation.recent.map((message) => ({
    id: `conversation:${message.id}`,
    text: `${message.role}: ${message.content}`,
    relevanceScore: Math.max(0.2, conversationRelevance(message.content, options.currentPrompt)),
    kind: "recent",
  }));
  if (conversation.historicalSummary) {
    candidates.push({
      id: "conversation:historical-summary",
      text: conversation.historicalSummary,
      relevanceScore: 0.7,
      kind: "historical",
      generatedByCursory: true,
    });
  }
  candidates.push(
    ...selectProjectContextCandidates(
      options.currentPrompt,
      (options.projectContext ?? []).filter(
        (item) => item.source !== "cursory" && !/^\s*\[CURSORY_CONTEXT\b/i.test(item.text),
      ),
      options.relevanceThreshold,
    ),
  );

  const reference = [options.currentPrompt, ...(options.existingContext ?? [])];
  let duplicateTokens = 0;
  const dedupedCandidates: ContextCandidate[] = [];
  for (const candidate of candidates) {
    const deduped = detectDuplicateBlocks([candidate.text], reference);
    duplicateTokens += deduped.duplicateTokens;
    const text = deduped.unique[0];
    if (!text) continue;
    dedupedCandidates.push({ ...candidate, text });
    reference.push(text);
  }
  const selected = selectByContextRoi(dedupedCandidates, budgets);
  const sections = selected.map((candidate) => candidate.text);
  const wrapperTokens = estimateTokens("[CURSORY_CONTEXT]\n[/CURSORY_CONTEXT]");
  const hardInjectedLimit = Math.max(0, budgets.maxInjectedTokens - budgets.safetyMargin);
  const body = truncateToTokens(
    sections.join("\n\n"),
    Math.max(0, hardInjectedLimit - wrapperTokens),
  );
  const injectedContext = body ? `[CURSORY_CONTEXT]\n${body}\n[/CURSORY_CONTEXT]` : "";
  const optimizedContext = injectedContext
    ? `${options.currentPrompt}\n\n${injectedContext}`
    : options.currentPrompt;
  const optimizedTokens = estimateTokens(optimizedContext);
  const selectedProjectIds = new Set(
    selected.filter((item) => item.kind === "project").map((item) => item.id),
  );
  const skippedProjectTokens = (options.projectContext ?? [])
    .filter((item) => !selectedProjectIds.has(item.id))
    .reduce((sum, item) => sum + estimateTokens(item.text), 0);
  const stats = calculateOptimizationStats({
    baselineTokens,
    optimizedTokens,
    skippedDuplicateTokens: duplicateTokens,
    skippedIrrelevantTokens: conversation.skippedIrrelevantTokens + skippedProjectTokens,
    compressedTokens: conversation.historicalSummary
      ? Math.max(0, conversation.historicalTokens - estimateTokens(conversation.historicalSummary))
      : 0,
  });

  if (
    !allowRegression &&
    (optimizedTokens > baselineTokens ||
      (baselineTokens > 100 && optimizedTokens > baselineTokens * 0.85))
  ) {
    return finishPipeline(
      options,
      noInjection(
        options,
        baselineTokens,
        baseline,
        optimizedTokens > baselineTokens
          ? "optimized context would exceed baseline"
          : "optimization would save less than 15%",
      ),
      startedAt,
    );
  }

  const debug = debugEnabled
    ? {
        breakdown: calculateContextBreakdown({
          originalUserPrompt: estimateTokens(options.currentPrompt),
          recentConversation: conversation.recent.reduce(
            (sum, message) => sum + estimateTokens(message.content),
            0,
          ),
          historicalConversation: conversation.historicalTokens,
          historicalSummary: estimateTokens(conversation.historicalSummary),
          selectedFiles: selected
            .filter((item) => item.kind === "project")
            .reduce((sum, item) => sum + item.estimatedTokens, 0),
          cursoryInstructions: body ? estimateTokens("[CURSORY_CONTEXT]\n[/CURSORY_CONTEXT]") : 0,
          duplicateContextDetected: duplicateTokens,
          finalInjectedContext: estimateTokens(injectedContext),
        }),
        stats,
        generatedAt: new Date().toISOString(),
      }
    : undefined;

  return finishPipeline(
    options,
    {
      originalPrompt: options.currentPrompt,
      injectedContext,
      optimizedContext,
      selected,
      stats,
      debug,
    },
    startedAt,
  );
}
