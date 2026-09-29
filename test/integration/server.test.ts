import { describe, expect, it } from "vitest";
import { createCursoryServer } from "../../src/mcp/server.js";

describe("MCP server scaffold", () => {
  it("creates a named server instance", () => {
    const server = createCursoryServer();
    expect(server).toBeTruthy();
    // McpServer stores server info internally; ensure construction does not throw.
    expect(typeof server.connect).toBe("function");
  });
});
