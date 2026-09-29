import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CURSORY_NAME, CURSORY_VERSION } from "../core/config/defaults.js";
import { registerTools } from "./registerTools.js";

export function createCursoryServer(): McpServer {
  const server = new McpServer({
    name: CURSORY_NAME,
    version: CURSORY_VERSION,
  });
  registerTools(server);
  return server;
}

export async function startStdioServer(): Promise<void> {
  const server = createCursoryServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
