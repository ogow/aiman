export type ProviderId = "codex" | "gemini";

export type ProfileScope = "project" | "user";

export type AgentScope = ProfileScope;

export type RunMode =
   | "read-only"
   | "safe"
   | "workspace-write"
   | "yolo";

export type LaunchMode = "detached" | "foreground";

export type RunStatus = "cancelled" | "error" | "success";

export type RunListFilter = "active" | "all" | "historic";

export type RunModeCapability = {
   details: string;
   mode: RunMode;
   providerControl: string;
   summary: string;
};

export type ProviderCapabilities = {
   environmentSummary: string;
   modes: RunModeCapability[];
   provider: ProviderId;
};

export type ProfileDefinition = {
   body: string;
   contextFiles?: string[];
   description: string;
   model: string;
   mode?: RunMode;
   name: string;
   permissions?: RunMode;
   provider: ProviderId;
   reasoningEffort?: string;
   requiredMcps?: string[];
   skills?: string[];
};

export type ScopedProfileDefinition = ProfileDefinition & {
   id: string;
   isBuiltIn?: boolean;
   path: string;
   scope: ProfileScope;
};

export type AgentDefinition = ProfileDefinition;

export type ScopedAgentDefinition = ScopedProfileDefinition;

export type ValidationIssue = {
   code: string;
   message: string;
};

export type ProfileCheckStatus = "invalid" | "ok" | "warnings";

export type CheckedProfileDefinition = {
   contextFiles?: string[];
   id: string;
   model?: string;
   mode?: string;
   name?: string;
   path: string;
   permissions?: string;
   provider?: string;
   requiredMcps?: string[];
   reasoningEffort?: string;
   scope: ProfileScope;
   skills?: string[];
};

export type ProfileCheckReport = {
   errors: ValidationIssue[];
   profile: CheckedProfileDefinition;
   status: ProfileCheckStatus;
   warnings: ValidationIssue[];
};

export type AgentCheckStatus = ProfileCheckStatus;

export type CheckedAgentDefinition = CheckedProfileDefinition;

export type AgentCheckReport = {
   errors: ValidationIssue[];
   agent: CheckedAgentDefinition;
   status: AgentCheckStatus;
   warnings: ValidationIssue[];
};

export type PromptTransport = "arg" | "none" | "stdin";

export type PromptSkill = {
   body: string;
   description: string;
   keywords: string[];
   modes?: RunMode[];
   name: string;
   path: string;
   profiles?: string[];
   scope: ProfileScope;
};

export type ResolvedSkill = PromptSkill & {
   digest: string;
};

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
   contextFiles?: PromptContextFile[];
   cwd: string;
   mode: RunMode;
   promptFile: string;
   projectContext?: ProjectContext;
   renderedPrompt?: string;
   runFile: string;
   runId: string;
   skills?: PromptSkill[];
   task?: string;
};

export type CompletedRunInput = {
   agent?: ScopedProfileDefinition;
   cwd: string;
   endedAt: string;
   exitCode: number | null;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   mode: RunMode;
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
   mode: RunMode;
   model?: string;
   permissions?: RunMode;
   profileDigest?: string;
   profileName?: string;
   profilePath?: string;
   profileScope?: ProfileScope;
   projectContextPath?: string;
   promptDigest: string;
   promptTransport: PromptTransport;
   provider: ProviderId;
   reasoningEffort?: string;
   skills: string[];
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
   mode: RunMode;
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
   mode: RunMode;
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
   mode: RunMode;
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
