import type { Plugin } from "@opencode-ai/plugin"
import { mkdir, readFile, writeFile } from "fs/promises"
import { dirname, join } from "path"
import { homedir } from "os"

interface LiteLLMModel {
  id: string
}

interface LiteLLMModelsResponse {
  data: LiteLLMModel[]
}

const OPENCODE_CONFIG_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "opencode.json"
)

const AUTH_STORE_PATH = join(
  homedir(),
  ".local",
  "share",
  "opencode",
  "auth.json"
)

function makeLog(client: any) {
  return (...args: unknown[]): void => {
    client.app.log({
      body: {
        service: "litellm-plugin",
        level: "info",
        message: args.join(" "),
      },
    }).catch(() => {})
  }
}

async function fetchModels(log: ReturnType<typeof makeLog>, rootURL: string, apiKey: string): Promise<string[]> {
  const url = `${rootURL}/v1/models`
  log(`GET ${url}`, apiKey ? "(with API key)" : "(no auth)")
  const res = await fetch(url, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`LiteLLM /v1/models returned ${res.status}`)
  const body = (await res.json()) as LiteLLMModelsResponse
  const ids = body.data.map((m) => m.id)
  log(`fetched ${ids.length} model(s):`, ids)
  return ids
}

async function upsertOpencodeProvider(
  rootURL: string,
  models: Record<string, { id: string; name: string }> = {
    setup: { id: "setup", name: "Restart OpenCode to load models from your LiteLLM proxy" }
  }
): Promise<void> {
  let opencodeCfg: Record<string, unknown> = {}
  try {
    opencodeCfg = JSON.parse(await readFile(OPENCODE_CONFIG_PATH, "utf8")) as Record<string, unknown>
  } catch { /* file doesn't exist yet — start fresh */ }

  const providers = (opencodeCfg.provider ?? {}) as Record<string, unknown>
  providers.litellm = {
    npm: "@ai-sdk/openai-compatible",
    name: "LiteLLM",
    options: { baseURL: `${rootURL}/v1` },
    models,
  }
  opencodeCfg.provider = providers

  await mkdir(dirname(OPENCODE_CONFIG_PATH), { recursive: true })
  await writeFile(OPENCODE_CONFIG_PATH, JSON.stringify(opencodeCfg, null, 2))
}

async function readStoredAuth(): Promise<{ rootURL: string; apiKey: string }> {
  // Primary source: OpenCode's auth store. For `type: "api"` methods, every
  // prompt value is persisted under `litellm.metadata` alongside the key, so
  // the URL the user entered during /connect litellm lands there verbatim.
  let apiKey = ""
  let rootURL: string | undefined
  try {
    const auth = JSON.parse(await readFile(AUTH_STORE_PATH, "utf8")) as Record<string, any>
    const entry = auth.litellm ?? {}
    const rawKey = entry.key
    if (typeof rawKey === "string" && rawKey !== "no-key") apiKey = rawKey
    const rawBaseURL = entry.metadata?.baseURL
    if (typeof rawBaseURL === "string" && rawBaseURL.trim()) {
      rootURL = rawBaseURL.trim().replace(/\/+$/, "").replace(/\/v1$/, "")
    }
  } catch { /* auth.json doesn't exist yet */ }

  // Fallback for baseURL only: opencode.json (written by authorize() on setups where that runs).
  if (!rootURL) {
    try {
      const cfg = JSON.parse(await readFile(OPENCODE_CONFIG_PATH, "utf8")) as Record<string, any>
      const baseURL = cfg.provider?.litellm?.options?.baseURL
      if (typeof baseURL === "string" && baseURL.trim()) {
        rootURL = baseURL.replace(/\/v1\/?$/, "").replace(/\/+$/, "")
      }
    } catch { /* opencode.json doesn't exist yet */ }
  }

  return { rootURL: rootURL ?? "http://localhost:4000", apiKey }
}

const plugin: Plugin = async (ctx) => {
  const log = makeLog(ctx.client)

  return {
    auth: {
      provider: "litellm",
      loader: async (auth) => {
        log("auth loader called")
        try {
          await auth()
          log("auth loader: credential found")
        } catch {
          log("auth loader: no credential stored yet")
        }
        const { rootURL, apiKey } = await readStoredAuth()
        log(`auth loader: baseURL=${rootURL}/v1`, apiKey ? "apiKey=<set>" : "apiKey=<none>")
        return { apiKey, baseURL: `${rootURL}/v1` }
      },
      methods: [
        {
          type: "api",
          label: "LiteLLM (leave API key blank if proxy has no auth)",
          prompts: [
            {
              type: "text",
              key: "baseURL",
              message: "LiteLLM proxy base URL",
              placeholder: "http://localhost:4000",
            },
          ],
          authorize: async (inputs) => {
            const baseURL = (inputs?.baseURL ?? "").trim() || "http://localhost:4000"
            const apiKey = (inputs?.key ?? "").trim()

            // Normalize baseURL: strip /v1 and trailing / to get rootURL
            const rootURL = baseURL.replace(/\/v1\/?$/, "").replace(/\/$/, "")

            log(`authorize: saving baseURL=${rootURL}${apiKey ? " apiKey=<set>" : ""}`)

            // Upsert provider.litellm into opencode.json
            await upsertOpencodeProvider(rootURL)

            log("authorize: provider entry written to opencode.json")

            // Return the key (or "no-key" sentinel if blank)
            const key = apiKey || "no-key"
            return { type: "success", key }
          },
        },
      ],
    },

    "chat.params": async (input, output) => {
      if (input?.provider?.info?.id !== "litellm") return
      const existingMeta = (output.options?.metadata as Record<string, unknown> | undefined) ?? {}
      output.options = {
        ...output.options,
        metadata: { ...existingMeta, session_id: input.sessionID },
      }
      log(`chat.params: tagged session_id=${input.sessionID}`)
    },

    config: async (config) => {
      log("config hook: start")

      const { rootURL, apiKey } = await readStoredAuth()
      log(`config hook: baseURL=${rootURL}`, apiKey ? "apiKey=<set>" : "apiKey=<none>")

      // Always inject a runtime provider so /connect shows LiteLLM on the very
      // first launch. Without this, OpenCode builds the /connect list before
      // the config hook writes anything to opencode.json, and the user has to
      // restart to see the provider.
      config.provider ??= {}
      config.provider.litellm = {
        npm: "@ai-sdk/openai-compatible",
        name: "LiteLLM",
        options: {
          baseURL: `${rootURL}/v1`,
          ...(apiKey ? { apiKey } : {}),
        },
        models: {
          setup: { id: "setup", name: "Run /connect litellm to configure" },
        },
      }

      // Upgrade the models list if the proxy is reachable.
      try {
        const modelIds = await fetchModels(log, rootURL, apiKey)
        config.provider.litellm.models = Object.fromEntries(
          modelIds.map((id) => [id, { id, name: id }])
        )
        log(`config hook: injected provider with ${modelIds.length} model(s)`)
      } catch (err) {
        log("config hook: fetchModels failed —", (err as Error).message, "— using placeholder model")
      }
    },
  }
}

export default plugin
