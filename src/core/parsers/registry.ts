import { FallbackParser } from "./fallbackParser.js";
import type { ParseResult, Parser } from "./parser.js";
import { TreeSitterParser } from "./treeSitterParser.js";
import { TypeScriptAstParser } from "./typescriptParser.js";

/**
 * Ordered parsers: optional tree-sitter → TypeScript AST → regex fallback.
 * Tree-sitter is never required for correctness.
 */
export class ParserRegistry {
  private readonly parsers: Parser[];

  constructor(parsers?: Parser[]) {
    this.parsers = parsers ?? [
      new TreeSitterParser(),
      new TypeScriptAstParser(),
      new FallbackParser(),
    ];
  }

  parse(filePath: string, content: string): ParseResult {
    for (const parser of this.parsers) {
      if (!parser.supports(filePath)) continue;
      try {
        const result = parser.parse(filePath, content);
        if (result) return result;
      } catch (err) {
        console.error(
          `[cursory] parser ${parser.id} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    // Absolute last resort
    return new FallbackParser().parse(filePath, content);
  }
}

let shared: ParserRegistry | null = null;

export function getParserRegistry(): ParserRegistry {
  if (!shared) shared = new ParserRegistry();
  return shared;
}

export function parseSource(filePath: string, content: string): ParseResult {
  return getParserRegistry().parse(filePath, content);
}
