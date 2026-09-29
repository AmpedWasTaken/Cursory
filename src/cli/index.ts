#!/usr/bin/env node
import { getRuntimeInfo } from "../core/config/config.js";

const info = getRuntimeInfo();
const args = process.argv.slice(2);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`cursory ${info.version}

Usage:
  cursory              Print runtime info
  cursory --version    Print version
  cursory --help       Show help

MCP server entrypoint:
  node dist/index.js
`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  console.log(info.version);
  process.exit(0);
}

console.log(
  JSON.stringify(
    {
      ...info,
      note: "Phase 1 CLI stub. Prefer MCP tools via Cursor after local install.",
    },
    null,
    2,
  ),
);
