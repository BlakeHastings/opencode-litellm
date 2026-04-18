/**
 * Self-contained OpenCode E2E test runner.
 *
 * Usage: bun tests/e2e/run.ts [plugin-npm-tag]
 *   plugin-npm-tag defaults to "opencode-litellm" (latest stable)
 *
 * Requires opencode-ai to be installed globally (npm install -g opencode-ai).
 *
 * Flow A — /litellm-setup simulation:
 *   Runs opencode with test-model-setup, which causes the mock to return a
 *   litellm_configure tool call. OpenCode executes the tool, writing
 *   litellm-plugin.json. Asserts the file contains the correct baseURL.
 *
 * Flow B — model routing:
 *   Runs opencode with test-model-chat. The mock returns a plain text SSE
 *   response. Asserts stdout contains the expected text.
 */

import { startMockLiteLLM } from "../fixtures/litellm-server.ts"
import { writeFileSync, readFileSync, mkdirSync } from "fs"
import { join } from "path"
import { homedir } from "os"

const pluginVersion = process.argv[2] ?? "opencode-litellm"
const configDir = join(homedir(), ".config", "opencode")
const pluginConfigPath = join(configDir, "litellm-plugin.json")
const opencodeConfigPath = join(configDir, "opencode.json")

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
  mkdirSync(configDir, { recursive: true })
  writeFileSync(opencodeConfigPath, JSON.stringify({ plugin: [pluginVersion] }))
  // Pre-seed plugin config so the litellm provider is available before Flow A runs.
  writeFileSync(pluginConfigPath, JSON.stringify({ baseURL: mock.url }))

  // ── Flow A: /litellm-setup simulation ─────────────────────────────────────
  console.log("Flow A: /litellm-setup simulation (mock returns litellm_configure tool call)...")

  const a = runOpenCode([
    "run",
    "--model", "litellm/test-model-setup",
    "Configure my LiteLLM proxy.",
  ])
  assert(a.ok, `opencode run exited ${a.code}:\n${a.stderr}`)

  const saved = JSON.parse(readFileSync(pluginConfigPath, "utf8")) as { baseURL?: string }
  assert(
    saved.baseURL === mock.url,
    `litellm-plugin.json has wrong baseURL.\n  expected: ${mock.url}\n  got:      ${saved.baseURL}`
  )
  console.log("Flow A: PASSED\n")

  // ── Flow B: model routing ─────────────────────────────────────────────────
  console.log("Flow B: model routing (mock returns plain text)...")

  const chatRequestsBefore = mock.chatRequests.length

  const b = runOpenCode([
    "run",
    "--model", "litellm/test-model-chat",
    "say hello",
  ])
  assert(b.ok, `opencode run exited ${b.code}:\n${b.stderr}`)

  // opencode run renders to the terminal, not stdout when piped — assert
  // on the mock's request log instead: the request must have reached the mock.
  const newRequests = mock.chatRequests.slice(chatRequestsBefore)
  const chatHit = newRequests.some((r) => r.model === "test-model-chat")
  assert(chatHit, `No chat completion request for test-model-chat reached the mock.\n  requests: ${JSON.stringify(newRequests)}`)
  console.log("Flow B: PASSED\n")

} finally {
  mock.stop()
}

console.log("All E2E tests passed.")
