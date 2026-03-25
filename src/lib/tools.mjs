import * as z from "zod/v4";

import { formatErrorMessage, serializeError, ValidationError } from "./errors.mjs";

function asTextResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ],
    structuredContent: payload
  };
}

function asErrorResult(error) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: formatErrorMessage(error)
      }
    ],
    structuredContent: {
      error: serializeError(error)
    }
  };
}

function nonEmptyString(fieldName) {
  return z.string().trim().min(1, { error: `${fieldName} must be a non-empty string.` });
}

function wrapTool(handler) {
  return async (args) => {
    try {
      return await handler(args ?? {});
    } catch (error) {
      return asErrorResult(error);
    }
  };
}

export const TOOL_DEFINITIONS = {
  agentCreate: {
    name: "agent_create",
    description: "Create a reusable agent in the home or project registry.",
    inputSchema: {
      name: nonEmptyString("name"),
      provider: nonEmptyString("provider"),
      model: z.string().trim().optional(),
      description: z.string().optional(),
      prompt: z.string().optional(),
      systemPrompt: z.string().optional(),
      scope: z.enum(["home", "project"]).optional()
    }
  },
  agentList: {
    name: "agent_list",
    description: "List visible agents from the merged home and project registries.",
    inputSchema: {}
  },
  agentGet: {
    name: "agent_get",
    description: "Get one visible agent by name.",
    inputSchema: {
      name: nonEmptyString("name")
    }
  },
  runSpawn: {
    name: "run_spawn",
    description: "Spawn a new agent run from a visible agent definition.",
    inputSchema: {
      agentName: z.string().trim().optional(),
      templateId: z.string().trim().optional(),
      taskPrompt: nonEmptyString("taskPrompt"),
      model: z.string().trim().optional(),
      workspace: z.string().optional(),
      writeScope: z.array(z.string()).optional(),
      timeoutMs: z.number().int().positive().optional(),
      dryRun: z.boolean().optional()
    }
  },
  runGet: {
    name: "run_get",
    description: "Get one run by id.",
    inputSchema: {
      runId: nonEmptyString("runId")
    }
  },
  runList: {
    name: "run_list",
    description: "List all runs.",
    inputSchema: {}
  },
  runWait: {
    name: "run_wait",
    description: "Wait until a run reaches a terminal status or timeout.",
    inputSchema: {
      runId: nonEmptyString("runId"),
      timeoutMs: z.number().int().positive().optional()
    }
  },
  runCancel: {
    name: "run_cancel",
    description: "Cancel a running agent.",
    inputSchema: {
      runId: nonEmptyString("runId")
    }
  },
  runLogs: {
    name: "run_logs",
    description: "Read recent logs for a run.",
    inputSchema: {
      runId: nonEmptyString("runId"),
      limit: z.number().int().positive().optional()
    }
  }
};

export function createToolHandler({ agentRegistry, runStore, runManager, rootDir }) {
  return async function handleToolCall(name, args = {}) {
    try {
      switch (name) {
        case "agent_create":
        case "template_create": {
          const agent = await agentRegistry.createAgent({
            name: args.name,
            provider: args.provider,
            model: args.model ?? "",
            description: args.description ?? "",
            prompt: args.prompt ?? "",
            systemPrompt: args.systemPrompt ?? "",
          }, {
            scope: args.scope ?? "project"
          });

          return asTextResult(agent);
        }

        case "agent_list":
        case "template_list": {
          const agents = await agentRegistry.listVisibleAgents();
          return asTextResult({ agents });
        }

        case "agent_get": {
          const agent = await agentRegistry.getVisibleAgent(args.name);
          return asTextResult({ agent });
        }

        case "run_spawn": {
          const agentName = args.agentName ?? args.templateId;

          if (!agentName) {
            throw new ValidationError("run_spawn requires 'agentName'.", {
              fix: "Pass a visible agent name from agent_list."
            });
          }

          const run = await runManager.spawnRun({
            agentName,
            taskPrompt: args.taskPrompt,
            model: args.model ?? null,
            workspace: args.workspace ?? rootDir,
            writeScope: args.writeScope ?? [],
            timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : null,
            dryRun: Boolean(args.dryRun)
          });

          return asTextResult(run);
        }

        case "run_get": {
          const run = await runStore.getRun(args.runId);
          return asTextResult({ run });
        }

        case "run_list": {
          const runs = await runStore.listRuns();
          return asTextResult({ runs });
        }

        case "run_wait": {
          const run = await runManager.waitForRun(
            args.runId,
            typeof args.timeoutMs === "number" ? args.timeoutMs : 30000
          );
          return asTextResult({ run });
        }

        case "run_cancel": {
          const run = await runManager.cancelRun(args.runId);
          return asTextResult({ run });
        }

        case "run_logs": {
          const events = await runStore.readEvents(
            args.runId,
            typeof args.limit === "number" ? args.limit : 200
          );
          return asTextResult({ events });
        }

        default:
          throw new ValidationError(`Unknown tool '${name}'.`, {
            fix: "Use tools/list to inspect the available tool names."
          });
      }
    } catch (error) {
      return asErrorResult(error);
    }
  };
}

