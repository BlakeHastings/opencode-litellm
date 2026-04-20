import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test"
import { writeFile, readFile, rm, mkdir } from "fs/promises"
import { join, dirname } from "path"
import { homedir } from "os"

const OPENCODE_CONFIG_PATH = join(homedir(), ".config", "opencode", "opencode.json")
const AUTH_STORE_PATH = join(homedir(), ".local", "share", "opencode", "auth.json")

// Minimal PluginInput mock
function makeCtx(storedApiKey?: string) {
  return {
    client: {
      auth: {
        get: async (_provider: string) =>
          storedApiKey ? { key: storedApiKey } : null,
      },
      app: {
        log: mock(() => Promise.resolve()),
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

async function readOpencodeConfig() {
  return JSON.parse(await readFile(OPENCODE_CONFIG_PATH, "utf8"))
}

async function readAuthJson() {
  return JSON.parse(await readFile(AUTH_STORE_PATH, "utf8"))
}

// ─── Plugin structure ──────────────────────────────────────────────────────

describe("plugin structure", () => {
  test("loads and returns auth, config, and chat.params hooks", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    expect(hooks.auth).toBeDefined()
    expect(hooks.config).toBeDefined()
    expect(hooks["chat.params"]).toBeDefined()
    expect(hooks.tool).toBeUndefined()
    expect(hooks.command).toBeUndefined()
  })

  test("auth hook targets the litellm provider", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    expect(hooks.auth?.provider).toBe("litellm")
  })

  test("auth has exactly one api-type method", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    expect(hooks.auth?.methods).toBeDefined()
    expect(hooks.auth?.methods.length).toBe(1)
    const method = hooks.auth?.methods[0] as any
    expect(method?.type).toBe("api")
  })

  test("auth method has a baseURL prompt (key is collected by OpenCode's built-in API key prompt)", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const method = hooks.auth?.methods[0] as any
    const prompts = method?.prompts ?? []
    expect(prompts.length).toBe(1)
    expect(prompts[0].key).toBe("baseURL")
  })

  test("auth method has authorize function", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const method = hooks.auth?.methods[0] as any
    expect(typeof method?.authorize).toBe("function")
  })
})

// ─── Auth: authorize ───────────────────────────────────────────────────────

describe("auth authorize", () => {
  let backupOpencodeConfig: string | undefined
  let backupAuthJson: string | undefined

  beforeAll(async () => {
    try { backupOpencodeConfig = await readFile(OPENCODE_CONFIG_PATH, "utf8") } catch { /* not present */ }
    try { backupAuthJson = await readFile(AUTH_STORE_PATH, "utf8") } catch { /* not present */ }
  })

  afterAll(async () => {
    if (backupOpencodeConfig) {
      await mkdir(dirname(OPENCODE_CONFIG_PATH), { recursive: true })
      await writeFile(OPENCODE_CONFIG_PATH, backupOpencodeConfig)
    } else {
      await clearOpencodeConfig()
    }

    if (backupAuthJson) {
      await mkdir(dirname(AUTH_STORE_PATH), { recursive: true })
      await writeFile(AUTH_STORE_PATH, backupAuthJson)
    } else {
      await clearAuthJson()
    }
  })

  beforeEach(clearOpencodeConfig)
  afterEach(clearOpencodeConfig)

  test("authorize with baseURL and apiKey writes opencode.json and returns success with key", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())
    const method = hooks.auth?.methods[0] as any

    const result = await method.authorize({
      baseURL: "http://my-host:4000/v1",
      key: "sk-x",
    })

    expect(result.type).toBe("success")
    expect(result.key).toBe("sk-x")

    const cfg = await readOpencodeConfig()
    expect(cfg.provider?.litellm?.options?.baseURL).toBe("http://my-host:4000/v1")
  })

  test("authorize strips /v1 suffix when saving baseURL", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())
    const method = hooks.auth?.methods[0] as any

    await method.authorize({
      baseURL: "http://my-host:4000/v1",
      key: "sk-x",
    })

    const cfg = await readOpencodeConfig()
    expect(cfg.provider?.litellm?.options?.baseURL).toBe("http://my-host:4000/v1")
  })

  test("authorize with no apiKey returns no-key sentinel", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())
    const method = hooks.auth?.methods[0] as any

    const result = await method.authorize({ baseURL: "http://my-host:4000" })

    expect(result.type).toBe("success")
    expect(result.key).toBe("no-key")
  })

  test("authorize with blank baseURL defaults to localhost:4000", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())
    const method = hooks.auth?.methods[0] as any

    const result = await method.authorize({ baseURL: "" })

    expect(result.type).toBe("success")

    const cfg = await readOpencodeConfig()
    expect(cfg.provider?.litellm?.options?.baseURL).toBe("http://localhost:4000/v1")
  })

  test("authorize preserves other keys in opencode.json", async () => {
    const existing = {
      $schema: "https://example.com",
      other: "value",
      provider: {
        openai: { name: "OpenAI" },
      },
    }
    await writeOpencodeConfig(existing)

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())
    const method = hooks.auth?.methods[0] as any

    await method.authorize({
      baseURL: "http://my-host:4000",
      key: "sk-test",
    })

    const cfg = await readOpencodeConfig()
    expect(cfg.$schema).toBe("https://example.com")
    expect(cfg.other).toBe("value")
    expect(cfg.provider?.openai?.name).toBe("OpenAI")
    expect(cfg.provider?.litellm).toBeDefined()
  })
})

