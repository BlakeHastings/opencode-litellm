# opencode-litellm

OpenCode plugin that auto-discovers models from a [LiteLLM](https://litellm.ai) proxy and makes them available in OpenCode without manual configuration.

## Install

Add to your `~/.config/opencode/opencode.json` (global) or project `opencode.json`:

```json
{
  "plugin": ["opencode-litellm"]
}
```

## Configure

### Option A — OpenCode UI (recommended)

After installing, open OpenCode's provider settings, find **LiteLLM**, and enter your credentials. Models will auto-populate on next startup.

### Option B — Environment variables

```bash
export LITELLM_BASE_URL=http://your-litellm-host:4000
export LITELLM_API_KEY=sk-your-key
```

`LITELLM_BASE_URL` defaults to `http://localhost:4000` if not set.

If neither credentials nor `LITELLM_BASE_URL` are set, the plugin silently does nothing so OpenCode starts cleanly.

## How it works

On startup, the plugin calls `GET /v1/models` on your LiteLLM proxy and injects the results as an OpenAI-compatible provider into OpenCode's runtime config. Models appear in the model picker using the friendly aliases you configured in LiteLLM (e.g., `claude-sonnet`, `deepseek-coder-v2`).
