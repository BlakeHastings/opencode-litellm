import type { Plugin } from "@opencode-ai/plugin"

interface LiteLLMModel {
  id: string
}

interface LiteLLMModelsResponse {
  data: LiteLLMModel[]
}

async function fetchModels(baseURL: string, apiKey: string): Promise<string[]> {
  const res = await fetch(`${baseURL}/v1/models`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) throw new Error(`LiteLLM /v1/models returned ${res.status}`)
  const body = (await res.json()) as LiteLLMModelsResponse
  return body.data.map((m) => m.id)
}

const plugin: Plugin = async (ctx) => {
  return {
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
      // Env vars take precedence (headless / CI)
      let baseURL = process.env.LITELLM_BASE_URL
      let apiKey = process.env.LITELLM_API_KEY ?? ""

      if (!baseURL) {
        try {
          const stored = (await (ctx.client as any).auth?.get?.("litellm")) as
            | Record<string, string>
            | undefined
          baseURL = stored?.baseURL ?? "http://localhost:4000"
          apiKey ||= stored?.apiKey ?? ""
        } catch {
          baseURL = "http://localhost:4000"
        }
      }

      // No credentials configured → don't inject provider
      if (!apiKey && !process.env.LITELLM_BASE_URL) return config

      let modelIds: string[]
      try {
        modelIds = await fetchModels(baseURL, apiKey)
      } catch {
        // LiteLLM unreachable — don't break OpenCode startup
        return config
      }

      config.provider ??= {}
      config.provider.litellm = {
        npm: "@ai-sdk/openai-compatible",
        name: "LiteLLM",
        options: {
          baseURL: `${baseURL}/v1`,
          apiKey: apiKey || "no-key",
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
