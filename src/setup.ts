import { writeFile } from "fs/promises"
import { join } from "path"
import { homedir } from "os"

const url = process.argv[2]

if (!url) {
  console.error("Usage: /litellm-setup <base-url>")
  console.error("Example: /litellm-setup http://localhost:4000")
  process.exit(1)
}

const rootURL = url.replace(/\/v1\/?$/, "").replace(/\/$/, "")
const configPath = join(homedir(), ".config", "opencode", "litellm-plugin.json")

await writeFile(configPath, JSON.stringify({ baseURL: rootURL }, null, 2))

console.log(`✓ LiteLLM URL configured: ${rootURL}`)
console.log()
console.log("If your LiteLLM proxy requires an API key, run:")
console.log("  /connect litellm")
console.log()
console.log("Restart OpenCode and your models will be discovered automatically.")
