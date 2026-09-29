# Live eval (Cursory on vs off)

Prefer the automated Agent A/B runner when the Cursor CLI is installed:

```bash
pnpm cursory benchmark fix-session-redirect --runs 3
```

This scorecard is the manual fallback. It is not `pnpm benchmark` (offline fixtures).

## Why this shape

- Same five prompts, same model (`composer-2.5`), new Agent chat per task except `follow-up`.
- **Off arm:** `CURSORY_DISABLE_TAKEOVER=1` in the plugin env, or disable the plugin. Hooks still log what they *would* have capped.
- **On arm:** normal Cursory install after `pnpm build && pnpm install:local` + Reload Window.
- Score **task success first**, then tool-call tax, then Cursor usage if the dashboard shows a delta.

Do not use the Cursor SDK for this pass. Plugin hooks may not fire there.

## Run

1. Open `test/fixtures/mini-repo` (or copy it to a throwaway folder).
2. On arm: Reload Window, confirm plugin **cursory** in Customize.
3. Paste each prompt from `tasks.json`. One chat per task (`follow-up` stays in the symbol-hunt chat).
4. Mark the scorecard. Then repeat off.

```bash
pnpm build
pnpm install:local
# after a session:
pnpm eval:live
```

`pnpm eval:live` reads `%LOCALAPPDATA%\cursory\live-eval.jsonl` (macOS/Linux: Application Support / `.local/share`).

## Scorecard

| Task | On success | Off success | On tool calls (approx) | Off tool calls | Offset follow-ups (from log) |
| --- | --- | --- | --- | --- | --- |
| small-edit | | | | | |
| symbol-hunt | | | | | |
| noisy-test | | | | | |
| wide-explore | | | | | |
| follow-up | | | | | |

**Success** = the expect line in `tasks.json` is met. A cheaper run that gets the answer wrong is a loss.

Watch:

- `Cursory MCP calls` staying at 0 → model ignored `smart_*`.
- `Read offset follow-ups` rising on the on-arm → truncation retry tax.
- Cursor dashboard $ for the two sessions (same model, same day) if visible.

After five pairs we either keep the silent cap, change recover (`get_raw` for native reads), or stop claiming live savings.
