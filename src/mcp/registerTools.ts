import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getContextCache } from "../context/ContextCache.js";
import { detectDuplicateBlocks } from "../context/DuplicateDetector.js";
import { isCursoryEnabled } from "../core/runtime/enabled.js";
import { estimateTokensFromText } from "../core/telemetry/estimator.js";
import { recordDuplicateBytesAvoided, recordOptimization } from "../core/telemetry/sessionStats.js";
import { resolveWorkspaceRoot } from "../core/workspace/resolveWorkspaceRoot.js";
import { buildGetRaw } from "./tools/getRaw.js";
import { buildSmartRead } from "./tools/smartRead.js";
import { buildSmartRun } from "./tools/smartRun.js";
import { buildSmartSearch } from "./tools/smartSearch.js";

function disabledToolResult() {
  return {
    content: [
      {
        type: "text" as const,
        text: "[cursory:disabled] CURSORY_ENABLED=0 — use native Cursor tools for this baseline run.",
      },
    ],
    isError: true,
  };
}

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
    "DEFAULT for repository search. Use instead of Grep/Glob/find exploration. Returns ranked, bounded excerpts and ignores vendor/generated noise. Native Grep only when you already know an exact symbol in 1–3 files.",
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
      if (!isCursoryEnabled()) return disabledToolResult();
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
    "DEFAULT for source reads when hunting a symbol, reviewing a range, or rereading a file. Returns exact bounded source with session dedupe. Prefer native Read only for tiny one-shot files you already located. Prefer get_raw over force_full.",
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
      if (!isCursoryEnabled()) return disabledToolResult();
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
    "DEFAULT for tests, builds, logs, and git diffs. Returns a failure-focused bounded view and stores full raw for get_raw. Prefer normal Shell only for short predictable one-liners.",
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
      if (!isCursoryEnabled()) return disabledToolResult();
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
      if (!isCursoryEnabled()) return disabledToolResult();
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
