import type { OptimizationRecordInput } from "./stats.js";
import type { PersistedStats } from "./models.js";
import { addRecord, createEmptySession, createEmptyStats, recoverStats } from "./stats.js";

export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

const STORAGE_KEY = "cursory.stats.v1";

export class StatsStore {
  private value: PersistedStats;

  constructor(private readonly storage: MementoLike) {
    this.value = recoverStats(storage.get<unknown>(STORAGE_KEY));
  }

  snapshot(): PersistedStats {
    return structuredClone(this.value);
  }

  async record(input: OptimizationRecordInput): Promise<PersistedStats> {
    this.value = addRecord(this.value, input);
    await this.persist();
    return this.snapshot();
  }

  async resetSession(): Promise<PersistedStats> {
    this.value = { ...this.value, session: createEmptySession() };
    await this.persist();
    return this.snapshot();
  }

  async resetLifetime(): Promise<PersistedStats> {
    this.value = {
      ...this.value,
      lifetime: createEmptyStats().lifetime,
    };
    await this.persist();
    return this.snapshot();
  }

  async clearHistory(): Promise<PersistedStats> {
    this.value = { ...this.value, history: [] };
    await this.persist();
    return this.snapshot();
  }

  private async persist(): Promise<void> {
    await this.storage.update(STORAGE_KEY, this.value);
  }
}
