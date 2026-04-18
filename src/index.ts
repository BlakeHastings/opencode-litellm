import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { mkdir, readFile, writeFile } from "fs/promises"
import { dirname } from "path"
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
  return {
    // Registers LiteLLM in /connect for API key entry.
    auth: {
      provider: "litellm",
      loader: async (auth) => {
        const stored = await auth()
        const cfg = await readPluginConfig()
        const rootURL = cfg.baseURL ?? "http://localhost:4000"
        const apiKey = (stored as any)?.key ?? ""
        return {
          apiKey: apiKey === "no-key" ? "" : apiKey,
          baseURL: `${rootURL}/v1`,
        }
      },
      methods: [
        {
          type: "api" as const,
          label: "Connect to LiteLLM",
          prompts: [
            {
              type: "text" as const,
              key: "apiKey",
              message: "API key (leave blank if your proxy has no authentication)",
              placeholder: "",
            },
          ],
          authorize: async (inputs) => {
            const apiKey = inputs?.apiKey ?? ""
            return {
              type: "success" as const,
              key: apiKey || "no-key",
            }
          },
        },
      ],
    },

    // litellm_configure is called by the AI during /litellm-setup to save the proxy URL.
    tool: {
      litellm_configure: tool({
        description:
          "Save the LiteLLM proxy base URL so the opencode-litellm plugin can discover models automatically. Call this when the user wants to configure their LiteLLM connection.",
        args: {
          base_url: tool.schema
            .string()
            .describe(
              "The LiteLLM proxy base URL, e.g. http://localhost:4000 or http://your-server:4000"
            ),
        },
        execute: async ({ base_url }) => {
          const rootURL = base_url.replace(/\/v1\/?$/, "").replace(/\/$/, "")
          await mkdir(dirname(PLUGIN_CONFIG_PATH), { recursive: true })
          await writeFile(
            PLUGIN_CONFIG_PATH,
            JSON.stringify({ baseURL: rootURL }, null, 2)
          )
          return (
            `LiteLLM proxy URL saved: ${rootURL}\n\n` +
            `Next steps:\n` +
            `1. If your proxy requires an API key: run /connect litellm and enter your key.\n` +
            `2. If your proxy has no authentication: skip step 1.\n` +
            `3. Restart OpenCode — your LiteLLM models will appear in the model picker automatically.`
          )
        },
      }),
    },

    config: async (config) => {
      // Inject /litellm-setup as a guided setup command.
      config.command ??= {}
      config.command["litellm-setup"] = {
        template:
          "I want to configure my LiteLLM proxy. Please ask me for the URL of my LiteLLM instance, then use the litellm_configure tool to save it. After the tool runs, relay its output to me word for word — do not summarize it.",
        description: "Configure your LiteLLM proxy URL",
      }

      // Read saved base URL (written by litellm_configure tool).
      const saved = await readPluginConfig()
      if (!saved.baseURL) return  // Not configured yet — nothing to inject.

      const rootURL = saved.baseURL

      // Read API key stored via /connect litellm.
      let apiKey = ""
      try {
        const stored = (await (ctx.client as any).auth?.get?.("litellm")) as
          | { key?: string }
          | undefined
        const key = stored?.key ?? ""
        apiKey = key === "no-key" ? "" : key
      } catch {
        // auth store unavailable — proceed without key
      }

      let modelIds: string[]
      try {
        modelIds = await fetchModels(rootURL, apiKey)
      } catch {
        return  // LiteLLM unreachable — don't break OpenCode startup
      }

      config.provider ??= {}
      config.provider.litellm = {
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
    },
  }
}

export default plugin
