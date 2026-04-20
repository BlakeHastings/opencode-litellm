---
name: run-tests
description: >-
  Run the opencode-litellm test suite with bun. Use when checking if tests pass,
  running unit tests, running integration tests, running E2E tests, debugging a
  failing test, or verifying a change hasn't broken anything. Supports filtering
  by suite name or running E2E against the mock.
argument-hint: "[unit|integration|e2e|<filter>]"
disable-model-invocation: true
allowed-tools: Bash, Read
---
# Run Tests

## Argument Parsing

Parse `$ARGUMENTS`:
- empty → run all unit + integration tests (`bun test`)
- `unit` → run unit tests only (`bun test tests/plugin.test.ts`)
- `integration` → run integration tests only (`bun test tests/integration.test.ts`)
- `e2e` → run E2E runner (`bun tests/e2e/run.ts`)
- anything else → pass as a filter pattern (`bun test --testNamePattern "$ARGUMENTS"`)

## Test Structure

| File | Type | What it tests |
|---|---|---|
| `tests/plugin.test.ts` | Unit | Plugin structure, auth hook (multi-prompt authorize), config hook (placeholder write + model fetch) |
| `tests/integration.test.ts` | Integration | Full round-trip against a real in-process mock LiteLLM HTTP server |
| `tests/e2e/run.ts` | E2E | Launches real `opencode run` processes against the mock; validates auth flow and model routing |
| `tests/fixtures/litellm-server.ts` | Fixture | `startMockLiteLLM({ apiKey?, models? })` — Bun HTTP server on `port: 0` |

## Steps

1. Ensure dependencies are installed:
   ```
   bun install
   ```

2. Run tests based on argument:

   **All unit + integration tests:**
   ```
   bun test
   ```

   **Unit only:**
   ```
   bun test tests/plugin.test.ts
   ```

   **Integration only:**
   ```
   bun test tests/integration.test.ts
   ```

   **E2E runner (requires `opencode` CLI installed globally):**
   ```
   bun tests/e2e/run.ts [opencode-litellm@tag]
   ```

   **By name filter:**
   ```
   bun test --testNamePattern "$ARGUMENTS"
   ```

3. Report results. If tests fail, read the failing test file and `src/index.ts`
   to diagnose before suggesting changes.

## Key Testing Patterns

**Mocking fetch (unit tests):**
```typescript
function mockFetchSuccess() {
  const original = global.fetch
  global.fetch = mock(async () => ({
    ok: true,
    json: async () => ({ data: MOCK_MODEL_IDS.map((id) => ({ id })) }),
  })) as any
  return () => { global.fetch = original }
}
// restore in afterEach: restoreFetch?.()
```

**Integration mock server:**
```typescript
const server = startMockLiteLLM({ apiKey?: string, models?: string[] })
// server.url  = "http://localhost:{os-assigned-port}"
// server.port = number
// server.chatRequests = [{ model: string, messageCount: number }, ...]
// server.stop() in afterAll
```

**Config file cleanup:** `beforeEach`/`afterEach` call `clearPluginConfig()`
which wipes `provider.litellm` from `~/.config/opencode/opencode.json` and the
`litellm` credential from `~/.local/share/opencode/auth.json`.

## E2E Test Architecture

The E2E runner in `tests/e2e/run.ts` launches real `opencode run` processes
against the in-process mock server to validate model routing:

**Model routing:**
1. Runs `opencode run --model litellm/test-model-chat "say hello"`
2. Mock returns a plain text SSE response
3. Asserts `mock.chatRequests` has an entry with `model === "test-model-chat"`

> **Gotcha:** `opencode run` is a TUI app — it renders to the terminal device,
> not to the stdout file descriptor when piped. `Bun.spawnSync` with
> `stdout: "pipe"` captures **nothing** from the actual model response. Always
> assert on `mock.chatRequests` (did the request reach the mock?) not on
> `result.stdout`.

**Mock model behaviour (`tests/fixtures/litellm-server.ts`):**

All models return plain text: "Hello from mock LiteLLM."

The mock tracks all incoming chat requests in `server.chatRequests` so tests can
verify routing.

## Error Handling

- If `bun install` fails: check `package.json` and network connectivity
- If unit tests fail with fetch errors: check that `mockFetchSuccess()` is being
  called and restored correctly
- If integration tests fail with ECONNREFUSED: the mock server likely stopped
  early — check `beforeAll`/`afterAll` ordering
- If E2E fails with "opencode: not found": install with `npm install -g opencode-ai`
