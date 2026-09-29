import { CURSORY_NAME, CURSORY_VERSION } from "../config/defaults.js";

export interface DeliveredSlice {
  workspaceRoot: string;
  path: string;
  contentHash: string;
  /** Normalized range key: `full` | `L10-40` | `sym:login` */
  sliceKey: string;
  deliveredAt: number;
  estimatedTokens: number;
  toolVersion: string;
}

export interface PathContentSnapshot {
  workspaceRoot: string;
  path: string;
  contentHash: string;
  content: string;
  deliveredAt: number;
}

const TOOL_VERSION = `${CURSORY_NAME}@${CURSORY_VERSION}`;

/** In-memory session cache of content already returned to the agent. */
export class SessionContentCache {
  private readonly entries = new Map<string, DeliveredSlice>();
  /** Latest content snapshot per workspace+path (for delta reads when hash changes). */
  private readonly snapshots = new Map<string, PathContentSnapshot>();

  private key(
    workspaceRoot: string,
    path: string,
    contentHash: string,
    sliceKey: string,
  ): string {
    return `${workspaceRoot}::${path}::${contentHash}::${sliceKey}::${TOOL_VERSION}`;
  }

  private snapshotKey(workspaceRoot: string, path: string): string {
    return `${workspaceRoot}::${path}`;
  }

  has(input: {
    workspaceRoot: string;
    path: string;
    contentHash: string;
    sliceKey: string;
  }): boolean {
    return (
      this.entries.has(
        this.key(
          input.workspaceRoot,
          input.path,
          input.contentHash,
          input.sliceKey,
        ),
      ) ||
      (input.sliceKey !== FULL_SLICE_KEY &&
        this.entries.has(
          this.key(
            input.workspaceRoot,
            input.path,
            input.contentHash,
            FULL_SLICE_KEY,
          ),
        ))
    );
  }

  get(input: {
    workspaceRoot: string;
    path: string;
    contentHash: string;
    sliceKey: string;
  }): DeliveredSlice | undefined {
    return this.entries.get(
      this.key(input.workspaceRoot, input.path, input.contentHash, input.sliceKey),
    );
  }

  markDelivered(input: {
    workspaceRoot: string;
    path: string;
    contentHash: string;
    sliceKey: string;
    estimatedTokens: number;
    /** When provided, enables delta context on later reads if content changes. */
    content?: string;
  }): void {
    const k = this.key(
      input.workspaceRoot,
      input.path,
      input.contentHash,
      input.sliceKey,
    );
    this.entries.set(k, {
      workspaceRoot: input.workspaceRoot,
      path: input.path,
      contentHash: input.contentHash,
      sliceKey: input.sliceKey,
      deliveredAt: Date.now(),
      estimatedTokens: input.estimatedTokens,
      toolVersion: TOOL_VERSION,
    });
    if (input.content != null) {
      this.snapshots.set(this.snapshotKey(input.workspaceRoot, input.path), {
        workspaceRoot: input.workspaceRoot,
        path: input.path,
        contentHash: input.contentHash,
        content: input.content,
        deliveredAt: Date.now(),
      });
    }
  }

  /** Previous snapshot for path if hash differs from current (file changed since last delivery). */
  getStaleSnapshot(
    workspaceRoot: string,
    path: string,
    currentHash: string,
  ): PathContentSnapshot | undefined {
    const snap = this.snapshots.get(this.snapshotKey(workspaceRoot, path));
    if (!snap) return undefined;
    if (snap.contentHash === currentHash) return undefined;
    return snap;
  }

  getSnapshot(workspaceRoot: string, path: string): PathContentSnapshot | undefined {
    return this.snapshots.get(this.snapshotKey(workspaceRoot, path));
  }

  clear(): void {
    this.entries.clear();
    this.snapshots.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

let shared: SessionContentCache | null = null;

export function getSessionContentCache(): SessionContentCache {
  if (!shared) {
    shared = new SessionContentCache();
  }
  return shared;
}

export function resetSessionContentCache(): void {
  shared = new SessionContentCache();
}

export function makeRangeSliceKey(startLine: number, endLine: number): string {
  return `L${startLine}-${endLine}`;
}

export function makeSymbolSliceKey(symbol: string): string {
  return `sym:${symbol}`;
}

export const FULL_SLICE_KEY = "full";
export const DELTA_SLICE_KEY = "delta";
