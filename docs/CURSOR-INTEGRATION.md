# Cursor integration guide

How Cursory plugs into Cursor using **documented** Plugin / MCP / hooks surfaces only.

## What Cursor should load

After `pnpm install:local` (or marketplace install) and a window reload, Customize should show a plugin named **cursory** with:

| Component | Phase | Expected |
| --- | --- | --- |
| MCP server `cursory` | 1+ | Tools registered (Phase 1: `cursory_ping`) |
| Rules | 6 | Short always-apply guidance |
| Skills | 6 | `efficient-context` |
| Commands | 6 | stats / map / diagnose |
| Hooks | 6 | observe-only session/tool lifecycle |

Phase 1 intentionally ships MCP + manifest scaffolding. Rules/skills/commands/hooks directories exist as placeholders so later phases do not reshuffle layout.

## Local install paths

| OS | Path |
| --- | --- |
| Windows | `%USERPROFILE%\.cursor\plugins\local\cursory` |
| macOS / Linux | `~/.cursor/plugins/local/cursory` |

Install steps:

```bash
pnpm install
pnpm build
pnpm install:local
```

Then in Cursor: **Developer: Reload Window** → open **Customize** → confirm **cursory**.

### Symlink note

Cursor only loads symlinks under `plugins/local` when the target stays **inside** that folder. Cursory copies files into `plugins/local/cursory` instead of linking an external repo path.

## MCP launch

`mcp.json` starts:

```text
node ${CURSOR_PLUGIN_ROOT}/dist/index.js
```

with `CURSORY_WORKSPACE=${workspaceFolder}` when Cursor expands that variable.
The server also refuses the plugin install directory as a workspace and will
re-root from an absolute file path or `CURSORY_WORKSPACE` / `CURSOR_WORKSPACE`.

Requirements:

- Node.js 20+ on `PATH` for the Cursor process environment
- Built `dist/` present in the installed plugin directory

## Agent usage model

Automatic path = **silent native input bounds** via `preToolUse` `updated_input`
(Read / Grep / file-dump Shell). No slash command is required.

Deeper path = **MCP tools** when the agent wants ranked search, symbol reads,
or bounded command output.

Hooks may:

- record metrics
- rewrite native tool inputs with `updated_input` so large reads/searches never
  enter the conversation at full size

Hooks must not:

- append `additional_context`, `agent_message`, or generated summaries
- block ordinary small reads/shell
- rewrite commands in semantically risky ways
- fail closed on unexpected errors

Cursor may run both generic and tool-specific hooks for one operation. Cursory
therefore does not register parallel `beforeShellExecution` steering handlers;
shell bounds live in the single `preToolUse` matcher.

Small targeted Read/Grep/Shell stay unchanged. Large unbounded calls are capped
in place. Cursory MCP tools remain available for progressive recovery.

## Progressive recovery

If an optimized MCP response is insufficient, the agent should immediately call:

- `cursory_get_raw` (Phase 4+), or
- `force_full` on read (Phase 3+)

Never treat Cursory as a permanent compressor.

## Metrics honesty

`cursory_context_stats` reports **estimated** tokens avoided. These estimates are not Cursor billing usage unless Cursor provides measurable billing data we can cite.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Plugin missing in Customize | Local path, Reload Window, Teams “Allow Local Plugin Imports” |
| MCP tools missing | `dist/index.js` exists; Node on PATH; MCP panel errors |
| Marketplace name collision | Marketplace install overrides local same-name plugin |
| Hooks not firing (Phase 6+) | `hooks/hooks.json` paths; Hooks output channel; fail-open logs |

## Marketplace preparation (later)

When submitting:

- Valid `.cursor-plugin/plugin.json`
- Unique kebab-case `name`
- Relative paths only
- README + privacy statement
- Tested local install
- No secrets in repo