// ─── Config hook ───────────────────────────────────────────────────────────

describe("config hook", () => {
  let restoreFetch: (() => void) | undefined
  let backupOpencodeConfig: string | undefined
  let backupAuthJson: string | undefined

  beforeAll(async () => {
    // Back up real files if they exist
    try {
      backupOpencodeConfig = await readFile(OPENCODE_CONFIG_PATH, "utf8")
    } catch { /* doesn't exist */ }

    try {
      backupAuthJson = await readFile(AUTH_STORE_PATH, "utf8")
    } catch { /* doesn't exist */ }
  })

  afterAll(async () => {
    // Restore real files
    if (backupOpencodeConfig) {
      await mkdir(dirname(OPENCODE_CONFIG_PATH), { recursive: true })
      await writeFile(OPENCODE_CONFIG_PATH, backupOpencodeConfig)
    } else {
      await clearOpencodeConfig()
    }

    if (backupAuthJson) {
      await mkdir(dirname(AUTH_STORE_PATH), { recursive: true })
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
    restoreFetch?.()
    restoreFetch = undefined
    await clearOpencodeConfig()
    await clearAuthJson()
  })

  test("config hook injects runtime placeholder when no auth/config is present", async () => {
    restoreFetch = mockFetchFailure()
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm).toBeDefined()
    expect(config.provider.litellm.options.baseURL).toBe("http://localhost:4000/v1")
    expect(config.provider.litellm.models.setup).toBeDefined()
  })

  test("config hook with no baseURL saved does not throw", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await expect(hooks.config!(config)).resolves.toBeUndefined()
  })

  test("config hook injects provider when baseURL is present and fetch succeeds", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: "http://my-host:4000/v1" },
        },
      },
    })
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider?.litellm).toBeDefined()
    expect(config.provider.litellm.npm).toBe("@ai-sdk/openai-compatible")
  })

  test("config hook sets baseURL in provider options with /v1 appended", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: "http://my-host:4000/v1" },
        },
      },
    })
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.baseURL).toBe("http://my-host:4000/v1")
  })

  test("config hook maps all fetched model IDs to models", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: "http://my-host:4000/v1" },
        },
      },
    })
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    const modelKeys = Object.keys(config.provider.litellm.models)
    expect(modelKeys).toEqual(MOCK_MODEL_IDS)
  })

  test("config hook each model entry has matching id and name", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: "http://my-host:4000/v1" },
        },
      },
    })
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

  test("config hook does not set apiKey when no key is stored", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: "http://my-host:4000/v1" },
        },
      },
    })
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.apiKey).toBeUndefined()
  })

  test("config hook sets apiKey when a real key is stored in auth.json", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: "http://my-host:4000/v1" },
        },
      },
    })
    await writeAuthJson({ litellm: { key: "sk-real-key" } })
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.apiKey).toBe("sk-real-key")
  })

  test("config hook treats no-key sentinel in auth.json as absent", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: "http://my-host:4000/v1" },
        },
      },
    })
    await writeAuthJson({ litellm: { key: "no-key" } })
    restoreFetch = mockFetchSuccess()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    expect(config.provider.litellm.options.apiKey).toBeUndefined()
  })

  test("config hook does not throw when LiteLLM is unreachable", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: "http://my-host:4000/v1" },
        },
      },
    })
    restoreFetch = mockFetchFailure()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await expect(hooks.config!(config)).resolves.toBeUndefined()
  })

  test("config hook injects placeholder provider when LiteLLM is unreachable", async () => {
    await writeOpencodeConfig({
      provider: {
        litellm: {
          options: { baseURL: "http://my-host:4000/v1" },
        },
      },
    })
    restoreFetch = mockFetchFailure()

    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const config: any = {}
    await hooks.config!(config)

    // Provider must always appear in runtime config so /connect shows it on
    // the first launch, even if the proxy is unreachable.
    expect(config.provider?.litellm).toBeDefined()
    expect(config.provider.litellm.models.setup).toBeDefined()
  })
})

