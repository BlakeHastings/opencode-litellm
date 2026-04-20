import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import { writeFile, rm, mkdir, readFile } from "fs/promises"
import { join } from "path"
import { homedir } from "os"
import { startMockLiteLLM, DEFAULT_MODELS } from "./fixtures/litellm-server"

const OPENCODE_CONFIG_PATH = join(homedir(), ".config", "opencode", "opencode.json")
const AUTH_STORE_PATH = join(homedir(), ".local", "share", "opencode", "auth.json")
const TEST_API_KEY = "test-sk-integration-12345"

function makeCtx(storedApiKey?: string) {
  return {
    client: {
      auth: {
        get: async (_provider: string) =>
          storedApiKey ? { key: storedApiKey } : null,
      },
      app: {
        log: () => Promise.resolve(),
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

async function clearOpencodeConfig() {
  try { await rm(OPENCODE_CONFIG_PATH) } catch { /* may not exist */ }
}

async function clearAuthJson() {
  try { await rm(AUTH_STORE_PATH) } catch { /* may not exist */ }
}

async function writeOpencodeConfig(cfg: Record<string, unknown>) {
  await mkdir(join(homedir(), ".config", "opencode"), { recursive: true })
  await writeFile(OPENCODE_CONFIG_PATH, JSON.stringify(cfg, null, 2))
}

async function writeAuthJson(auth: Record<string, unknown>) {
  await mkdir(join(homedir(), ".local", "share", "opencode"), { recursive: true })
  await writeFile(AUTH_STORE_PATH, JSON.stringify(auth, null, 2))
}

// ─── No-auth proxy ─────────────────────────────────────────────────────────

describe("integration: proxy without authentication", () => {
  let serverUrl: string
  let stopServer: () => void
  let backupOpencodeConfig: string | undefined
  let backupAuthJson: string | undefined

  beforeAll(async () => {
    const server = startMockLiteLLM()
    serverUrl = server.url
    stopServer = server.stop

    // Back up real files if they exist
    try {
      backupOpencodeConfig = await readFile(OPENCODE_CONFIG_PATH, "utf8")
    } catch { /* doesn't exist */ }

    try {
      backupAuthJson = await readFile(AUTH_STORE_PATH, "utf8")
    } catch { /* doesn't exist */ }
  })

  afterAll(async () => {
    stopServer()

    // Restore real files
    if (backupOpencodeConfig) {
      await mkdir(join(homedir(), ".config", "opencode"), { recursive: true })
      await writeFile(OPENCODE_CONFIG_PATH, backupOpencodeConfig)
    } else {
      await clearOpencodeConfig()
    }

    if (backupAuthJson) {
      await mkdir(join(homedir(), ".local", "share", "opencode"), { recursive: true })
      await writeFile(AUTH_STORE_PATH, backupAuthJson)
    } else {
      await clearAuthJson()
    }
  })

  beforeEach(async () => {
    await clearOpencodeConfig()
    await clearAuthJson()
  })

  afterEach(async () => {
    await clearOpencodeConfig()
    await clearAuthJson()
  })

  test("proxy /v1/models returns the configured model list", async () => {
    const res = await fetch(`${serverUrl}/v1/models`)
    expect(res.ok).toBe(true)

    const body = (await res.json()) as any
    expect(body.object).toBe("list")
    expect(body.data.map((m: any) => m.id)).toEqual(DEFAULT_MODELS)
  })

  test("config hook injects provider with all proxy models when baseURL is in opencode.json", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: `${serverUrl}/v1` },
        },
      },
    })

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm).toBeDefined()
    expect(Object.keys(config.provider.litellm.models)).toEqual(DEFAULT_MODELS)
  })

  test("config hook sets baseURL with /v1 appended", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: `${serverUrl}/v1` },
        },
      },
    })

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.baseURL).toBe(`${serverUrl}/v1`)
  })

  test("config hook does not set apiKey when none is stored", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: `${serverUrl}/v1` },
        },
      },
    })

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.apiKey).toBeUndefined()
  })

  test("model entries use the proxy id as both key and name", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: `${serverUrl}/v1` },
        },
      },
    })

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    for (const id of DEFAULT_MODELS) {
      expect(config.provider.litellm.models[id]).toEqual({ id, name: id })
    }
  })

  test("auth authorize flow: baseURL and apiKey written to opencode.json, config hook discovers models", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())
    const method = hooks.auth?.methods[0] as any

    // Simulate /connect litellm: user provides URL and no key
    const result = await method.authorize({
      baseURL: serverUrl,
      key: "",
    })
    expect(result.type).toBe("success")
    expect(result.key).toBe("no-key")

    // Simulate OpenCode restart: config hook reads saved URL and discovers models
    const config: any = {}
    await hooks.config!(config)

    expect(Object.keys(config.provider.litellm.models)).toEqual(DEFAULT_MODELS)
  })

  test("auth authorize normalizes /v1 suffix before saving", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())
    const method = hooks.auth?.methods[0] as any

    await method.authorize({
      baseURL: `${serverUrl}/v1`,
      key: "",
    })

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
  let backupOpencodeConfig: string | undefined
  let backupAuthJson: string | undefined

  beforeAll(async () => {
    const server = startMockLiteLLM({ apiKey: TEST_API_KEY })
    serverUrl = server.url
    stopServer = server.stop

    // Back up real files if they exist
    try {
      backupOpencodeConfig = await readFile(OPENCODE_CONFIG_PATH, "utf8")
    } catch { /* doesn't exist */ }

    try {
      backupAuthJson = await readFile(AUTH_STORE_PATH, "utf8")
    } catch { /* doesn't exist */ }
  })

  afterAll(async () => {
    stopServer()

    // Restore real files
    if (backupOpencodeConfig) {
      await mkdir(join(homedir(), ".config", "opencode"), { recursive: true })
      await writeFile(OPENCODE_CONFIG_PATH, backupOpencodeConfig)
    } else {
      await clearOpencodeConfig()
    }

    if (backupAuthJson) {
      await mkdir(join(homedir(), ".local", "share", "opencode"), { recursive: true })
      await writeFile(AUTH_STORE_PATH, backupAuthJson)
    } else {
      await clearAuthJson()
    }
  })

  beforeEach(async () => {
    await clearOpencodeConfig()
    await clearAuthJson()
  })

  afterEach(async () => {
    await clearOpencodeConfig()
    await clearAuthJson()
  })

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

  test("config hook injects provider when correct API key is stored in auth.json", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: `${serverUrl}/v1` },
        },
      },
    })
    await writeAuthJson({ litellm: { key: TEST_API_KEY } })

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm?.models).toBeDefined()
    expect(Object.keys(config.provider.litellm.models)).toEqual(DEFAULT_MODELS)
    expect(config.provider.litellm.options.apiKey).toBe(TEST_API_KEY)
  })

  test("config hook injects placeholder when API key is wrong (401)", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: `${serverUrl}/v1` },
        },
      },
    })
    await writeAuthJson({ litellm: { key: "wrong-key" } })

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    // Provider always appears in runtime config so /connect shows it; models
    // fall back to the placeholder when fetchModels fails.
    expect(config.provider?.litellm).toBeDefined()
    expect(config.provider.litellm.models.setup).toBeDefined()
  })

  test("config hook injects placeholder when no API key is stored", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: `${serverUrl}/v1` },
        },
      },
    })

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm).toBeDefined()
    expect(config.provider.litellm.models.setup).toBeDefined()
  })

  test("config hook discovers models and apiKey when OpenCode's auth store has both", async () => {
    // Simulate OpenCode's native /connect flow: after the user fills in the
    // prompts, OpenCode persists every prompt value under metadata alongside
    // the key. Our plugin reads both from there on startup.
    await writeAuthJson({
      litellm: {
        type: "api",
        key: TEST_API_KEY,
        metadata: { baseURL: serverUrl },
      },
    })

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(Object.keys(config.provider.litellm.models)).toEqual(DEFAULT_MODELS)
    expect(config.provider.litellm.options.apiKey).toBe(TEST_API_KEY)
  })
})

