/**
 * Minimal LiteLLM-compatible HTTP server for integration testing.
 * Implements the /v1/models endpoint in the same format LiteLLM uses,
 * with optional API key authentication.
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
  stop(): void
}

export function startMockLiteLLM(options: MockServerOptions = {}): MockServer {
  const models = options.models ?? DEFAULT_MODELS
  const apiKey = options.apiKey

  const server = Bun.serve({
    port: 0, // OS assigns a free port
    fetch(req) {
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

      return new Response("Not Found", { status: 404 })
    },
  })

  return {
    url: `http://localhost:${server.port}`,
    stop: () => server.stop(),
  }
}
