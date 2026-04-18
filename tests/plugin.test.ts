import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { writeFile, readFile, rm } from "fs/promises"
import { join } from "path"
import { homedir } from "os"

const PLUGIN_CONFIG_PATH = join(homedir(), ".config", "opencode", "litellm-plugin.json")
const LITELLM_URL = process.env.LITELLM_URL ?? "http://192.168.0.52:4000"
const runIntegration = process.env.LITELLM_URL !== undefined

// Minimal PluginInput mock — only auth.get is exercised by the config hook
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

// litellm_configure doesn't use any ToolContext fields
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

// Fake model list returned by mocked fetch
const MOCK_MODEL_IDS = ["mock-model-a", "mock-model-b", "mock-model-c"]

function mockFetchSuccess() {
  const original = global.fetch
  global.fetch = mock(async () => ({
    ok: true,
    json: async () => ({ data: MOCK_MODEL_IDS.map((id) => ({ id })) }),
  })) as any
  return () => { global.fetch = original }
}

function mockFetchFailure() {
  const original = global.fetch
  global.fetch = mock(async () => ({ ok: false, status: 503 })) as any
  return () => { global.fetch = original }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function clearPluginConfig() {
  try { await rm(PLUGIN_CONFIG_PATH) } catch { /* file may not exist */ }
}

async function writePluginConfig(baseURL: string) {
  await writeFile(PLUGIN_CONFIG_PATH, JSON.stringify({ baseURL }, null, 2))
}

async function readPluginConfig() {
  return JSON.parse(await readFile(PLUGIN_CONFIG_PATH, "utf8"))
}

// ─── Plugin structure ──────────────────────────────────────────────────────

describe("plugin structure", () => {
  test("loads and returns auth, tool, and config hooks", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    expect(hooks.auth).toBeDefined()
    expect(hooks.tool).toBeDefined()
    expect(hooks.config).toBeDefined()
  })

  test("auth hook targets the litellm provider", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    expect(hooks.auth?.provider).toBe("litellm")
  })

  test("auth method is api type", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const method = hooks.auth?.methods[0] as any
    expect(method?.type).toBe("api")
  })

  test("auth method prompts include apiKey field", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const method = hooks.auth?.methods[0] as any
    const keys = (method?.prompts ?? []).map((p: any) => p.key)
    expect(keys).toContain("apiKey")
  })

  test("tool hook exposes litellm_configure", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    expect(hooks.tool?.litellm_configure).toBeDefined()
    expect(typeof hooks.tool?.litellm_configure.execute).toBe("function")
  })
})

// ─── Auth: authorize ───────────────────────────────────────────────────────

describe("auth authorize", () => {
  test("returns success with provided API key", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())
    const method = hooks.auth?.methods[0] as any

    const result = await method.authorize({ apiKey: "sk-test-key" })
    expect(result.type).toBe("success")
    expect(result.key).toBe("sk-test-key")
  })

  test("stores no-key sentinel when API key is blank", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())
    const method = hooks.auth?.methods[0] as any

    const result = await method.authorize({ apiKey: "" })
    expect(result.type).toBe("success")
    expect(result.key).toBe("no-key")
  })

  test("stores no-key sentinel when apiKey input is absent", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())
    const method = hooks.auth?.methods[0] as any

    const result = await method.authorize({})
    expect(result.type).toBe("success")
    expect(result.key).toBe("no-key")
  })
})

// ─── Tool: litellm_configure ───────────────────────────────────────────────

describe("litellm_configure tool", () => {
  beforeEach(clearPluginConfig)
  afterEach(clearPluginConfig)

  test("saves base URL verbatim", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const { tool: tools } = await plugin(makeCtx())

    await tools!.litellm_configure.execute(
      { base_url: "http://my-host:4000" },
      mockToolCtx
    )

    const saved = await readPluginConfig()
    expect(saved.baseURL).toBe("http://my-host:4000")
  })

  test("strips /v1 suffix from URL", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const { tool: tools } = await plugin(makeCtx())

    await tools!.litellm_configure.execute(
      { base_url: "http://my-host:4000/v1" },
      mockToolCtx
    )

    const saved = await readPluginConfig()
    expect(saved.baseURL).toBe("http://my-host:4000")
  })

  test("strips trailing slash from URL", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const { tool: tools } = await plugin(makeCtx())

    await tools!.litellm_configure.execute(
      { base_url: "http://my-host:4000/" },
      mockToolCtx
    )

    const saved = await readPluginConfig()
    expect(saved.baseURL).toBe("http://my-host:4000")
  })

  test("strips /v1/ with trailing slash", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const { tool: tools } = await plugin(makeCtx())

    await tools!.litellm_configure.execute(
      { base_url: "http://my-host:4000/v1/" },
      mockToolCtx
    )

    const saved = await readPluginConfig()
    expect(saved.baseURL).toBe("http://my-host:4000")
  })

  test("writes valid JSON to the config file", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const { tool: tools } = await plugin(makeCtx())

    await tools!.litellm_configure.execute(
      { base_url: "http://my-host:4000" },
      mockToolCtx
    )

    const raw = await readFile(PLUGIN_CONFIG_PATH, "utf8")
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  test("result message includes the saved URL", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const { tool: tools } = await plugin(makeCtx())

    const result = await tools!.litellm_configure.execute(
      { base_url: "http://my-host:4000" },
      mockToolCtx
    )

    expect(result).toContain("my-host:4000")
  })

  test("result message instructs user to run /connect litellm", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const { tool: tools } = await plugin(makeCtx())

    const result = await tools!.litellm_configure.execute(
      { base_url: "http://my-host:4000" },
      mockToolCtx
    )

    expect(result).toContain("/connect litellm")
  })

  test("overwrites an existing config file", async () => {
    await writePluginConfig("http://old-host:4000")

    const { default: plugin } = await import("../src/index.ts")
    const { tool: tools } = await plugin(makeCtx())

    await tools!.litellm_configure.execute(
      { base_url: "http://new-host:4000" },
      mockToolCtx
    )

    const saved = await readPluginConfig()
    expect(saved.baseURL).toBe("http://new-host:4000")
  })
})

