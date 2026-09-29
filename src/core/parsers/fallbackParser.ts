import type { ExtractedSymbol } from "../indexing/symbols.js";
import type { ParseResult, ParsedImport, Parser } from "./parser.js";

/**
 * Regex fallback parser — works for unsupported languages and as last resort.
 * Never depends on native/WASM engines.
 */
export class FallbackParser implements Parser {
  readonly id = "fallback-regex";

  supports(_filePath: string): boolean {
    return true;
  }

  parse(_filePath: string, content: string): ParseResult {
    return {
      symbols: extractSymbolsRegex(content),
      imports: extractImportsRegex(content),
      parserId: this.id,
    };
  }
}

export function extractSymbolsRegex(content: string): ExtractedSymbol[] {
  const lines = content.split(/\r?\n/);
  const symbols: ExtractedSymbol[] = [];

  const patterns: Array<{ kind: ExtractedSymbol["kind"]; re: RegExp }> = [
    { kind: "class", re: /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_][\w]*)/ },
    { kind: "interface", re: /^\s*(?:export\s+)?interface\s+([A-Za-z_][\w]*)/ },
    { kind: "type", re: /^\s*(?:export\s+)?type\s+([A-Za-z_][\w]*)\s*=/ },
    {
      kind: "function",
      re: /^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_][\w]*)\s*\(/,
    },
    {
      kind: "const",
      re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][\w]*)\s*=\s*(?:async\s*)?(?:\(|function\b)/,
    },
    {
      kind: "method",
      re: /^\s*(?:public|private|protected|async|static|readonly|\s)*([A-Za-z_][\w]*)\s*\([^;]*\)\s*(?::\s*[^{]+)?\{/,
    },
    { kind: "export", re: /^\s*export\s+\{\s*([A-Za-z_][\w]*)/ },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { kind, re } of patterns) {
      const m = line.match(re);
      if (!m?.[1]) continue;
      if (kind === "method" && /^(if|for|while|switch|catch|function|return)$/.test(m[1])) {
        continue;
      }
      symbols.push({
        name: m[1],
        kind,
        startLine: i + 1,
        endLine: findBlockEnd(lines, i),
      });
      break;
    }
  }

  return symbols;
}

function findBlockEnd(lines: string[], startIdx: number): number {
  let depth = 0;
  let seen = false;
  for (let i = startIdx; i < Math.min(lines.length, startIdx + 400); i++) {
    const line = lines[i]!;
    for (const ch of line) {
      if (ch === "{") {
        depth += 1;
        seen = true;
      } else if (ch === "}") {
        depth -= 1;
        if (seen && depth <= 0) return i + 1;
      }
    }
    if (!seen && i > startIdx && /;\s*$/.test(line)) return i + 1;
  }
  return Math.min(lines.length, startIdx + 40);
}

function extractImportsRegex(content: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 120); i++) {
    const line = lines[i]!;
    const m = line.match(/import\s+(?:type\s+)?(?:[\w*\s{},]+)\s+from\s+['"]([^'"]+)['"]/);
    if (m?.[1]) {
      imports.push({ module: m[1], names: [], startLine: i + 1 });
    }
  }
  return imports;
}
