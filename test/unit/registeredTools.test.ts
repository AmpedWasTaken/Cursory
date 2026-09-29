import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { registerTools } from "../../src/mcp/registerTools.js";

describe("default MCP surface", () => {
  it("registers only the four automatic context tools", () => {
    const registered: Array<{ name: string; description: string }> = [];
    const server = {
      tool(name: string, description: string) {
        registered.push({ name, description });
      },
    } as unknown as McpServer;

    registerTools(server);

    expect(registered.map(({ name }) => name)).toEqual([
      "cursory_smart_search",
      "cursory_smart_read",
      "cursory_smart_run",
      "cursory_get_raw",
    ]);
    expect(registered.every(({ description }) => description.length > 80)).toBe(true);
  });
});
