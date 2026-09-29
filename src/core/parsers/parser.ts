import type { ExtractedSymbol } from "../indexing/symbols.js";

export type { ExtractedSymbol };

export interface ParsedImport {
  module: string;
  names: string[];
  startLine: number;
}

export interface ParseResult {
  symbols: ExtractedSymbol[];
  imports: ParsedImport[];
  parserId: string;
}

export interface Parser {
  /** Stable id for metrics/debug */
  readonly id: string;
  /** Whether this parser can handle the path (by extension/language). */
  supports(filePath: string): boolean;
  /**
   * Parse file content. Return null to signal "skip / unavailable"
   * so the registry can try the next parser (never throw for missing optional engines).
   */
  parse(filePath: string, content: string): ParseResult | null;
}
