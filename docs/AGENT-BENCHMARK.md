# Cursor Agent A/B benchmark

Real Cursor Agent runs — not GUI automation. Both arms use the same CLI:

```bash
agent -p "PROMPT" --model composer-2.5 --workspace <worktree> --output-format stream-json
```

## Flow

```text
cursory benchmark <task>
      │
      ├── reset fixture repo to fixed commit
      ├── git worktree per arm (isolated copies)
      ├── baseline:  CURSORY_ENABLED=0  + empty workspace mcp.json
      ├── cursory:   CURSORY_ENABLED=1  + Cursory MCP wired in
      ├── collect duration / agent JSON / git diff / verification
      └── write benchmarks/results/*.json + benchmarks/runs/*.json
```

## Commands

```bash
pnpm build
pnpm install:local          # so the Cursory arm can load the plugin MCP entry
pnpm cursory benchmark --list
pnpm cursory benchmark fix-session-redirect --runs 3
pnpm cursory benchmark --dry-run --runs 2   # no agent binary required
pnpm bench:charts                           # refresh README SVGs
```

Interactive picker (TTY):

```bash
pnpm cursory benchmark
```

## Enable / disable

```bash
pnpm cursory enable    # docs for CURSORY_ENABLED=1
pnpm cursory disable   # docs for CURSORY_ENABLED=0
```

The runner sets these per arm. Hooks and MCP tools both honor `CURSORY_ENABLED`.
Legacy `CURSORY_DISABLE_TAKEOVER=1` still disables native caps.

Native cap strength (hooks): `CURSORY_CAP_PROFILE=safe|balanced|aggressive`
(default `balanced`: 4KB / 100-line reads, 20-hit greps, clamped context).

## Task definition

`benchmarks/tasks/*.json`:

```json
{
  "id": "fix-session-redirect",
  "repo": "benchmarks/fixtures/session-auth",
  "commit": "",
  "model": "composer-2.5",
  "prompt": "…",
  "verification": { "command": "npm test" },
  "runs": 10
}
```

Empty `commit` means “ensure git + use HEAD” (first run initializes the fixture repo).

## Metrics

Cursor’s documented `--output-format json` result includes `duration_ms` but not always token fields. The runner:

1. Prefers `usage` / `inputTokens` when present on the result (forward-compatible)
2. Else estimates input from stream-json Read tool `totalChars`
3. Always records wall-clock duration, git diff, and verification exit code

## Worktrees

Each arm gets its own worktree under a temp root (`%TEMP%/cursory-bench/…` or `/tmp/cursory-bench/…`), all detached at the same commit. No shared dirty working tree between baseline and Cursory.

## ACP (later)

`agent acp` (JSON-RPC) is a good v2 control plane. v1 stays on `agent -p` because it is script/CI friendly today.
