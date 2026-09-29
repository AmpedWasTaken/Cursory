import { hashString } from "./hashes.js";

/** Lightweight content fingerprint cache keyed by path + mtime/size when available. */
export class ContentHashCache {
  private readonly byPath = new Map<string, { hash: string; size: number; mtimeMs: number }>();

  get(path: string, size: number, mtimeMs: number): string | undefined {
    const hit = this.byPath.get(path);
    if (!hit) return undefined;
    if (hit.size === size && hit.mtimeMs === mtimeMs) {
      return hit.hash;
    }
    return undefined;
  }

  set(path: string, hash: string, size: number, mtimeMs: number): void {
    this.byPath.set(path, { hash, size, mtimeMs });
  }

  hashText(text: string): string {
    return hashString(text);
  }
}

let shared: ContentHashCache | null = null;

export function getContentHashCache(): ContentHashCache {
  if (!shared) {
    shared = new ContentHashCache();
  }
  return shared;
}
