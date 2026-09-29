import { getSymbolIndex } from "./symbolIndex.js";

export interface ExtractedSymbol {
  name: string;
  kind: "function" | "method" | "class" | "interface" | "type" | "export" | "const";
  startLine: number;
  endLine: number;
}

/**
 * Extract symbols via the parser registry (TS AST → regex fallback).
 * Pass a real path when available so the correct parser is selected.
 */
export function extractSymbols(content: string, filePath = "file.ts"): ExtractedSymbol[] {
  return getSymbolIndex().getOrParse(filePath, content).symbols;
}

export function findSymbol(
  symbols: ExtractedSymbol[],
  name: string,
): ExtractedSymbol | undefined {
  const exact = symbols.find((s) => s.name === name);
  if (exact) return exact;
  const lower = name.toLowerCase();
  return symbols.find((s) => s.name.toLowerCase() === lower);
}

/** Collect import lines near the top of a file (enough surrounding context). */
export function extractImportBlock(
  content: string,
  maxLines = 80,
): { startLine: number; endLine: number; text: string } {
  const lines = content.split(/\r?\n/);
  let end = 0;
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    const line = lines[i]!;
    if (/^\s*(import\b|export\s+[\w*{])/.test(line) || /^\s*from\s+['"]/.test(line)) {
      end = i + 1;
      continue;
    }
    if (end > 0 && line.trim() === "") {
      end = i + 1;
      continue;
    }
    if (end > 0 && !/^\s*(import\b|export\b|\/\/|\/\*|\*)/.test(line)) {
      break;
    }
  }
  if (end === 0) {
    return { startLine: 1, endLine: 0, text: "" };
  }
  return {
    startLine: 1,
    endLine: end,
    text: lines.slice(0, end).join("\n"),
  };
}
