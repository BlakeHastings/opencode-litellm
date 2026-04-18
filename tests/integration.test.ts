import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { writeFile, rm, mkdir } from "fs/promises"
import { join } from "path"
import { homedir } from "os"
import { startMockLiteLLM, DEFAULT_MODELS } from "./fixtures/litellm-server"

const PLUGIN_CONFIG_PATH = join(homedir(), ".config", "opencode", "litellm-plugin.json")
const TEST_API_KEY = "test-sk-integration-12345"

function makeCtx(storedApiKey?: string) {
  return {
    client: {
      auth: {
        get: async (_provider: string) =>
          storedApiKey ? { key: storedApiKey } : null,
      },
    },
    project: { id: "test", path: "/test" },
    directory: "/test",
    worktree: "/test",
    experimental_workspace: { register: () => {} },
    serverUrl: new URL("http://localhost:3000"),
    $: {} as any,
  } as any
}

const mockToolCtx = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "general",
  directory: "/test",
  worktree: "/test",
  abort: new AbortController().signal,
  metadata: () => {},
  ask: () => ({ pipe: () => {} }) as any,
} as any

async function clearPluginConfig() {
  try { await rm(PLUGIN_CONFIG_PATH) } catch { /* may not exist */ }
}

async function writePluginConfig(baseURL: string) {
  await mkdir(join(homedir(), ".config", "opencode"), { recursive: true })
  await writeFile(PLUGIN_CONFIG_PATH, JSON.stringify({ baseURL }, null, 2))
}

// ─── No-auth proxy ─────────────────────────────────────────────────────────

describe("integration: proxy without authentication", () => {
  let serverUrl: string
  let stopServer: () => void

  beforeAll(() => {
    const server = startMockLiteLLM()
    serverUrl = server.url
    stopServer = server.stop
  })

  afterAll(() => stopServer())
  beforeEach(clearPluginConfig)
  afterEach(clearPluginConfig)

  test("proxy /v1/models returns the configured model list", async () => {
    const res = await fetch(`${serverUrl}/v1/models`)
    expect(res.ok).toBe(true)

    const body = (await res.json()) as any
    expect(body.object).toBe("list")
    expect(body.data.map((m: any) => m.id)).toEqual(DEFAULT_MODELS)
  })

  test("config hook injects provider with all proxy models", async () => {
    await writePluginConfig(serverUrl)
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm).toBeDefined()
    expect(Object.keys(config.provider.litellm.models)).toEqual(DEFAULT_MODELS)
  })

  test("config hook sets baseURL with /v1 appended", async () => {
    await writePluginConfig(serverUrl)
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.baseURL).toBe(`${serverUrl}/v1`)
  })

  test("config hook does not set apiKey when none is stored", async () => {
    await writePluginConfig(serverUrl)
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.apiKey).toBeUndefined()
  })

  test("model entries use the proxy id as both key and name", async () => {
    await writePluginConfig(serverUrl)
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    for (const id of DEFAULT_MODELS) {
      expect(config.provider.litellm.models[id]).toEqual({ id, name: id })
    }
  })

  test("/litellm-setup flow: tool saves URL then config hook discovers models", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    // Simulate AI invoking litellm_configure after user runs /litellm-setup
    const result = await hooks.tool!.litellm_configure.execute(
      { base_url: serverUrl },
      mockToolCtx
    )
    expect(result).toContain("saved")
    expect(result).toContain("/connect litellm")

    // Simulate OpenCode restart: config hook reads saved URL and discovers models
    const config: any = {}
    await hooks.config!(config)

    expect(Object.keys(config.provider.litellm.models)).toEqual(DEFAULT_MODELS)
  })

  test("/litellm-setup flow: tool normalises /v1 suffix before saving", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    await hooks.tool!.litellm_configure.execute(
      { base_url: `${serverUrl}/v1` },
      mockToolCtx
    )

    const config: any = {}
    await hooks.config!(config)

    // Should still reach the proxy and discover models
    expect(Object.keys(config.provider.litellm.models)).toEqual(DEFAULT_MODELS)
  })
})

// ─── Authenticated proxy ────────────────────────────────────────────────────

describe("integration: proxy with API key authentication", () => {
  let serverUrl: string
  let stopServer: () => void

  beforeAll(() => {
    const server = startMockLiteLLM({ apiKey: TEST_API_KEY })
    serverUrl = server.url
    stopServer = server.stop
  })

  afterAll(() => stopServer())
  beforeEach(clearPluginConfig)
  afterEach(clearPluginConfig)

  test("proxy rejects unauthenticated requests with 401", async () => {
    const res = await fetch(`${serverUrl}/v1/models`)
    expect(res.status).toBe(401)
  })

  test("proxy accepts requests with correct Bearer token", async () => {
    const res = await fetch(`${serverUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${TEST_API_KEY}` },
    })
    expect(res.ok).toBe(true)
  })

  test("config hook injects provider when correct API key is stored", async () => {
    await writePluginConfig(serverUrl)
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx(TEST_API_KEY))

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm?.models).toBeDefined()
    expect(Object.keys(config.provider.litellm.models)).toEqual(DEFAULT_MODELS)
    expect(config.provider.litellm.options.apiKey).toBe(TEST_API_KEY)
  })

  test("config hook skips provider injection when API key is wrong", async () => {
    await writePluginConfig(serverUrl)
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx("wrong-key"))

    const config: any = {}
    await hooks.config!(config)

    // 401 causes fetchModels to throw; hook exits silently
    expect(config.provider?.litellm).toBeUndefined()
  })

  test("config hook skips provider injection when no API key is stored", async () => {
    await writePluginConfig(serverUrl)
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx()) // no stored key

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm).toBeUndefined()
  })
})

// ─── Custom model list ──────────────────────────────────────────────────────

describe("integration: proxy with custom model list", () => {
  const CUSTOM_MODELS = ["company-llm-fast", "company-llm-smart", "company-embed"]
  let serverUrl: string
  let stopServer: () => void

  beforeAll(() => {
    const server = startMockLiteLLM({ models: CUSTOM_MODELS })
    serverUrl = server.url
    stopServer = server.stop
  })

  afterAll(() => stopServer())
  beforeEach(clearPluginConfig)
  afterEach(clearPluginConfig)

  test("config hook surfaces exactly the models the proxy advertises", async () => {
    await writePluginConfig(serverUrl)
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(Object.keys(config.provider.litellm.models)).toEqual(CUSTOM_MODELS)
  })
})
