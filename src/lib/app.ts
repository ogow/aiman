import { AgentRegistry } from "./agent-registry.js";
import { createActions } from "./actions.js";
import { ValidationError } from "./errors.js";
import { RunManager } from "./runner.js";
import { RunStore } from "./run-store.js";

export interface Application {
  rootDir: string;
  agentRegistry: AgentRegistry;
  runStore: RunStore;
  runManager: RunManager;
  actions: ReturnType<typeof createActions>;
}

export async function createApplication({
  rootDir,
  homeDir
}: {
  rootDir?: string;
  homeDir?: string;
} = {}): Promise<Application> {
  if (!rootDir) {
    throw new ValidationError("rootDir must be a non-empty string.");
  }

  const agentRegistry = new AgentRegistry({
    workspaceDir: rootDir,
    ...(homeDir ? { homeDir } : {})
  });
  await agentRegistry.init();

  const runStore = new RunStore(rootDir);
  await runStore.init();

  const runManager = new RunManager({
    rootDir,
    agentRegistry,
    runStore
  });

  return {
    rootDir,
    agentRegistry,
    runStore,
    runManager,
    actions: createActions({
      rootDir,
      agentRegistry,
      runStore,
      runManager
    })
  };
}
