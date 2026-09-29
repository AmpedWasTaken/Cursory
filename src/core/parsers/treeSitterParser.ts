import { createRequire } from "node:module";
import type { ParseResult, Parser } from "./parser.js";

const TS_EXT = /\.(tsx?|jsx?)$/i;
const require = createRequire(import.meta.url);

/**
 * Optional Tree-sitter adapter.
 *
 * Tree-sitter is NOT a hard dependency. If packages are missing, `parse()`
 * returns null and the registry falls through to TypeScript AST / regex.
 *
 * Enable later (example):
 *   pnpm add tree-sitter tree-sitter-typescript
 */
export class TreeSitterParser implements Parser {
  readonly id = "tree-sitter";
  private unavailable = false;

  supports(filePath: string): boolean {
    return TS_EXT.test(filePath);
  }

  parse(_filePath: string, _content: string): ParseResult | null {
    if (this.unavailable) return null;
    try {
      require.resolve("tree-sitter");
      // Packages may be present; full grammar wiring is intentionally deferred.
      // Returning null keeps TypeScript AST as the active AST engine.
      this.unavailable = true;
      return null;
    } catch {
      this.unavailable = true;
      return null;
    }
  }
}
