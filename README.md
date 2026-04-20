# opencode-litellm

OpenCode plugin that auto-discovers models from a [LiteLLM](https://litellm.ai) proxy and makes them available in OpenCode without manual configuration.

## Install

Add to your `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["opencode-litellm"]
}
```

## Setup

1. Open OpenCode and run `/connect`.
2. Select **LiteLLM** from the provider list.
3. Enter your LiteLLM proxy base URL (e.g., `http://localhost:4000`).
4. Enter your API key when prompted (leave blank if your proxy has no authentication).
5. Restart OpenCode — your LiteLLM models will appear in the model picker automatically.

## How it works

On every startup the plugin calls `GET /v1/models` on your LiteLLM proxy and injects the results as an OpenAI-compatible provider into OpenCode's runtime config. Models appear in the model picker using the IDs returned by your proxy (e.g. `claude-sonnet`, `deepseek-coder-v2`).

If the proxy is unreachable or the API key is missing, the plugin falls back to a placeholder entry so OpenCode starts cleanly and `/connect` still lists LiteLLM.

Each request also carries OpenCode's session ID as a top-level `litellm_session_id` field in the request body, so the LiteLLM Admin UI groups every turn of one OpenCode chat into a single session. A new chat session produces a different ID.

## Development

### Prerequisites

- **Bun** — runtime, package manager, and test runner. Install from [bun.sh](https://bun.sh).
- **OpenCode** — install globally: `npm install -g opencode-ai`

### Setup

```bash
git clone https://github.com/your-org/opencode-litellm
cd opencode-litellm
bun install
```

Open the repo in OpenCode. The `.opencode/opencode.json` in this repo loads the plugin directly from `src/index.ts`:

```json
{
  "plugin": ["../src/index.ts"]
}
```

Any changes to `src/index.ts` take effect the next time you restart OpenCode — no build step required.

### Logs

The plugin logs via `client.app.log()` into OpenCode's standard log file. Use the `/read-plugin-logs` command inside OpenCode to filter and view plugin-specific output. Log files are at:

- **Windows:** `%USERPROFILE%\.local\share\opencode\log\<timestamp>.log`
- **macOS/Linux:** `~/.local/share/opencode/log/<timestamp>.log`

### Running tests

```bash
bun test                                    # all tests
bun test --watch                            # watch mode
bun test tests/plugin.test.ts              # unit only
bun test tests/integration.test.ts         # integration only
bun test --testNamePattern "config hook"   # filter by name
```

### Project structure

```
src/index.ts                      # plugin — auth, config, and chat.params hooks
.opencode/opencode.json           # loads plugin from ../src/index.ts for development
tests/plugin.test.ts              # unit tests (mocked fetch)
tests/integration.test.ts         # integration tests (real in-process mock server)
tests/e2e/run.ts                  # E2E runner (spawns opencode process)
tests/fixtures/litellm-server.ts  # mock LiteLLM HTTP server
```

### Publishing

```bash
bun run build   # compiles src/ to dist/
npm publish
```
