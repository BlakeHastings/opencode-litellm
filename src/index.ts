import type { Plugin } from "@opencode-ai/plugin"
import { readFile, writeFile } from "fs/promises"
import { join } from "path"
import { homedir } from "os"

interface LiteLLMModel {
  id: string
}

interface LiteLLMModelsResponse {
  data: LiteLLMModel[]
}

interface PluginConfig {
  baseURL?: string
}

const PLUGIN_CONFIG_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "litellm-plugin.json"
)

async function readPluginConfig(): Promise<PluginConfig> {
  try {
    return JSON.parse(await readFile(PLUGIN_CONFIG_PATH, "utf8")) as PluginConfig
  } catch {
    return {}
  }
}

async function fetchModels(rootURL: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${rootURL}/v1/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`LiteLLM /v1/models returned ${res.status}`)
  const body = (await res.json()) as LiteLLMModelsResponse
  return body.data.map((m) => m.id)
}

const plugin: Plugin = async (ctx) => {
  const setupScriptPath = join(import.meta.dir, "setup.ts")

  return {
    // Registers "LiteLLM" in OpenCode's /connect provider list for API key entry.
    auth: {
      provider: "litellm",
      loader: async (credentials) => ({
        apiKey: (credentials as Record<string, string>).apiKey ?? "",
      }),
      methods: {
        api: {
          authorize: async (key: string) => key,
        },
      },
    },

    config: async (config) => {
      // Inject /litellm-setup slash command so users can configure their URL
      // without touching any config files.
      const cfg = config as Record<string, any>
      cfg.command ??= {}
      cfg.command["litellm-setup"] = {
        description:
          "Set your LiteLLM proxy URL  —  usage: /litellm-setup http://host:4000",
        run: `bun run "${setupScriptPath}"`,
      }

      // Read base URL saved by /litellm-setup (falls back to localhost)
      const saved = await readPluginConfig()
      const rootURL = saved.baseURL ?? "http://localhost:4000"

      // Read API key from OpenCode's auth store (set via /connect litellm)
      let apiKey = ""
      try {
        const stored = await (ctx.client as any).auth?.get?.("litellm")
        apiKey = (stored as Record<string, string>)?.apiKey ?? ""
      } catch {
        // auth store unavailable — proceed without key
      }

      // Discover models — fail silently so OpenCode still starts if LiteLLM is down
      let modelIds: string[]
      try {
        modelIds = await fetchModels(rootURL, apiKey)
      } catch {
        return config
      }

      cfg.provider ??= {}
      cfg.provider.litellm = {
        npm: "@ai-sdk/openai-compatible",
        name: "LiteLLM",
        options: {
          baseURL: `${rootURL}/v1`,
          ...(apiKey ? { apiKey } : {}),
        },
        models: Object.fromEntries(
          modelIds.map((id) => [id, { id, name: id }])
        ),
      }

      return config
    },
  }
}

export default plugin
