import type { ProjectPaths } from "../lib/paths.js";
import type {
   CheckedProfileDefinition,
   ProfileCheckReport,
   ProfileCheckStatus,
   ProfileScope as AgentScope,
   LaunchedRun,
   ProjectContext,
   ProviderId,
   ReasoningEffort,
   ResultMode,
   RunInspection,
   RunListOptions,
   RunResult,
   ScopedProfileDefinition as ScopedAgentDefinition
} from "../lib/types.js";

export type CheckedAgentDefinition = CheckedProfileDefinition;

export type AgentCheckReport = {
   agent: CheckedAgentDefinition;
   errors: ProfileCheckReport["errors"];
   status: ProfileCheckStatus;
   warnings: ProfileCheckReport["warnings"];
};

export type {
   AgentScope,
   LaunchedRun,
   ProjectContext,
   ProjectPaths,
   ProviderId,
   ReasoningEffort,
   ResultMode,
   RunInspection,
   RunListOptions,
   RunResult,
   ScopedAgentDefinition
};

export type CreateAgentInput = {
   capabilities?: string[];
   description: string;
   force?: boolean;
   instructions?: string;
   model?: string;
   name: string;
   provider: ProviderId;
   reasoningEffort?: ReasoningEffort;
   resultMode?: ResultMode;
   scope: AgentScope;
   timeoutMs?: number;
};

export type CreateAimanOptions = {
   projectRoot?: string;
};

export type RunAgentInput = {
   cwd?: string;
   onRunOutput?: (input: { stream: "stderr" | "stdout"; text: string }) => void;
   onRunStarted?: (input: {
      agent: string;
      agentPath: string;
      agentScope: AgentScope;
      provider: ProviderId;
      runId: string;
      startedAt: string;
   }) => void;
   agentScope?: AgentScope;
   task: string;
   timeoutMs?: number;
};

export type LaunchAgentInput = {
   cwd?: string;
   agentScope?: AgentScope;
   task: string;
   timeoutMs?: number;
};

export type AimanClient = {
   config: {
      contextFileNames?: string[];
   };
   projectPaths: ProjectPaths;
   agents: {
      check(name: string, scope?: AgentScope): Promise<AgentCheckReport>;
      create(input: CreateAgentInput): Promise<ScopedAgentDefinition>;
      get(name: string, scope?: AgentScope): Promise<ScopedAgentDefinition>;
      list(scope?: AgentScope): Promise<ScopedAgentDefinition[]>;
   };
   projectContext: {
      load(): Promise<ProjectContext | undefined>;
   };
   runs: {
      get(runId: string): Promise<RunInspection>;
      inspectFile(
         runId: string,
         stream: "prompt" | "run" | "stderr" | "stdout"
      ): Promise<string>;
      launch(agentName: string, input: LaunchAgentInput): Promise<LaunchedRun>;
      list(options?: RunListOptions): Promise<RunInspection[]>;
      readOutput(
         runId: string,
         stream?: "all" | "stderr" | "stdout",
         tailLines?: number
      ): Promise<string>;
      run(agentName: string, input: RunAgentInput): Promise<RunResult>;
      stop(runId: string): Promise<RunInspection>;
   };
   workbench: {
      open(): Promise<void>;
   };
};
