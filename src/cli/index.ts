#!/usr/bin/env node
import { getRuntimeInfo } from "../core/config/config.js";
import { isCursoryEnabled } from "../core/runtime/enabled.js";
import { runBenchmarkCli } from "./benchmarkCommand.js";

const info = getRuntimeInfo();
const args = process.argv.slice(2);
const command = args[0];

function printHelp(): void {
  console.log(`cursory ${info.version}

Usage:
  cursory                      Print runtime info
  cursory enable               Print how to enable Cursory for Agent CLI
  cursory disable              Print how to disable Cursory for Agent CLI
  cursory benchmark [task]     A/B Cursor Agent benchmark (baseline vs Cursory)
  cursory --version            Print version
  cursory --help               Show help

MCP server entrypoint:
  node dist/index.js

A/B env (inherited by hooks when spawning agent):
  CURSORY_ENABLED=0 agent -p "..." --model composer-2.5 --output-format json
  CURSORY_ENABLED=1 agent -p "..." --model composer-2.5 --output-format json
`);
}

async function main(): Promise<void> {
  if (
    args.includes("--help") ||
    args.includes("-h") ||
    command === "help"
  ) {
    printHelp();
    return;
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(info.version);
    return;
  }

  if (command === "enable") {
    console.log(`Cursory enable (Agent CLI)

Export for the Cursory arm of a benchmark:

  set CURSORY_ENABLED=1          # Windows cmd
  $env:CURSORY_ENABLED="1"       # PowerShell
  export CURSORY_ENABLED=1       # bash

Or let \`cursory benchmark\` set this per arm automatically.
`);
    process.exitCode = 0;
    return;
  }

  if (command === "disable") {
    console.log(`Cursory disable (Agent CLI)

Export for the baseline arm of a benchmark:

  set CURSORY_ENABLED=0
  $env:CURSORY_ENABLED="0"
  export CURSORY_ENABLED=0

Legacy equivalent: CURSORY_DISABLE_TAKEOVER=1

Or let \`cursory benchmark\` set this per arm automatically.
`);
    process.exitCode = 0;
    return;
  }

  if (command === "benchmark") {
    const code = await runBenchmarkCli(args.slice(1));
    process.exitCode = code;
    return;
  }

  if (command === "status") {
    console.log(
      JSON.stringify(
        {
          ...info,
          enabled: isCursoryEnabled(),
          CURSORY_ENABLED: process.env.CURSORY_ENABLED ?? null,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    JSON.stringify(
      {
        ...info,
        enabled: isCursoryEnabled(),
        note: "Use `cursory benchmark` for Cursor Agent A/B runs. MCP: node dist/index.js",
      },
      null,
      2,
    ),
  );
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
