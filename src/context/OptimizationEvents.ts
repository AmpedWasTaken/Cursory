import type { ContextPipelineResult } from "./ContextPipeline.js";

export interface ContextOptimizationEvent {
  id: string;
  timestamp: number;
  prompt: string;
  result: ContextPipelineResult;
  latencyMs: number;
}

type Listener = (event: ContextOptimizationEvent) => void;
const listeners = new Set<Listener>();

export function publishContextOptimization(event: ContextOptimizationEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // UI/reporting failures must never interrupt context optimization.
    }
  }
}

export function onContextOptimization(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
