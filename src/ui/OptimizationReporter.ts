import { EventEmitter } from "node:events";
import type { ContextPipelineResult } from "../context/ContextPipeline.js";
import { estimateTokens } from "../context/TokenEstimator.js";
import type { OptimizationRecordInput } from "./stats.js";

const emitter = new EventEmitter();

export type OptimizationListener = (record: OptimizationRecordInput) => void;

export function reportOptimization(record: OptimizationRecordInput): void {
  emitter.emit("optimization", record);
}

export function onOptimization(listener: OptimizationListener): () => void {
  emitter.on("optimization", listener);
  return () => emitter.off("optimization", listener);
}

export function reportContextPipelineResult(input: {
  id: string;
  prompt: string;
  result: ContextPipelineResult;
  latencyMs: number;
}): void {
  const { result } = input;
  const breakdown = result.debug?.breakdown;
  reportOptimization({
    id: input.id,
    timestamp: Date.now(),
    promptPreview: input.prompt,
    baselineTokens: result.stats.baselineTokens,
    optimizedTokens: result.stats.optimizedTokens,
    duplicateTokensRemoved: result.stats.skippedDuplicateTokens,
    irrelevantTokensRemoved: result.stats.skippedIrrelevantTokens,
    compressionSavings: result.stats.compressedTokens,
    bypassed: Boolean(result.noInjectionReason),
    bypassReason: result.noInjectionReason,
    regressionRejected: result.noInjectionReason?.includes("exceed baseline"),
    contextBreakdown: {
      currentPrompt: breakdown?.originalUserPrompt ?? 0,
      recentConversation: breakdown?.recentConversation ?? 0,
      historicalSummary: breakdown?.historicalSummary ?? 0,
      projectContext: breakdown?.selectedFiles ?? 0,
      instructions: breakdown?.cursoryInstructions ?? 0,
      metadata: breakdown?.metadata ?? 0,
    },
    relevantFiles: result.selected
      .filter((item) => item.kind === "project")
      .map((item) => ({
        path: item.id,
        tokens: estimateTokens(item.text),
        relevance: item.relevanceScore,
        reason: ["selected by project context relevance"],
      })),
    latencyMs: input.latencyMs,
  });
}
