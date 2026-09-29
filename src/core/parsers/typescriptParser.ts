import ts from "typescript";
import type { ExtractedSymbol } from "../indexing/symbols.js";
import type { ParseResult, ParsedImport, Parser } from "./parser.js";

const TS_EXT = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/i;

/**
 * TypeScript compiler AST parser for TS/JS/TSX/JSX.
 * Deterministic, no native addons — preferred AST path on all platforms.
 */
export class TypeScriptAstParser implements Parser {
  readonly id = "typescript-ast";

  supports(filePath: string): boolean {
    return TS_EXT.test(filePath);
  }

  parse(filePath: string, content: string): ParseResult {
    const kind = scriptKindFor(filePath);
    const sf = ts.createSourceFile(
      filePath.replace(/\\/g, "/"),
      content,
      ts.ScriptTarget.Latest,
      true,
      kind,
    );

    const symbols: ExtractedSymbol[] = [];
    const imports: ParsedImport[] = [];

    const visit = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const names: string[] = [];
        const clause = node.importClause;
        if (clause?.name) names.push(clause.name.text);
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const el of clause.namedBindings.elements) names.push(el.name.text);
        }
        imports.push({
          module: node.moduleSpecifier.text,
          names,
          startLine: lineOf(sf, node.getStart(sf)),
        });
      }

      if (ts.isFunctionDeclaration(node) && node.name) {
        symbols.push(sym(sf, node, node.name.text, "function"));
      } else if (ts.isClassDeclaration(node) && node.name) {
        symbols.push(sym(sf, node, node.name.text, "class"));
        for (const member of node.members) {
          if (
            (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) &&
            member.name &&
            ts.isIdentifier(member.name)
          ) {
            symbols.push(sym(sf, member, member.name.text, "method"));
          }
        }
      } else if (ts.isInterfaceDeclaration(node)) {
        symbols.push(sym(sf, node, node.name.text, "interface"));
      } else if (ts.isTypeAliasDeclaration(node)) {
        symbols.push(sym(sf, node, node.name.text, "type"));
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue;
          if (
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))
          ) {
            symbols.push(sym(sf, decl, decl.name.text, "const"));
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sf);
    return { symbols, imports, parserId: this.id };
  }
}

function scriptKindFor(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (lower.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function lineOf(sf: ts.SourceFile, pos: number): number {
  return sf.getLineAndCharacterOfPosition(pos).line + 1;
}

function sym(
  sf: ts.SourceFile,
  node: ts.Node,
  name: string,
  kind: ExtractedSymbol["kind"],
): ExtractedSymbol {
  const start = lineOf(sf, node.getStart(sf));
  const end = lineOf(sf, node.getEnd());
  return { name, kind, startLine: start, endLine: Math.max(start, end) };
}
