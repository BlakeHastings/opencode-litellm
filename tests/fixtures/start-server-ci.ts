/**
 * Standalone mock LiteLLM server for manual debugging.
 * Writes the bound port to /tmp/litellm-port and blocks until killed.
 *
 * Usage: bun tests/fixtures/start-server-ci.ts
 */

import { startMockLiteLLM } from "./litellm-server.ts"
import { writeFileSync } from "fs"

const server = startMockLiteLLM()
writeFileSync("/tmp/litellm-port", String(server.port))
process.stdout.write(`Mock LiteLLM: ${server.url}\n`)

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => { server.stop(); process.exit(0) })

await new Promise(() => {})
