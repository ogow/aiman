import {
   AgentNotFoundError,
   RunNotFoundError,
   ValidationError
} from "./errors.js";
import type {
   Agent,
   AgentCreateInput,
   CreateAgentOptions,
   Run,
   RunEvent,
   Scope
} from "./types.js";

interface ActionDependencies {
   agentRegistry: {
      createAgent(input: unknown, options?: CreateAgentOptions): Promise<Agent>;
      listVisibleAgents(): Promise<Agent[]>;
      getVisibleAgent(name: string): Promise<Agent | null>;
   };
   runStore: {
      getRun(runId: string): Promise<Run | null>;
      listRuns(): Promise<Run[]>;
      readEvents(runId: string, limit?: number): Promise<RunEvent[]>;
   };
   runManager: {
      spawnDetachedRun(input: {
         agentName: string;
         taskPrompt: string;
         model?: string | null;
         reasoningEffort?: string | null;
         workspace?: string;
         writeScope?: string[];
         timeoutMs?: number | null;
         dryRun?: boolean;
      }): Promise<Run>;
      waitForRun(runId: string, timeoutMs?: number): Promise<Run>;
      cancelRun(runId: string): Promise<Run>;
   };
   rootDir: string;
}

export function createActions({
   agentRegistry,
   runStore,
   runManager,
   rootDir
}: ActionDependencies) {
   return {
      async createAgent({
         name,
         provider,
         model = "",
         reasoningEffort = "",
         description = "",
         prompt = "",
         systemPrompt = "",
         scope = "project"
      }: {
         name: string;
         provider: string;
         model?: string;
         reasoningEffort?: string;
         description?: string;
         prompt?: string;
         systemPrompt?: string;
         scope?: Scope;
      }): Promise<Agent> {
         const input: AgentCreateInput = {
            name,
            provider,
            model,
            reasoningEffort,
            description
         };

         if (prompt) {
            input.prompt = prompt;
         }

         if (systemPrompt) {
            input.systemPrompt = systemPrompt;
         }

         return agentRegistry.createAgent(input, {
            scope
         });
      },

      async listAgents(): Promise<{ agents: Agent[] }> {
         const agents = await agentRegistry.listVisibleAgents();
         return { agents };
      },

      async getAgent({ name }: { name: string }): Promise<{ agent: Agent }> {
         const agent = await agentRegistry.getVisibleAgent(name);

         if (!agent) {
            throw new AgentNotFoundError(name);
         }

         return { agent };
      },

      async spawnRun({
         agentName,
         taskPrompt,
         model = null,
         reasoningEffort = null,
         workspace = rootDir,
         writeScope = [],
         timeoutMs = null,
         dryRun = false
      }: {
         agentName: string;
         taskPrompt: string;
         model?: string | null;
         reasoningEffort?: string | null;
         workspace?: string;
         writeScope?: string[];
         timeoutMs?: number | null;
         dryRun?: boolean;
      }): Promise<{ run: Run }> {
         if (!agentName) {
            throw new ValidationError("run spawn requires an agent name.", {
               fix: "Pass `--agent <name>` with a visible agent from `aiman agent list`."
            });
         }

         const run = await runManager.spawnDetachedRun({
            agentName,
            taskPrompt,
            model,
            reasoningEffort,
            workspace,
            writeScope,
            timeoutMs,
            dryRun
         });

         return { run };
      },

      async getRun({ runId }: { runId: string }): Promise<{ run: Run }> {
         const run = await runStore.getRun(runId);

         if (!run) {
            throw new RunNotFoundError(runId);
         }

         return { run };
      },

      async listRuns(): Promise<{ runs: Run[] }> {
         const runs = await runStore.listRuns();
         return { runs };
      },

      async waitForRun({
         runId,
         timeoutMs = 30000
      }: {
         runId: string;
         timeoutMs?: number;
      }): Promise<{ run: Run }> {
         const run = await runManager.waitForRun(runId, timeoutMs);
         return { run };
      },

      async cancelRun({ runId }: { runId: string }): Promise<{ run: Run }> {
         const run = await runManager.cancelRun(runId);
         return { run };
      },

      async readRunLogs({
         runId,
         limit = 200
      }: {
         runId: string;
         limit?: number;
      }): Promise<{ events: RunEvent[] }> {
         const run = await runStore.getRun(runId);

         if (!run) {
            throw new RunNotFoundError(runId);
         }

         const events = await runStore.readEvents(runId, limit);
         return { events };
      }
   };
}
