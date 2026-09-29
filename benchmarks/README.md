# Live usage benchmarks

Raw Cursor dashboard runs live here. Charts in `assets/benchmarks/` are generated — do not hand-edit them.

```text
benchmarks/
├── runs/                 # one JSON file per agent run
├── summary.json          # averages, median, min/max, stdDev, % change
└── generate-charts.ts
assets/benchmarks/
├── tokens.svg
├── duration.svg
└── cache.svg
```

## Record a run

Copy numbers from the Cursor usage dashboard after an Agent chat:

```bash
pnpm bench:record -- \
  --variant cursory \
  --id standard-prompt \
  --label "Composer 2.5 · standard prompt" \
  --model "Composer 2.5" \
  --input 9119 \
  --output 453 \
  --cache 20430 \
  --duration 14900
```

Use `--variant baseline` for the matching Cursory-off run (same prompt, same model).

## Regenerate charts

```bash
pnpm bench:charts
```

## Sample data

`pnpm bench:seed` writes a deterministic 10× baseline + 10× cursory set so CI and README charts stay reproducible. Replace those files with real dashboard captures as you collect them.

## Run schema

```json
{
  "benchmark": {
    "id": "simple-refactor",
    "label": "Simple refactor"
  },
  "environment": {
    "editor": "Cursor",
    "model": "Composer 2.5",
    "cursoryVersion": "0.1.0"
  },
  "variant": "cursory",
  "metrics": {
    "inputTokens": 9119,
    "outputTokens": 453,
    "cacheReadTokens": 20430,
    "durationMs": 14900
  },
  "timestamp": "2026-09-29T09:30:00Z"
}
```
