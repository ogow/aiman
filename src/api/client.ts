import { readRunOutput } from "../lib/run-output.js";
import { getProjectPaths } from "../lib/paths.js";
import { loadAimanConfig } from "../lib/config.js";
import {
   checkAgentDefinition,
   createAgentFile,
   listAgents,
   loadAgentDefinition
} from "../lib/agents.js";
import { loadProjectContext } from "../lib/project-context.js";
import {
   launchRun,
   listRuns,
   readRunDetails,
   readRunLog,
   runAgent,
   stopRun
} from "../lib/runs.js";

import type {
   AimanClient,
   CreateAimanOptions,
   CreateAgentInput,
   LaunchAgentInput,
   RunAgentInput
} from "./types.js";

function toRunInput(input: RunAgentInput) {
   return {
      ...(typeof input.cwd === "string" && input.cwd.length > 0
         ? { cwd: input.cwd }
         : {}),
      ...(input.onRunOutput !== undefined
         ? { onRunOutput: input.onRunOutput }
         : {}),
      ...(input.onRunStarted !== undefined
         ? { onRunStarted: input.onRunStarted }
         : {}),
      ...(input.agentScope !== undefined
         ? { profileScope: input.agentScope }
         : {}),
      ...(typeof input.timeoutMs === "number"
         ? { timeoutMs: input.timeoutMs }
         : {}),
      task: input.task
   };
}

function toLaunchInput(input: LaunchAgentInput) {
   return {
      ...(typeof input.cwd === "string" && input.cwd.length > 0
         ? { cwd: input.cwd }
         : {}),
      ...(input.agentScope !== undefined
         ? { profileScope: input.agentScope }
         : {}),
      ...(typeof input.timeoutMs === "number"
         ? { timeoutMs: input.timeoutMs }
         : {}),
      task: input.task
   };
}

export async function createAiman(
   options: CreateAimanOptions = {}
): Promise<AimanClient> {
   const projectPaths = getProjectPaths(options.projectRoot);
   const config = await loadAimanConfig(projectPaths);

   return {
      config,
      agents: {
         async check(name, scope) {
            const report = await checkAgentDefinition(
               projectPaths,
               name,
               scope
            );
            return {
               agent: report.profile,
               errors: report.errors,
               status: report.status,
               warnings: report.warnings
            };
         },
         async create(input: CreateAgentInput) {
            return createAgentFile(projectPaths, input);
         },
         async get(name, scope) {
            return loadAgentDefinition(projectPaths, name, scope);
         },
         async list(scope) {
            return listAgents(projectPaths, scope);
         }
      },
      projectContext: {
         async load() {
            return loadProjectContext(projectPaths.projectRoot);
         }
      },
      projectPaths,
      runs: {
         async get(runId) {
            return readRunDetails(runId);
         },
         async inspectFile(runId, stream) {
            return readRunLog(runId, stream);
         },
         async launch(agentName, input: LaunchAgentInput) {
            return launchRun({
               ...toLaunchInput(input),
               projectRoot: projectPaths.projectRoot,
               profileName: agentName
            });
         },
         async list(options) {
            return listRuns(options);
         },
         async readOutput(runId, stream = "all", tailLines = 40) {
            return readRunOutput(runId, stream, tailLines);
         },
         async run(agentName, input: RunAgentInput) {
            return runAgent({
               ...toRunInput(input),
               projectRoot: projectPaths.projectRoot,
               profileName: agentName
            });
         },
         async stop(runId) {
            return stopRun(runId);
         }
      },
      workbench: {
         async open() {
            const { openAimanApp } = await import("../tui/aiman-app.js");
            return openAimanApp({ projectPaths });
         }
      }
   };
}