// ─── Custom model list ──────────────────────────────────────────────────────

describe("integration: proxy with custom model list", () => {
  const CUSTOM_MODELS = ["company-llm-fast", "company-llm-smart", "company-embed"]
  let serverUrl: string
  let stopServer: () => void
  let backupOpencodeConfig: string | undefined
  let backupAuthJson: string | undefined

  beforeAll(async () => {
    const server = startMockLiteLLM({ models: CUSTOM_MODELS })
    serverUrl = server.url
    stopServer = server.stop

    // Back up real files if they exist
    try {
      backupOpencodeConfig = await readFile(OPENCODE_CONFIG_PATH, "utf8")
    } catch { /* doesn't exist */ }

    try {
      backupAuthJson = await readFile(AUTH_STORE_PATH, "utf8")
    } catch { /* doesn't exist */ }
  })

  afterAll(async () => {
    stopServer()

    // Restore real files
    if (backupOpencodeConfig) {
      await mkdir(join(homedir(), ".config", "opencode"), { recursive: true })
      await writeFile(OPENCODE_CONFIG_PATH, backupOpencodeConfig)
    } else {
      await clearOpencodeConfig()
    }

    if (backupAuthJson) {
      await mkdir(join(homedir(), ".local", "share", "opencode"), { recursive: true })
      await writeFile(AUTH_STORE_PATH, backupAuthJson)
    } else {
      await clearAuthJson()
    }
  })

  beforeEach(async () => {
    await clearOpencodeConfig()
    await clearAuthJson()
  })

  afterEach(async () => {
    await clearOpencodeConfig()
    await clearAuthJson()
  })

  test("config hook surfaces exactly the models the proxy advertises", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: `${serverUrl}/v1` },
        },
      },
    })

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(Object.keys(config.provider.litellm.models)).toEqual(CUSTOM_MODELS)
  })
})
