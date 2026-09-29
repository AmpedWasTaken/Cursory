import { hashString } from "../cache/hashes.js";
import { parseSource } from "../parsers/registry.js";
import type { ExtractedSymbol } from "./symbols.js";
import type { ParsedImport } from "../parsers/parser.js";

export interface IndexedFileSymbols {
  path: string;
  contentHash: string;
  parserId: string;
  symbols: ExtractedSymbol[];
  imports: ParsedImport[];
}

/**
 * In-memory symbol index keyed by path + content hash.
 * Avoids re-parsing unchanged files within a session.
 */
export class SymbolIndex {
  private readonly byPath = new Map<string, IndexedFileSymbols>();

  getOrParse(filePath: string, content: string): IndexedFileSymbols {
    const contentHash = hashString(content);
    const hit = this.byPath.get(filePath);
    if (hit && hit.contentHash === contentHash) {
      return hit;
    }
    const parsed = parseSource(filePath, content);
    const entry: IndexedFileSymbols = {
      path: filePath,
      contentHash,
      parserId: parsed.parserId,
      symbols: parsed.symbols,
      imports: parsed.imports,
    };
    this.byPath.set(filePath, entry);
    return entry;
  }

  clear(): void {
    this.byPath.clear();
  }

  size(): number {
    return this.byPath.size;
  }
}

let shared: SymbolIndex | null = null;

export function getSymbolIndex(): SymbolIndex {
  if (!shared) shared = new SymbolIndex();
  return shared;
}

export function resetSymbolIndex(): void {
  shared = new SymbolIndex();
}
