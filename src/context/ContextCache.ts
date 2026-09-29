import { hashString } from "../core/cache/hashes.js";

export const CONTEXT_SUMMARIZER_VERSION = 1;

export interface CachedSummary {
  key: string;
  sourceHash: string;
  summary: string;
  createdAt: number;
  version: number;
}

export function createSummaryCacheKey(
  sourceContent: string,
  settings: unknown,
  version = CONTEXT_SUMMARIZER_VERSION,
): string {
  return hashString(
    `${hashString(sourceContent)}:${version}:${JSON.stringify(settings)}`,
  );
}

/** Process-local cache; no conversation text or generated wrappers are persisted. */
export class ContextCache {
  private readonly summaries = new Map<string, CachedSummary>();
  private readonly deliveredHashes = new Set<string>();
  private readonly deliveredTexts: Array<{ scope: string; text: string }> = [];

  getSummary(key: string): CachedSummary | undefined {
    return this.summaries.get(key);
  }

  setSummary(
    key: string,
    sourceContent: string,
    summary: string,
    version = CONTEXT_SUMMARIZER_VERSION,
  ): CachedSummary {
    const value = {
      key,
      sourceHash: hashString(sourceContent),
      summary,
      createdAt: Date.now(),
      version,
    };
    this.summaries.set(key, value);
    if (this.summaries.size > 100) {
      const oldest = this.summaries.keys().next().value as string | undefined;
      if (oldest) this.summaries.delete(oldest);
    }
    return value;
  }

  hasDelivered(text: string, scope = "global"): boolean {
    return this.deliveredHashes.has(hashString(`${scope}\0${text}`));
  }

  markDelivered(text: string, scope = "global"): void {
    const hash = hashString(`${scope}\0${text}`);
    if (this.deliveredHashes.has(hash)) return;
    this.deliveredHashes.add(hash);
    this.deliveredTexts.push({ scope, text });
    if (this.deliveredTexts.length > 100) {
      const removed = this.deliveredTexts.shift();
      if (removed) {
        this.deliveredHashes.delete(
          hashString(`${removed.scope}\0${removed.text}`),
        );
      }
    }
  }

  getDeliveredTexts(scope = "global"): readonly string[] {
    return this.deliveredTexts
      .filter((entry) => entry.scope === scope)
      .map((entry) => entry.text);
  }

  clear(): void {
    this.summaries.clear();
    this.deliveredHashes.clear();
    this.deliveredTexts.length = 0;
  }
}

let shared = new ContextCache();

export function getContextCache(): ContextCache {
  return shared;
}

export function resetContextCache(): void {
  shared = new ContextCache();
}
