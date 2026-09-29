# Cursory roadmap

Aligned with the product plan: **usable MVP by Phase 4** (terminal compression + `get_raw`).

Status legend: `[ ]` planned · `[~]` in progress · `[x]` done

## Phase 0 — Prove what Cursor allows `[x]`

Documented in `docs/cursor-api.md`:

| Question | Answer (documented) |
| --- | --- |
| Can `preToolUse` modify Read args? | Yes — `updated_input` is a documented output field |
| Can it deny + guide? | Yes — `permission` + `agent_message` / `user_message` |
| Which MCP output can `postToolUse` replace? | MCP tools: `updated_mcp_tool_output` (not arbitrary built-in tool output) |
| Plugin hook path resolution | Relative to plugin install root for plugin hooks |
| Local install | `~/.cursor/plugins/local/<name>` (copy; external symlinks skipped) |
| Stdio MCP plugin root | `${CURSOR_PLUGIN_ROOT}` (not `${PLUGIN_ROOT}`) |

## Phase 1 — Skeleton `[x]`

Plugin recognized → MCP starts → diagnostic tool works (`cursory_ping`; fuller `cursory_diagnose` later).

## Phase 2 — Workspace optimizer `[x]`

`cursory_workspace_map`, ignore engine, scanner, estimator, hashing, session stats foundations.

## Phase 3 — Smart code retrieval `[x]`

`cursory_smart_search`, `cursory_smart_read`, session cache, Git relevance.
**Rule: return exact source — select less of it; do not summarize selected code.**

## Phase 4 — Terminal compression `[x]` ← **usable MVP**

Pattern: **compress → investigate → expand** (never permanent loss).

- [x] `cursory_smart_run` (cwd constrained to workspace; timeout; capture cap)
- [x] `terminalReducer` / `testReducer` / `logReducer`
- [x] Raw spill under local data dir + TTL (`terminal.retainRawMinutes`)
- [x] `cursory_get_raw` (range + search)
- [x] Basic secret redaction on reduced summaries (raw store stays exact)
- [ ] Human Cursor smoke: `smart_run` + `get_raw`

**Exit criteria:** typecheck/lint/test/build pass; 100% raw recoverability until TTL; reduced test output keeps failures.

## Phase 5 — Delta context `[x]`

- [x] Session path snapshots for hash-changed re-reads
- [x] Line-oriented unified delta + surrounding exact source
- [x] Git working-tree vs HEAD delta for changed large files
- [x] `cursory_smart_diff` (compact patch + raw_result_id)
- [x] Diff reducer with file list / symbol hints
- [ ] Human Cursor smoke for delta read + smart_diff

**Exit criteria:** changed re-read returns delta ≪ full file; `force_full` still recovers everything; smart_diff stores raw patch.

## Phase 6 — Automatic behavior `[x]`

- [x] Tiny always-apply `rules/cursory.mdc`
- [x] `skills/efficient-context/SKILL.md` (progressive workflows)
- [x] Commands: stats / map / diagnose
- [x] `cursory_diagnose` (suggests ignores; never auto-edits)
- [x] `cursory_context_stats` (already shipping)
- [ ] Human confirmation that rule appears Always-On after reload

**Exit criteria:** rule stays short; diagnose never writes `.cursorignore`; typecheck/lint/test/build pass.

## Phase 7 — Hooks `[x]`

Safety net, not core engine. Fail-open. Steer; do not block normal work.

- [x] `sessionStart` / `sessionEnd` / `preToolUse` / `postToolUse` / `beforeShellExecution` / `preCompact`
- [x] Expensive-pattern heuristics (tree/find/vendor-grep/logs/tests)
- [x] Always `permission: allow` + `agent_message` steering (no command rewrites)
- [x] `hooks/hooks.json` via `${CURSOR_PLUGIN_ROOT}/dist/hooks/*.js`
- [ ] Human confirmation in Cursor Hooks panel after reload

**Exit criteria:** typecheck/lint/test/build pass; hooks never set `failClosed`; cheap commands unflagged.

## Phase 8 — AST indexing `[x]`

- [x] `Parser` interface + registry (ordered fail-through)
- [x] `FallbackParser` (regex) — always available
- [x] `TypeScriptAstParser` for TS/JS/TSX/JSX (compiler API; no native addons)
- [x] `TreeSitterParser` optional adapter (soft-detect; not a hard dependency)
- [x] Session `SymbolIndex` (path + content hash cache)
- [x] `smart_read` / `smart_search` pass real paths into the registry
- [ ] Optional: install real tree-sitter grammars when desired

**Exit criteria:** TS/JS symbols via AST; missing tree-sitter does not break builds/tests.

## Phase 9 — Benchmark `[x]`

- [x] `pnpm benchmark` (`scripts/benchmark.ts` + `src/benchmark/`)
- [x] Scenarios: repo discovery, large tests/logs, relevant + repeated reads, large diff
- [x] Raw recoverability checks (`store` / `get_raw` / `force_full`)
- [x] Task-success gate (6/6) — harder than token savings alone
- [x] Honest estimate disclaimer (not Cursor billing)

**Exit criteria:** typecheck/lint/test/build pass; `pnpm benchmark` exits 0 with recoverability 100% and tasks 6/6.

---

## Non-negotiables

1. Correctness over optimization  
2. 100% raw recoverability  
3. Deterministic methods before any LLM fallback  
4. Honest estimates ≠ Cursor billing  
5. Local-first; no default external telemetry  
6. Fail-open hooks  
7. Stop if foundational tests fail at phase end  
