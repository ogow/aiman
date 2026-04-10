export type ProviderId = "codex" | "gemini";

export type ProfileScope = "project" | "user";

export type ReasoningEffort = "high" | "low" | "medium" | "none";

export type ResultMode = "schema" | "text";

export type LaunchMode = "detached" | "foreground";

export type AimanConfig = {
   contextFileNames?: string[];
};

export type ResolvedAimanConfig = {
   contextFileNames?: string[];
};

export type TerminalRunStatus = "cancelled" | "error" | "success";

export type RunStatus = TerminalRunStatus | "running";

export type RunListFilter = "active" | "all" | "historic";

export type ProviderCapabilities = {
   details: string;
   environmentSummary: string;
   launchSummary: string;
   provider: ProviderId;
};

export type ProfileDefinition = {
   body: string;
   capabilities?: string[];
   description: string;
   model: string;
   name: string;
   provider: ProviderId;
   reasoningEffort: ReasoningEffort;
   resultMode: ResultMode;
   timeoutMs?: number;
};

export type ScopedProfileDefinition = ProfileDefinition & {
   id: string;
   isBuiltIn?: boolean;
   path: string;
   scope: ProfileScope;
};

export type ValidationIssue = {
   code: string;
   message: string;
};

export type ProfileCheckStatus = "invalid" | "ok" | "warnings";

export type CheckedProfileDefinition = {
   capabilities?: string[];
   id: string;
   model?: string;
   name?: string;
   path: string;
   provider?: string;
   reasoningEffort?: ReasoningEffort;
   resultMode?: ResultMode;
   scope: ProfileScope;
   timeoutMs?: number;
};

export type ProfileCheckReport = {
   errors: ValidationIssue[];
   profile: CheckedProfileDefinition;
   status: ProfileCheckStatus;
   warnings: ValidationIssue[];
};

export type PromptTransport = "arg" | "none" | "stdin";

export type PromptContextFile = {
   content: string;
   path: string;
};

export type ProjectContext = {
   content: string;
   path: string;
   title: string;
};

export type PreparedInvocation = {
   args: string[];
   command: string;
   cwd: string;
   env: Record<string, string>;
   promptTransport: PromptTransport;
   renderedPrompt: string;
   supportFiles?: {
      content: string;
      path: string;
   }[];
   stdin?: string;
};

export type RunPaths = {
   artifactsDir: string;
   runFile: string;
   runDir: string;
   stopRequestedFile: string;
   stderrLog: string;
   stdoutLog: string;
};

export type JsonValue =
   | boolean
   | null
   | number
   | string
   | JsonValue[]
   | {
        [key: string]: JsonValue;
     };

export type UsageStats = {
   inputTokens?: number;
   outputTokens?: number;
   totalTokens?: number;
};

export type ResultArtifact = {
   exists?: boolean;
   id?: string;
   kind?: string;
   path: string;
   resolvedPath?: string;
   summary?: string;
};

export type ResultNext = {
   agent?: string;
   inputs?: Record<string, JsonValue>;
   task?: string;
};

export type ResultError = {
   code?: string;
   details?: string;
   message: string;
};

export type SchemaModeResult = {
   next?: ResultNext;
   outcome: string;
   result: JsonValue;
   summary: string;
};

export type ProviderCompletion = {
   error?: ResultError;
   output?: string;
   usage?: UsageStats;
};

export type PreparedRunInput = {
   artifactsDir: string;
   contextFileNames?: string[];
   contextFiles?: PromptContextFile[];
   cwd: string;
   projectContext?: ProjectContext;
   renderedPrompt?: string;
   runFile: string;
   runId: string;
   task?: string;
};

export type CompletedRunInput = {
   agent?: ScopedProfileDefinition;
   cwd: string;
   endedAt: string;
   exitCode: number | null;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   profile?: ScopedProfileDefinition;
   projectRoot: string;
   runDir: string;
   runId: string;
   signal: string | null;
   startedAt: string;
   stderr: string;
   stdout: string;
};

export type RunLaunchSnapshot = {
   agentDigest: string;
   agentName: string;
   agentPath: string;
   agentScope: ProfileScope;
   args: string[];
   capabilities?: string[];
   command: string;
   contextFiles?: string[];
   cwd: string;
   envKeys: string[];
   killGraceMs: number;
   launchMode: LaunchMode;
   model?: string;
   profileDigest?: string;
   profileName?: string;
   profilePath?: string;
   profileScope?: ProfileScope;
   projectContextPath?: string;
   promptDigest: string;
   promptTransport: PromptTransport;
   provider: ProviderId;
   reasoningEffort?: ReasoningEffort;
   resultMode: ResultMode;
   renderedPrompt: string;
   task?: string;
   timeoutMs: number;
};

export type PersistedRunRecord = {
   agent: string;
   agentPath: string;
   agentScope: ProfileScope;
   artifacts: ResultArtifact[];
   cwd: string;
   durationMs?: number;
   endedAt?: string;
   error?: ResultError;
   exitCode?: number | null;
   finalText?: string;
   heartbeatAt?: string;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   logs: {
      stderr: string;
      stdout: string;
   };
   model?: string;
   next?: ResultNext;
   outcome?: string;
   pid?: number;
   projectRoot: string;
   provider: ProviderId;
   resultMode: ResultMode;
   runId: string;
   schemaVersion: 1;
   signal?: string | null;
   startedAt: string;
   status: RunStatus;
   structuredResult?: JsonValue;
   summary?: string;
   task?: string;
   usage?: UsageStats;
};

export type RunResult = {
   agent: string;
   agentPath: string;
   agentScope: ProfileScope;
   artifacts: ResultArtifact[];
   error?: ResultError;
   finalText?: string;
   launchMode: LaunchMode;
   next?: ResultNext;
   outcome?: string;
   projectRoot: string;
   provider: ProviderId;
   resultMode: ResultMode;
   rights: string;
   runId: string;
   runFile: string;
   status: TerminalRunStatus;
   structuredResult?: JsonValue;
   summary?: string;
};

export type LaunchedRun = {
   active: boolean;
   agent: string;
   agentPath: string;
   agentScope: ProfileScope;
   inspectCommand: string;
   launchMode: "detached";
   logsCommand: string;
   pid?: number;
   projectRoot: string;
   provider: ProviderId;
   rights: string;
   runId: string;
   showCommand: string;
   startedAt: string;
   status: "running";
};

export type RunInspection = PersistedRunRecord & {
   active: boolean;
   paths: RunPaths;
   warning?: string;
};

export type RunListOptions = {
   filter?: RunListFilter;
   limit?: number;
};

export type ProviderAdapter = {
   detect(profile: ProfileDefinition): Promise<ValidationIssue[]>;
   id: ProviderId;
   parseCompletion(input: CompletedRunInput): Promise<ProviderCompletion>;
   prepare(
      profile: ProfileDefinition,
      input: PreparedRunInput
   ): Promise<PreparedInvocation>;
   validateAgent(profile: ProfileDefinition): ValidationIssue[];
};
