# Cursory architecture

Cursory is a local-first Cursor Plugin that reduces unnecessary LLM context using deterministic optimization. The optimizer itself should have essentially zero API cost on the normal path.

## Core principle

> Send the minimum amount of context necessary to solve the task, while preserving a progressive path to the exact raw information when needed.

Correctness beats compression. Optimized results are progressive disclosures, never one-way lossy filters.

## System shape

```text
Cursor Agent
  ├─ rules/cursory.mdc          (short preference guidance)
  ├─ skills/efficient-context/    (workflow for large investigations)
  ├─ commands/                    (stats / map / diagnose shortcuts)
  ├─ hooks/                       (native Read/Grep/Shell bounds + observe-only metrics)
  └─ MCP stdio server (cursory)
       ├─ tools (workspace_map, smart_search, smart_read, ...)
       └─ core/
            ├── config
            ├── cache (content + session, SHA-256)
            ├── indexing (ignore, classify, symbols)
            ├── search (grep, ranking, query analysis)
            ├── git (repo, diff, recency)
            ├── output (budgets, reducers, progressive results)
            ├── telemetry (local estimates only)
            └── parsers (interface + fallback + optional tree-sitter)
```

## Optimization strategy (priority order)

1. Ignore irrelevant / generated paths (git, cursorignore, defaults, config)
2. Avoid duplicate session context (hash + range/symbol cache)
3. Git-aware ranking (changed / recent / adjacent files)
4. Exact search + symbol extraction
5. Bounded progressive output
6. Optional LLM summarization — **not in MVP**

## Additive-context safeguard

Documented Cursor plugin APIs do not let Cursory remove or replace the host
conversation. Appending a compressed copy while the original remains would
increase context. Cursory therefore injects no prompt, history, workspace
summary, or tool-steering messages. Live savings come from smaller host
operations: silent native input bounds, or a bounded Cursory MCP tool.

Live Cursor also rewrites **native tool inputs** (`preToolUse` `updated_input`)
so a full-file Read or unbounded Grep never lands in the conversation. That is
not conversation replacement; it is a smaller host operation. Thinking blocks
cannot be rewritten (`afterAgentThought` has no output fields).

The pure context pipeline supports replacement-mode benchmarks and future host
APIs. Its default additive mode is a strict no-op unless a developer explicitly
enables regression for debugging.

## MCP tools (product surface)

| Tool | Role |
| --- | --- |
| `cursory_smart_search` | Ranked search with excerpts |
| `cursory_smart_read` | Intent/symbol/range-aware file reads |
| `cursory_smart_run` | Command execution with reduced output + raw retention |
| `cursory_get_raw` | Recover exact stored raw for any optimized result |

Phase 1 ships only a diagnostic/ping tool to prove MCP wiring.

## Progressive disclosure levels

1. Compact summary
2. Relevant exact excerpts
3. Requested raw ranges (`get_raw` / line bounds)
4. Full raw (`force_full` / full stored output)

Every reduction path must remain recoverable.

## Local data

Default storage (final paths finalized in Phase 2+):

- Session metrics: under a Cursory local data directory (OS app-data style)
- Raw command/result spill: temporary files with TTL (`terminal.retainRawMinutes`)
- Content/session cache: local SQLite or equivalent embedded store

No cloud backend in v1. No external telemetry by default.

## Token estimates

Cursory reports **estimates** (tiktoken-compatible when practical, else character heuristic).

These are **not** Cursor billing tokens unless Cursor exposes exact usage we can measure.

## Failure policy

- Hooks: fail open
- Path traversal: reject outside workspace unless explicitly allowed
- Shell: spawn with argument arrays where possible; timeouts; spill large stdout/stderr
- Parsers: fallback text/grep when AST unavailable

## Module boundaries

| Layer | Responsibility |
| --- | --- |
| `src/mcp` | Tool schemas, MCP wiring, response shaping |
| `src/core` | Pure-ish optimization logic (testable without Cursor) |
| `hooks` | Telemetry + steering only |
| `rules` / `skills` / `commands` | Agent guidance surfaces |
| `scripts` | Local install, benchmarks |

Do not mix Cursor I/O concerns into ranking/hashing/reducer unit tests.
