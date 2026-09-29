# Benchmarks

Two layers:

1. **Cursor Agent A/B** (`pnpm cursory benchmark`) — real `agent -p` runs with/without Cursory  
2. **Chart pipeline** (`pnpm bench:charts`) — aggregates `runs/*.json` into dark README SVGs  

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
├── headline.svg           # tokens / cost / quality headlines
├── grouped.svg            # Cursor OFF vs ON grouped bars
├── savings.svg            # % reduction marketing bars
├── quality-scatter.svg    # quality vs tokens
├── tokens-over-runs.svg   # line chart across repeats
└── cost-per-success.svg   # $/successful task
```

All charts use a black background for GitHub contrast.

## Agent A/B

```bash
pnpm build && pnpm install:local
pnpm cursory benchmark fix-session-redirect --runs 10
pnpm bench:charts
```

| Arm | Env | Workspace MCP |
| --- | --- | --- |
| baseline | `CURSORY_ENABLED=0` | empty |
| cursory | `CURSORY_ENABLED=1` | Cursory MCP → plugin `dist/index.js` |

## Cost notes

README cost charts use a transparent token-rate heuristic (`src/benchmark/costModel.ts`). They are **not** Cursor invoice dollars. Quality is task success from verification / `expectText`.
