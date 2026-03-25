import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { AgentRegistry } from "./lib/agent-registry.mjs";
import { formatErrorMessage } from "./lib/errors.mjs";
import { RunManager } from "./lib/runner.mjs";
import { RunStore } from "./lib/run-store.mjs";
import { registerTools } from "./lib/tools.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const agentRegistry = new AgentRegistry({
  workspaceDir: rootDir
});
await agentRegistry.init();

const runStore = new RunStore(rootDir);
await runStore.init();

const runManager = new RunManager({
  rootDir,
  agentRegistry,
  runStore
});

const server = new McpServer({
  name: "agent-harness-mcp",
  version: "0.1.0"
});

registerTools({
  server,
  rootDir,
  store: {
    agentRegistry,
    runStore
  },
  runManager
});

const transport = new StdioServerTransport();

try {
  await server.connect(transport);
} catch (error) {
  console.error(formatErrorMessage(error));
  process.exit(1);
}
