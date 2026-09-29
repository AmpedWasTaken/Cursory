# Cursory

Local-first **Cursor Plugin** that reduces unnecessary LLM context/token consumption while preserving developer productivity and answer quality.

> Send the minimum amount of context necessary to solve the task, while preserving a progressive path to the exact raw information when needed.

**Status:** Phase 9 — benchmarks complete (baseline vs Cursory + recoverability).

**Cursory estimates context avoided. These estimates are not the same thing as Cursor billing usage.**

## What it does

- Prefer deterministic waste reduction: ignore rules, dedupe, hashing, Git awareness, exact search, bounded progressive output
- Expose MCP tools the Agent can use instead of dumping huge trees/logs/diffs
- Keep raw recoverability (`get_raw` / `force_full` in later phases)
- Stay local: no cloud backend, no default external telemetry, no Cursor auth token requirement

## What it does NOT do

- Blindly summarize or rewrite source code
- Patch Cursor binaries or intercept model traffic
- Claim exact dollar savings without measurable billing data
- Permanently discard command/file output
- Block ordinary small reads or shell commands via hooks

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/CURSOR-INTEGRATION.md](docs/CURSOR-INTEGRATION.md), and [docs/cursor-api.md](docs/cursor-api.md).

Primary path: **silent native bounds** (`preToolUse` `updated_input` on
Read/Grep/Shell) plus **MCP stdio** for ranked/symbol/verbose work. Hooks never
append messages or supporting context to the conversation.

## Requirements

- Node.js 20+
- pnpm 9+ (repo uses pnpm 10)
- Cursor with local plugin imports allowed

## Quick start (development)

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm install:local
```

Then in Cursor: **Developer: Reload Window** → **Customize** → confirm plugin **cursory**.

### Local install paths

| OS            | Path                                          |
| ------------- | --------------------------------------------- |
| Windows       | `%USERPROFILE%\.cursor\plugins\local\cursory` |
| macOS / Linux | `~/.cursor/plugins/local/cursory`             |

## How Cursor uses it (Phase 7)

After `pnpm install:local` + reload:

- A compact always-on rule; no slash command is required
- `preToolUse` silently caps large native Read/Grep/Shell inputs
- Observe-only lifecycle hooks; they do not inject `additional_context` or
  `agent_message` text
- Four MCP tools for ranked search, symbol reads, verbose commands, and recovery

## Default tools

| Tool                   | Automatic use                                      |
| ---------------------- | -------------------------------------------------- |
| `cursory_smart_search` | Broad or noisy repository searches                 |
| `cursory_smart_read`   | Large, repeated, symbol, or range reads            |
| `cursory_smart_run`    | Verbose tests, builds, logs, and diffs             |
| `cursory_get_raw`      | Exact recovery when bounded output is insufficient |

The smaller surface reduces idle schema overhead and gives the model clearer
routing choices. Small targeted operations stay on native Cursor tools.

## Configuration

Copy `cursory.config.example.json` to `cursory.config.json` (loading lands in Phase 2).

Default mode: `balanced`. Modes never disable raw expansion.

## Privacy

- Local-first
- No analytics server by default
- No code uploads / external APIs in v1
- Session metrics stay local under the OS data directory:
  - Windows: `%LOCALAPPDATA%\cursory`
  - macOS: `~/Library/Application Support/cursory`
  - Linux: `~/.local/share/cursory` (or `$XDG_DATA_HOME/cursory`)
  - Override: `CURSORY_DATA_DIR`
- Raw terminal spill is temporary with TTL (Phase 4)

## Benchmarks

```bash
pnpm benchmark
```

Compares naive baseline vs Cursory delivered estimates across twelve scenarios,
plus **raw recoverability** and **task success**. Numbers are estimates
(~4 chars/token), not Cursor billing.

The context regression suite also covers simple edits, bug fixes, multi-file
features, follow-ups, long conversations, and large project context. Cursory
uses replacement semantics in these offline scenarios. In live Cursor, where a
plugin cannot replace the host conversation, the safe strategy is no
unsolicited context injection; savings come from choosing a bounded Cursory
tool instead of the corresponding raw operation.

## Limitations (Phase 9)

- Active AST engine is the TypeScript compiler API (portable)
- Tree-sitter adapter is optional and soft-disabled until grammars are wired
- Vue/PHP/Python still use regex fallback
- Benchmark fixtures are synthetic / local — not a substitute for live Cursor agent evals

## Troubleshooting

See [docs/CURSOR-INTEGRATION.md](docs/CURSOR-INTEGRATION.md).

## Marketplace preparation

Follow Cursor’s plugin submission checklist when Phase 9 is reached. Do not invent undocumented APIs.

## License

MIT