// ─── chat.params hook ──────────────────────────────────────────────────────

function makeChatParamsInput(providerID: string, sessionID = "ses_01TESTID") {
  return {
    sessionID,
    agent: "coder",
    model: { providerID, modelID: "gpt-4o" } as any,
    provider: { source: "config", info: { id: providerID }, options: {} } as any,
    message: {} as any,
  }
}

describe("chat.params hook", () => {
  test("sets providerOptions.litellm.litellm_session_id for litellm provider", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const input = makeChatParamsInput("litellm", "ses_abc123")
    const output: any = { temperature: 1, topP: 1, topK: 40, maxOutputTokens: undefined, options: {} }

    await hooks["chat.params"]!(input, output)

    expect(output.options.providerOptions.litellm.litellm_session_id).toBe("ses_abc123")
  })

  test("is a no-op for non-litellm providers", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const input = makeChatParamsInput("openai")
    const output: any = { temperature: 1, topP: 1, topK: 40, maxOutputTokens: undefined, options: {} }

    await hooks["chat.params"]!(input, output)

    expect(output.options.providerOptions).toBeUndefined()
  })

  test("preserves existing providerOptions.litellm keys alongside session_id", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const input = makeChatParamsInput("litellm", "ses_xyz")
    const output: any = {
      temperature: 1, topP: 1, topK: 40, maxOutputTokens: undefined,
      options: { providerOptions: { litellm: { trace_id: "existing-trace" } } },
    }

    await hooks["chat.params"]!(input, output)

    expect(output.options.providerOptions.litellm.trace_id).toBe("existing-trace")
    expect(output.options.providerOptions.litellm.litellm_session_id).toBe("ses_xyz")
  })

  test("preserves existing options keys outside providerOptions", async () => {
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(makeCtx())

    const input = makeChatParamsInput("litellm", "ses_xyz")
    const output: any = {
      temperature: 1, topP: 1, topK: 40, maxOutputTokens: undefined,
      options: { user: "user-123" },
    }

    await hooks["chat.params"]!(input, output)

    expect(output.options.user).toBe("user-123")
    expect(output.options.providerOptions.litellm.litellm_session_id).toBe("ses_xyz")
  })

  test("emits a log line containing the session_id", async () => {
    const ctx = makeCtx()
    const { default: plugin } = await import("../src/index.ts")
    const hooks = await plugin(ctx)

    const input = makeChatParamsInput("litellm", "ses_logtest")
    const output: any = { temperature: 1, topP: 1, topK: 40, maxOutputTokens: undefined, options: {} }

    await hooks["chat.params"]!(input, output)

    const logCalls: string[] = (ctx.client.app.log as any).mock.calls.map(
      (call: any[]) => call[0]?.body?.message ?? ""
    )
    expect(logCalls.some((msg: string) => msg.includes("ses_logtest"))).toBe(true)
  })
})