export function registerTools({ server, store, runManager, rootDir }) {
  const handleToolCall = createToolHandler({
    agentRegistry: store.agentRegistry,
    runStore: store.runStore,
    runManager,
    rootDir
  });

  server.registerTool(
    TOOL_DEFINITIONS.agentCreate.name,
    {
      description: TOOL_DEFINITIONS.agentCreate.description,
      inputSchema: TOOL_DEFINITIONS.agentCreate.inputSchema
    },
    wrapTool((args) => handleToolCall("agent_create", args))
  );

  server.registerTool(
    TOOL_DEFINITIONS.agentList.name,
    {
      description: TOOL_DEFINITIONS.agentList.description
    },
    wrapTool((args) => handleToolCall("agent_list", args))
  );

  server.registerTool(
    TOOL_DEFINITIONS.agentGet.name,
    {
      description: TOOL_DEFINITIONS.agentGet.description,
      inputSchema: TOOL_DEFINITIONS.agentGet.inputSchema
    },
    wrapTool((args) => handleToolCall("agent_get", args))
  );

  server.registerTool(
    TOOL_DEFINITIONS.runSpawn.name,
    {
      description: TOOL_DEFINITIONS.runSpawn.description,
      inputSchema: TOOL_DEFINITIONS.runSpawn.inputSchema
    },
    wrapTool((args) => handleToolCall("run_spawn", args))
  );

  server.registerTool(
    TOOL_DEFINITIONS.runGet.name,
    {
      description: TOOL_DEFINITIONS.runGet.description,
      inputSchema: TOOL_DEFINITIONS.runGet.inputSchema
    },
    wrapTool((args) => handleToolCall("run_get", args))
  );

  server.registerTool(
    TOOL_DEFINITIONS.runList.name,
    {
      description: TOOL_DEFINITIONS.runList.description
    },
    wrapTool((args) => handleToolCall("run_list", args))
  );

  server.registerTool(
    TOOL_DEFINITIONS.runWait.name,
    {
      description: TOOL_DEFINITIONS.runWait.description,
      inputSchema: TOOL_DEFINITIONS.runWait.inputSchema
    },
    wrapTool((args) => handleToolCall("run_wait", args))
  );

  server.registerTool(
    TOOL_DEFINITIONS.runCancel.name,
    {
      description: TOOL_DEFINITIONS.runCancel.description,
      inputSchema: TOOL_DEFINITIONS.runCancel.inputSchema
    },
    wrapTool((args) => handleToolCall("run_cancel", args))
  );

  server.registerTool(
    TOOL_DEFINITIONS.runLogs.name,
    {
      description: TOOL_DEFINITIONS.runLogs.description,
      inputSchema: TOOL_DEFINITIONS.runLogs.inputSchema
    },
    wrapTool((args) => handleToolCall("run_logs", args))
  );
}
