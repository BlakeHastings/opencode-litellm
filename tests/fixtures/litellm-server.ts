/**
 * Minimal LiteLLM-compatible HTTP server for integration testing.
 * Implements /v1/models and /v1/chat/completions with optional API key auth.
 * All models return a plain text SSE response.
 */

export const DEFAULT_MODELS = [
  "test-model-chat",
  "test-model-code",
  "test-model-vision",
]

export interface MockServerOptions {
  /** If set, requests without this Bearer token receive a 401 */
  apiKey?: string
  /** Model IDs to return from /v1/models. Defaults to DEFAULT_MODELS */
  models?: string[]
}

export interface MockServer {
  /** Base URL the server is listening on, e.g. http://localhost:51234 */
  url: string
  /** The actual bound port number */
  port: number
  /** Chat completion requests received, in order */
  chatRequests: { model: string; messageCount: number }[]
  stop(): void
}

export function startMockLiteLLM(options: MockServerOptions = {}): MockServer {
  const models = options.models ?? DEFAULT_MODELS
  const apiKey = options.apiKey

  // Captured after Bun.serve() returns; valid for all incoming requests.
  let boundPort = 0
  const chatRequests: { model: string; messageCount: number }[] = []

  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url)

      if (apiKey) {
        const auth = req.headers.get("authorization") ?? ""
        if (auth !== `Bearer ${apiKey}`) {
          return Response.json(
            { error: { message: "Invalid API key", type: "invalid_request_error" } },
            { status: 401 }
          )
        }
      }

      if (req.method === "GET" && pathname === "/v1/models") {
        return Response.json({
          object: "list",
          data: models.map((id) => ({
            id,
            object: "model",
            created: 1677610602,
            owned_by: "test",
          })),
        })
      }

      if (req.method === "POST" && pathname === "/v1/chat/completions") {
        const body = (await req.json()) as { model?: string; messages?: { role: string }[] }
        const modelId = body.model ?? "mock-model"
        const messages = body.messages ?? []
        chatRequests.push({ model: modelId, messageCount: messages.length })

        const base = { id: "chatcmpl-mock", object: "chat.completion.chunk", model: modelId }
        const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`

        // Plain text response for all models
        const sseBody =
          sse({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }) +
          sse({ ...base, choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }) +
          sse({ ...base, choices: [{ index: 0, delta: { content: " from mock LiteLLM." }, finish_reason: null }] }) +
          sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
          "data: [DONE]\n\n"

        return new Response(sseBody, {
          headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
        })
      }

      return new Response("Not Found", { status: 404 })
    },
  })

  boundPort = server.port

  return {
    url: `http://localhost:${server.port}`,
    port: server.port,
    chatRequests,
    stop: () => server.stop(),
  }
}
