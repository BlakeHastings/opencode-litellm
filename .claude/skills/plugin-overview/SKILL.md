---
name: plugin-overview
description: >-
  Architecture reference for the opencode-litellm plugin. Use when working on
  the plugin hooks (auth, tool, config), the litellm-setup command flow, API key
  handling, config file format, graceful degradation, or understanding how the
  plugin fits into the OpenCode plugin system.
allowed-tools: Read, Glob, Grep
---
# opencode-litellm Plugin Architecture

## Overview

An OpenCode plugin that auto-discovers models from a LiteLLM proxy and injects
them as a `litellm` provider at startup. No manual model listing required.

## Three Hooks

### `auth` hook
Registers `litellm` as a provider in OpenCode's `/connect` UI.
- `provider: "litellm"` — the key used when calling `ctx.client.auth.get("litellm")`
- Single `type: "api"` method with a single `apiKey` prompt
- `authorize()` returns `{ type: "success", key: apiKey || "no-key" }` — the
  `no-key` sentinel stands in for an empty string because OpenCode can't store
  blank keys
- `loader()` builds the credential object used by the AI SDK when routing calls

### `tool` hook — `litellm_configure`
AI-callable tool that saves the LiteLLM base URL to disk.
- Called by the model during the `/litellm-setup` command flow
- Strips `/v1` suffix and trailing slash before saving
- Writes `~/.config/opencode/litellm-plugin.json` as `{ "baseURL": "..." }`
- Returns a string instructing the user to run `/connect litellm` if they need
  an API key

### `config` hook
Runs at every OpenCode startup; mutates the config object in place (returns void).

1. **Always** injects the `litellm-setup` slash command:
   ```
   config.command["litellm-setup"] = {
     template: "...",          // AI prompt — NOT a shell command
     description: "..."
   }
   ```
2. Reads `~/.config/opencode/litellm-plugin.json` for `baseURL`
3. If no `baseURL` → returns early (plugin stays invisible)
4. Reads stored API key via `ctx.client.auth.get("litellm")`
5. Calls `GET {baseURL}/v1/models` with 5 s timeout + optional Bearer token
6. On any fetch failure → returns early (graceful degradation, no crash)
7. Injects `config.provider.litellm` with `@ai-sdk/openai-compatible`, model
   map, and `baseURL: "{rootURL}/v1"`

## Config File

**Path:** `~/.config/opencode/litellm-plugin.json`

**Shape:**
```json
{ "baseURL": "http://your-host:4000" }
```

- Written by `litellm_configure` tool (no trailing slash, no `/v1` suffix)
- Read by `config` hook on every startup
- Absent = plugin not configured → no-op

## API Key Handling

| Stored value | Meaning | Config hook behavior |
|---|---|---|
| absent / `null` | No key entered | `apiKey` omitted from provider options |
| `"no-key"` | User left key blank | treated as absent — `apiKey` omitted |
| `"sk-..."` | Real key | passed as `Authorization: Bearer sk-...` |

## User Setup Flow

```
User runs /litellm-setup
  → OpenCode sends template prompt to model
  → Model asks user for their LiteLLM URL
  → Model calls litellm_configure({ base_url: "http://host:4000" })
  → Tool writes ~/.config/opencode/litellm-plugin.json
  → Tool tells user to run /connect litellm for API key
  → User runs /connect litellm and enters key (or leaves blank)
  → On next OpenCode startup, config hook discovers models automatically
```

## Key Invariants

- `fetchModels` is called with the **root URL** (no `/v1`); it appends `/v1/models` itself
- `config.provider.litellm.options.baseURL` is always `{rootURL}/v1`
- Model IDs come directly from `/v1/models` — no prefix added
- Any network failure in `config` hook is swallowed so OpenCode still starts

## Dependencies

- `@opencode-ai/plugin` — `Plugin`, `tool`, `tool.schema` (zod)
- `@ai-sdk/openai-compatible` — loaded by OpenCode at runtime (not bundled here)
- No env vars — all config via OpenCode auth UI + plugin config file
