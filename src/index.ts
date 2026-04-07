export { createAiman } from "./api/index.js";
export type {
   AimanClient,
   CreateAimanOptions,
   CreateAgentInput,
   LaunchAgentInput,
   RunAgentInput
} from "./api/index.js";

export {
   checkAgentDefinition,
   createAgentFile,
   listAgents,
   loadAgentDefinition,
   builtinAgents,
   agentScopeChoices
} from "./lib/agents.js";

export { getProjectPaths, type ProjectPaths } from "./lib/paths.js";

export type {
   AgentCheckReport,
   AgentScope,
   LaunchedRun,
   ProjectContext,
   ProviderId,
   ReasoningEffort,
   RunInspection,
   RunListOptions,
   RunResult,
   ScopedAgentDefinition
} from "./api/index.js";

export { UserError } from "./lib/errors.js";
