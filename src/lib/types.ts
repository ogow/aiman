export type ProviderId = "codex" | "gemini";

export type ProfileScope = "project" | "user";

export type ReasoningEffort = "high" | "low" | "medium" | "none";

export type RunMode = "read-only" | "safe" | "workspace-write" | "yolo";

export type LaunchMode = "detached" | "foreground";

export type AimanConfig = {
   contextFileNames?: string[];
};

export type ResolvedAimanConfig = {
   contextFileNames?: string[];
};

export type RunStatus = "cancelled" | "error" | "success";

export type RunListFilter = "active" | "all" | "historic";

export type ProviderCapabilities = {
   details: string;
   environmentSummary: string;
   launchSummary: string;
   provider: ProviderId;
};

export type ProfileDefinition = {
   body: string;
   description: string;
   model: string;
   name: string;
   provider: ProviderId;
   reasoningEffort: ReasoningEffort;
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
   id: string;
   model?: string;
   name?: string;
   path: string;
   provider?: string;
   reasoningEffort?: ReasoningEffort;
   scope: ProfileScope;
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
   promptFile: string;
   runFile: string;
   runDir: string;
   stopRequestedFile: string;
   stderrLog?: string;
   stdoutLog?: string;
};

export type MarkdownValue =
   | boolean
   | null
   | number
   | string
   | MarkdownValue[]
   | {
        [key: string]: MarkdownValue;
     };

export type MarkdownFrontmatter = Record<string, MarkdownValue>;

export type MarkdownArtifact = {
   exists: boolean;
   kind?: string;
   label?: string;
   metadata?: MarkdownValue;
   path: string;
   resolvedPath: string;
};

export type MarkdownDocument = {
   artifacts: MarkdownArtifact[];
   body?: string;
   exists: boolean;
   frontmatter?: MarkdownFrontmatter;
   parseError?: string;
   path: string;
};

export type UsageStats = {
   inputTokens?: number;
   outputTokens?: number;
   totalTokens?: number;
};

export type PreparedRunInput = {
   artifactsDir: string;
   contextFileNames?: string[];
   contextFiles?: PromptContextFile[];
   cwd: string;
   promptFile: string;
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
   promptFile: string;
   runDir: string;
   runId: string;
   signal: string | null;
   startedAt: string;
   stderr: string;
   stderrLog?: string;
   stdout: string;
   stdoutLog?: string;
};

export type RunLaunchSnapshot = {
   agentDigest: string;
   agentName: string;
   agentPath: string;
   agentScope: ProfileScope;
   args: string[];
   command: string;
   contextFiles?: string[];
   cwd: string;
   envKeys: string[];
   killGraceMs: number;
   launchMode: LaunchMode;
   model?: string;
   mode?: RunMode;
   permissions?: RunMode;
   profileDigest?: string;
   profileName?: string;
   profilePath?: string;
   profileScope?: ProfileScope;
   projectContextPath?: string;
   promptDigest: string;
   promptTransport: PromptTransport;
   provider: ProviderId;
   reasoningEffort?: ReasoningEffort;
   task?: string;
   timeoutMs: number;
};

export type PersistedRunRecord = {
   agent?: string;
   agentPath?: string;
   agentScope?: ProfileScope;
   cwd: string;
   durationMs: number;
   endedAt: string;
   errorMessage?: string;
   exitCode: number | null;
   finalText: string;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   model?: string;
   mode?: RunMode;
   paths: RunPaths;
   profile?: string;
   profilePath?: string;
   profileScope?: ProfileScope;
   projectRoot: string;
   provider: ProviderId;
   runId: string;
   signal: string | null;
   startedAt: string;
   status: RunStatus;
   usage?: UsageStats;
};

export type RunResult = {
   agent?: string;
   agentPath?: string;
   agentScope?: ProfileScope;
   errorMessage?: string;
   finalText: string;
   launchMode?: LaunchMode;
   mode?: RunMode;
   profile?: string;
   profilePath?: string;
   profileScope?: ProfileScope;
   projectRoot?: string;
   provider: ProviderId;
   rights?: string;
   runId: string;
   runPath?: string;
   status: RunStatus;
};

export type LaunchedRun = {
   active: boolean;
   agent?: string;
   agentPath?: string;
   agentScope?: ProfileScope;
   inspectCommand: string;
   launchMode: "detached";
   logsCommand: string;
   pid?: number;
   profile?: string;
   profilePath?: string;
   profileScope?: ProfileScope;
   projectRoot: string;
   provider: ProviderId;
   rights: string;
   runId: string;
   showCommand: string;
   startedAt: string;
   status: "running";
};

export type StoredRunState = {
   agent?: string;
   agentPath?: string;
   agentScope?: ProfileScope;
   cwd: string;
   endedAt?: string;
   errorMessage?: string;
   heartbeatAt?: string;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   model?: string;
   mode?: RunMode;
   paths: RunPaths;
   pid?: number;
   profile?: string;
   profilePath?: string;
   profileScope?: ProfileScope;
   projectRoot: string;
   provider: ProviderId;
   runId: string;
   startedAt: string;
   status: RunStatus | "running";
};

export type RunInspection = (PersistedRunRecord | StoredRunState) & {
   active: boolean;
   document: MarkdownDocument;
   warning?: string;
};

export type RunListOptions = {
   filter?: RunListFilter;
   limit?: number;
};

export type ProviderAdapter = {
   detect(profile: ProfileDefinition): Promise<ValidationIssue[]>;
   id: ProviderId;
   parseCompletedRun(input: CompletedRunInput): Promise<PersistedRunRecord>;
   prepare(
      profile: ProfileDefinition,
      input: PreparedRunInput
   ): Promise<PreparedInvocation>;
   validateAgent(profile: ProfileDefinition): ValidationIssue[];
};
