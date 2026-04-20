/**
 * Self-contained OpenCode E2E test runner.
 *
 * Usage: bun tests/e2e/run.ts [plugin-npm-tag]
 *   plugin-npm-tag defaults to "opencode-litellm" (latest stable)
 *
 * Requires opencode-ai to be installed globally (npm install -g opencode-ai).
 *
 * Seeding: opencode.json is pre-populated with provider.litellm pointing at the mock.
 * The config hook will run on startup and discover models from the mock.
 *
 * Flow — model routing:
 *   Runs opencode with test-model-chat. The mock returns a plain text SSE
 *   response. Asserts the request reached the mock.
 */

import { startMockLiteLLM } from "../fixtures/litellm-server.ts"
import { writeFileSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const pluginVersion = process.argv[2] ?? "opencode-litellm"
const configDir = join(homedir(), ".config", "opencode")
const opencodeConfigPath = join(configDir, "opencode.json")
const authDir = join(homedir(), ".local", "share", "opencode")
const authJsonPath = join(authDir, "auth.json")

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\nFAIL: ${message}`)
    process.exit(1)
  }
}

function runOpenCode(args: string[]): { ok: boolean; stdout: string; stderr: string; code: number } {
  const result = Bun.spawnSync(["opencode", ...args], { stdout: "pipe", stderr: "pipe" })
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    code: result.exitCode ?? 1,
  }
}

const mock = startMockLiteLLM()
console.log(`Mock LiteLLM server: ${mock.url}`)
console.log(`Plugin version: ${pluginVersion}\n`)

try {
  // Clean up any existing auth.json that might interfere
  try { rmSync(authJsonPath) } catch { /* may not exist */ }

  // Seed opencode.json with provider.litellm pointing at mock
  mkdirSync(configDir, { recursive: true })
  writeFileSync(opencodeConfigPath, JSON.stringify({
    plugin: [pluginVersion],
    provider: {
      litellm: {
        npm: "@ai-sdk/openai-compatible",
        name: "LiteLLM",
        options: { baseURL: `${mock.url}/v1` },
        models: {
          "test-model-chat": { id: "test-model-chat", name: "test-model-chat" },
          "test-model-code": { id: "test-model-code", name: "test-model-code" },
          "test-model-vision": { id: "test-model-vision", name: "test-model-vision" },
        },
      },
    },
  }, null, 2))

  // ── Flow: model routing ────────────────────────────────────────────────────
  console.log("Flow: model routing (mock returns plain text)...")

  const chatRequestsBefore = mock.chatRequests.length

  const result = runOpenCode([
    "run",
    "--model", "litellm/test-model-chat",
    "say hello",
  ])
  assert(result.ok, `opencode run exited ${result.code}:\n${result.stderr}`)

  // opencode run renders to the terminal, not stdout when piped — assert
  // on the mock's request log instead: the request must have reached the mock.
  const newRequests = mock.chatRequests.slice(chatRequestsBefore)
  const chatHit = newRequests.some((r) => r.model === "test-model-chat")
  assert(chatHit, `No chat completion request for test-model-chat reached the mock.\n  requests: ${JSON.stringify(newRequests)}`)
  console.log("Flow: PASSED\n")

} finally {
  mock.stop()
}

console.log("All E2E tests passed.")
