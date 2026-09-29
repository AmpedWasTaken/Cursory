# Cursor API assumptions (Phase 0)

Research date: 2026-09-25

Sources used (official / primary):

- https://cursor.com/docs/plugins
- https://cursor.com/docs/reference/plugins
- https://cursor.com/docs/hooks.md
- Cursor create-hook skill (event names, fail-open behavior, matchers)
- Local reference install: `~/.cursor/plugins/local/context-mode` (structure only; not treated as Cursor API docs)

If Cursor docs change, update this file before relying on any undocumented field.

## Plugin format

Cursory targets the **Cursor Plugin** format:

- Manifest: `.cursor-plugin/plugin.json`
- Required field: `name` (lowercase kebab-case)
- Optional metadata: `description`, `version`, `author`, `repository`, `license`, `keywords`, `logo`, component path overrides

Default component discovery (when manifest paths are omitted):

| Component | Default path |
| --- | --- |
| Skills | `skills/*/SKILL.md` |
| Rules | `rules/*.{md,mdc,markdown}` |
| Agents | `agents/*.{md,mdc,markdown}` |
| Commands | `commands/*.{md,mdc,markdown,txt}` |
| Hooks | `hooks/hooks.json` |
| MCP | `mcp.json` |

## MCP configuration

- File: `mcp.json` at plugin root (Cursor default discovery)
- Variable for plugin root: `${CURSOR_PLUGIN_ROOT}`
- Cursor does **not** expand Agent Plugins `${PLUGIN_ROOT}` / `${PLUGIN_DATA}` — do not use those
- Stdio servers use `command` + `args` (+ optional `env`, `cwd`)
- Prefer spawning the built Node entrypoint, not undocumented Cursor process hooks

Example shape used by Cursory:

```json
{
  "mcpServers": {
    "cursory": {
      "command": "node",
      "args": ["${CURSOR_PLUGIN_ROOT}/dist/index.js"]
    }
  }
}
```

## Local development install

Documented path:

- `~/.cursor/plugins/local/<plugin-name>`
- Windows: `%USERPROFILE%\.cursor\plugins\local\<plugin-name>`

Documented constraints:

- After copy/install: restart Cursor or **Developer: Reload Window**
- Confirm components under Customize
- Symlinks load only when the target resolves to a directory **inside** `~/.cursor/plugins/local`
- Marketplace install with the same `name` takes precedence over the local copy
- Teams/Enterprise may disable local plugin imports

Cursory `install:local` therefore **copies** built plugin assets into the local folder rather than symlinking the repo from elsewhere.

## Hooks (documented behavior we rely on)

Plugin hooks live in `hooks/hooks.json` (or a path/object declared in the manifest).

Documented Agent events relevant to Cursory:

- `sessionStart`, `sessionEnd`
- `preToolUse`, `postToolUse`, `postToolUseFailure`
- `beforeShellExecution`, `afterShellExecution`
- `beforeMCPExecution`, `afterMCPExecution`
- `beforeReadFile`, `afterFileEdit`
- `preCompact`
- `stop`, `afterAgentResponse`, `afterAgentThought`

Command hooks:

- JSON on stdin → JSON on stdout
- Exit `0`: success
- Exit `2`: block (deny)
- Other non-zero: **fail open** unless `failClosed: true`

Cursory policy: never set `failClosed` for steering/telemetry hooks.

Supported output fields we may use later (Phase 6+):

- `preToolUse`: `permission`, `user_message`, `agent_message`, `updated_input`
- `postToolUse`: `additional_context` (and MCP-only `updated_mcp_tool_output` when applicable)
- `beforeShellExecution` / `beforeMCPExecution`: `permission`, `user_message`, `agent_message`

Cursory uses `preToolUse.updated_input` only: it rewrites native Read/Grep/Shell
arguments so the host tool itself returns less. It does not use
`additional_context`, `agent_message`, or `user_message`. Those fields append
to host-managed context; they do not replace the original conversation or tool
result. Generic and shell-specific events may also apply to one command, so
Cursory does not register a parallel `beforeShellExecution` handler.

### What we will not assume

- Hooks cannot reliably rewrite or suppress arbitrary built-in Cursor tool output the way MCP tools control their own responses
- Plugins cannot read and replace the complete current conversation through a documented prompt-submit interceptor
- MCP tools do not receive conversation history unless the Agent explicitly sends it as tool input
- We will not claim hooks can replace MCP output for optimization
- We will not invent hook events, payload fields, or permission values not documented
- Cloud agents omit some hooks (`sessionStart` / `sessionEnd` / MCP hooks / Tab hooks / `workspaceOpen`); Cursory remains local-first and primarily IDE-oriented

## Rules / skills / commands

Documented frontmatter:

- Rules (`.mdc`): `description`, `alwaysApply`, optional `globs`
- Skills (`SKILL.md`): `name`, `description`
- Commands: `name`, `description`

Keep Cursory rule/skill text short — they consume context themselves.

## Privacy / auth

Documented plugin variables exist for dashboard-configured secrets. Cursory v1 does **not** require Cursor auth tokens, plugin variables, or external APIs.

## Explicit non-goals (API surface)

Do not implement or claim:

- Patching Cursor binaries
- Intercepting model network traffic
- Reading Cursor billing/usage APIs unless officially documented and available
- Undocumented internal agent context injection beyond documented hook fields
- Relying on Claude Code–style hook key casing/structure unless Cursor documents dual loading

Note: some third-party plugins use alternate hook JSON shapes for multi-client compatibility. Cursory follows the Cursor-documented camelCase command-hook format unless official docs say otherwise.
