import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getContextCache } from "../context/ContextCache.js";
import { detectDuplicateBlocks } from "../context/DuplicateDetector.js";
import { estimateTokensFromText } from "../core/telemetry/estimator.js";
import { recordDuplicateBytesAvoided, recordOptimization } from "../core/telemetry/sessionStats.js";
import { resolveWorkspaceRoot } from "../core/workspace/resolveWorkspaceRoot.js";
import { buildGetRaw } from "./tools/getRaw.js";
import { buildSmartRead } from "./tools/smartRead.js";
import { buildSmartRun } from "./tools/smartRun.js";
import { buildSmartSearch } from "./tools/smartSearch.js";

export function novelContext(text: string, allowRepeat = false, scope = "global"): string {
  if (allowRepeat) return text;
  const cache = getContextCache();
  const result = detectDuplicateBlocks([text], [...cache.getDeliveredTexts(scope)]);
  const novel = result.unique[0];
  if (!novel) {
    const marker = "[cursory:duplicate] no new context";
    recordDuplicateBytesAvoided(
      Math.max(0, Buffer.byteLength(text, "utf8") - Buffer.byteLength(marker, "utf8")),
    );
    recordOptimization({
      category: "duplicate",
      estimatedRawTokens: estimateTokensFromText(text).tokens,
      estimatedDeliveredTokens: estimateTokensFromText(marker).tokens,
      rawBytes: Buffer.byteLength(text, "utf8"),
      deliveredBytes: Buffer.byteLength(marker, "utf8"),
    });
    return marker;
  }
  if (result.duplicateTokens > 0) {
    recordDuplicateBytesAvoided(
      Math.max(0, Buffer.byteLength(text, "utf8") - Buffer.byteLength(novel, "utf8")),
    );
  }
  cache.markDelivered(novel, scope);
  return novel;
}

export function registerTools(server: McpServer): void {
  server.tool(
    "cursory_smart_search",
    "Use automatically instead of broad/noisy Grep or recursive exploration. Searches source with ranked, bounded excerpts, ignores generated/vendor noise by default, and prevents large result floods. Prefer native search only for a known exact symbol in 1-3 files.",
    {
      query: z.string().min(1).describe("Natural language or keyword search query"),
      max_results: z.number().int().positive().max(50).optional(),
      max_tokens: z.number().int().positive().optional(),
      include_generated: z.boolean().optional(),
      workspace_root: z
        .string()
        .optional()
        .describe("Folder Cursor has open. Never the Cursory plugin install path."),
    },
    async (args) => {
      const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
      const result = buildSmartSearch({
        workspaceRoot,
        query: args.query,
        maxResults: args.max_results,
        maxTokens: args.max_tokens,
        includeGenerated: args.include_generated,
      });
      return {
        content: [
          {
            type: "text",
            text: novelContext(result.text, false, workspaceRoot),
          },
        ],
      };
    },
  );

  server.tool(
    "cursory_smart_read",
    "Use automatically instead of native Read for files over 500 lines, repeated reads, or when only a symbol/range is relevant. Returns exact bounded source with session dedupe. force_full on large files still returns a head plus get_raw. Prefer native Read for small targeted files.",
    {
      path: z
        .string()
        .min(1)
        .describe("File path relative to workspace (or absolute under workspace)"),
      intent: z.string().optional(),
      symbol: z.string().optional(),
      start_line: z.number().int().positive().optional(),
      end_line: z.number().int().positive().optional(),
      max_tokens: z.number().int().positive().optional(),
      force_full: z.boolean().optional(),
      workspace_root: z
        .string()
        .optional()
        .describe("Folder Cursor has open. Never the Cursory plugin install path."),
    },
    async (args) => {
      const workspaceRoot = resolveWorkspaceRoot(args.workspace_root, args.path);
      const result = buildSmartRead({
        workspaceRoot,
        path: args.path,
        intent: args.intent,
        symbol: args.symbol,
        startLine: args.start_line,
        endLine: args.end_line,
        maxTokens: args.max_tokens,
        forceFull: args.force_full,
      });
      return {
        content: [
          {
            type: "text",
            text: novelContext(result.text, args.force_full === true, workspaceRoot),
          },
        ],
      };
    },
  );

  server.tool(
    "cursory_smart_run",
    "Use automatically instead of shell execution when tests, builds, logs, diffs, or other commands may produce long output. Returns a bounded failure-focused view and stores the full result for exact recovery. Prefer normal shell for short predictable output.",
    {
      command: z.string().min(1),
      cwd: z.string().optional().describe("Working directory under the workspace"),
      mode: z.enum(["auto", "raw", "tests", "logs", "build"]).optional(),
      max_tokens: z.number().int().positive().optional(),
      timeout_ms: z.number().int().positive().max(600_000).optional(),
      workspace_root: z
        .string()
        .optional()
        .describe("Folder Cursor has open. Never the Cursory plugin install path."),
    },
    async (args) => {
      const workspaceRoot = resolveWorkspaceRoot(args.workspace_root, args.cwd);
      const result = await buildSmartRun({
        workspaceRoot,
        command: args.command,
        cwd: args.cwd,
        mode: args.mode,
        maxTokens: args.max_tokens,
        timeoutMs: args.timeout_ms,
      });
      return {
        content: [
          {
            type: "text",
            text: novelContext(result.text, false, workspaceRoot),
          },
        ],
      };
    },
  );

  server.tool(
    "cursory_get_raw",
    "Expand an earlier Cursory result only when its bounded output omitted required evidence. Retrieves an exact range or search match from stored raw output without rerunning the operation. Omit result_id to list recent stored dumps after compact.",
    {
      result_id: z.string().min(1).optional(),
      start_line: z.number().int().positive().optional(),
      end_line: z.number().int().positive().optional(),
      search: z.string().optional(),
      max_tokens: z.number().int().positive().optional(),
      workspace_root: z
        .string()
        .optional()
        .describe("Folder Cursor has open. Never the Cursory plugin install path."),
    },
    async (args) => {
      const workspaceRoot = resolveWorkspaceRoot(args.workspace_root);
      const result = buildGetRaw({
        workspaceRoot,
        resultId: args.result_id?.trim() || undefined,
        startLine: args.start_line,
        endLine: args.end_line,
        search: args.search,
        maxTokens: args.max_tokens,
      });
      return {
        content: [
          {
            type: "text",
            text: novelContext(result.text, true, workspaceRoot),
          },
        ],
      };
    },
  );
}