// ─── Config hook ───────────────────────────────────────────────────────────

describe("config hook", () => {
  let restoreFetch: (() => void) | undefined

  beforeEach(clearPluginConfig)

  afterEach(async () => {
    restoreFetch?.()
    restoreFetch = undefined
    await clearPluginConfig()
  })

  test("always injects the litellm-setup command", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.command?.["litellm-setup"]).toBeDefined()
  })

  test("litellm-setup command template references litellm_configure tool", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.command?.["litellm-setup"].template).toContain("litellm_configure")
  })

  test("litellm-setup command has a description", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.command?.["litellm-setup"].description).toBeTruthy()
  })

  test("does not inject litellm provider when no baseURL is saved", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm).toBeUndefined()
  })

  test("injects litellm provider when baseURL is saved and models are reachable", async () => {
    await writePluginConfig("http://my-host:4000")
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm).toBeDefined()
    expect(config.provider.litellm.npm).toBe("@ai-sdk/openai-compatible")
  })

  test("sets baseURL in provider options with /v1 appended", async () => {
    await writePluginConfig("http://my-host:4000")
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.baseURL).toBe("http://my-host:4000/v1")
  })

  test("provider models map contains all ids returned by LiteLLM", async () => {
    await writePluginConfig("http://my-host:4000")
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    const modelKeys = Object.keys(config.provider.litellm.models)
    expect(modelKeys).toEqual(MOCK_MODEL_IDS)
  })

  test("each model entry has matching id and name", async () => {
    await writePluginConfig("http://my-host:4000")
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    for (const id of MOCK_MODEL_IDS) {
      expect(config.provider.litellm.models[id].id).toBe(id)
      expect(config.provider.litellm.models[id].name).toBe(id)
    }
  })

  test("does not set apiKey in options when no key is stored", async () => {
    await writePluginConfig("http://my-host:4000")
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.apiKey).toBeUndefined()
  })

  test("sets apiKey in options when a real key is stored", async () => {
    await writePluginConfig("http://my-host:4000")
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx("sk-real-key"))

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.apiKey).toBe("sk-real-key")
  })

  test("treats no-key sentinel as absent — apiKey not set in options", async () => {
    await writePluginConfig("http://my-host:4000")
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx("no-key"))

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.apiKey).toBeUndefined()
  })

  test("does not throw when LiteLLM is unreachable", async () => {
    await writePluginConfig("http://my-host:4000")
    restoreFetch = mockFetchFailure()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await expect(hooks.config!(config)).resolves.toBeUndefined()
  })

  test("does not inject provider when LiteLLM is unreachable", async () => {
    await writePluginConfig("http://my-host:4000")
    restoreFetch = mockFetchFailure()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm).toBeUndefined()
  })
})

// ─── Integration: live LiteLLM ─────────────────────────────────────────────
// Run with:  LITELLM_URL=http://192.168.0.52:4000 bun test

if (runIntegration) {
  describe("integration: live LiteLLM proxy", () => {
    beforeEach(clearPluginConfig)
    afterEach(clearPluginConfig)

    test("proxy returns a non-empty model list", async () => {
      const res = await fetch(`${LITELLM_URL}/v1/models`, {
        signal: AbortSignal.timeout(5000),
      })
      expect(res.ok).toBe(true)

      const body = (await res.json()) as any
      expect(Array.isArray(body.data)).toBe(true)
      expect(body.data.length).toBeGreaterThan(0)
    })

    test("config hook discovers and injects real models", async () => {
      await writePluginConfig(LITELLM_URL)

      const { default: plugin } = await import("../src/index.ts")
      const hooks = await plugin(makeCtx())

      const config: any = {}
      await hooks.config!(config)

      const models = config.provider?.litellm?.models ?? {}
      expect(Object.keys(models).length).toBeGreaterThan(0)
    })

    test("/litellm-setup flow: tool saves URL, config hook discovers models", async () => {
      const { default: plugin } = await import("../src/index.ts")
      const hooks = await plugin(makeCtx())

      // Step 1 — AI uses litellm_configure after user runs /litellm-setup
      const toolResult = await hooks.tool!.litellm_configure.execute(
        { base_url: LITELLM_URL },
        mockToolCtx
      )
      expect(toolResult).toContain("saved")

      const saved = await readPluginConfig()
      expect(saved.baseURL).toBe(LITELLM_URL)

      // Step 2 — OpenCode restarts, config hook discovers models
      const config: any = {}
      await hooks.config!(config)

      expect(config.provider?.litellm?.models).toBeDefined()
      expect(Object.keys(config.provider.litellm.models).length).toBeGreaterThan(0)
    })
  })
}
