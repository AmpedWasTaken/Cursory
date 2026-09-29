# Benchmarks

Two layers:

1. **Cursor Agent A/B** (`pnpm cursory benchmark`) — real `agent -p` runs with/without Cursory  
2. **Chart pipeline** (`pnpm bench:charts`) — aggregates `runs/*.json` into README SVGs  

See [docs/AGENT-BENCHMARK.md](../docs/AGENT-BENCHMARK.md).

```text
benchmarks/
├── tasks/                 # task definitions (prompt, repo, verification)
├── fixtures/              # small repos exercised by tasks
├── runs/                  # one JSON file per agent arm (chart input)
├── results/               # full A/B reports
├── summary.json           # generated aggregates
└── generate-charts.ts
assets/benchmarks/
├── tokens.svg
├── duration.svg
└── cache.svg
```

## Agent A/B (preferred)

```bash
pnpm build && pnpm install:local
pnpm cursory benchmark fix-session-redirect --runs 3
# without Cursor CLI installed:
pnpm cursory benchmark fix-session-redirect --dry-run --runs 2
pnpm bench:charts
```

Both arms go through Cursor Agent. The runner sets:

| Arm | Env | Workspace MCP |
| --- | --- | --- |
| baseline | `CURSORY_ENABLED=0` | empty |
| cursory | `CURSORY_ENABLED=1` | Cursory MCP → plugin `dist/index.js` |

Each arm gets an isolated git worktree at the same commit.

## Manual dashboard capture

Still supported if you prefer recording Cursor UI usage numbers:

```bash
pnpm bench:record -- --variant cursory --input 9119 --output 453 --cache 20430 --duration 14900
pnpm bench:charts
```

## Sample seed data

`pnpm bench:seed` writes a deterministic 10×10 set for chart plumbing. Prefer real `cursory benchmark` output when available.
