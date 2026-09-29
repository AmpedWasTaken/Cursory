import { startStdioServer } from "./mcp/server.js";

async function main(): Promise<void> {
  await startStdioServer();
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(`[cursory] fatal: ${message}`);
  process.exit(1);
});
