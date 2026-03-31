export type ProviderId = "codex" | "gemini";

export type AgentScope = "project" | "user";

export type RunMode = "read-only" | "workspace-write";

export type LaunchMode = "detached" | "foreground";

export type RunStatus = "cancelled" | "error" | "success";

export type ReasoningEffort = "high" | "low" | "medium";

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

export type AgentDefinition = {
   body: string;
   description: string;
   model: string;
   name: string;
   permissions: RunMode;
   provider: ProviderId;
   requiredMcps?: string[];
   reasoningEffort?: ReasoningEffort;
   skills?: string[];
};

export type ScopedAgentDefinition = AgentDefinition & {
   id: string;
   path: string;
   scope: AgentScope;
};

export type ValidationIssue = {
   code: string;
   message: string;
};

export type PromptTransport = "arg" | "none" | "stdin";

export type ResolvedSkill = {
   digest: string;
   name: string;
   path: string;
   scope: AgentScope;
};

export type PreparedInvocation = {
   args: string[];
   command: string;
   cwd: string;
   env: Record<string, string>;
   promptTransport: PromptTransport;
   renderedPrompt: string;
   stdin?: string;
};

export type RunPaths = {
   artifactsDir: string;
   promptFile: string;
   runFile: string;
   runDir: string;
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
   cwd: string;
   mode: RunMode;
   promptFile: string;
   renderedPrompt?: string;
   runFile: string;
   runId: string;
   task?: string;
};

export type CompletedRunInput = {
   agent: ScopedAgentDefinition;
   cwd: string;
   endedAt: string;
   exitCode: number | null;
   launchMode: LaunchMode;
   launch: RunLaunchSnapshot;
   mode: RunMode;
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
   agentScope: AgentScope;
   args: string[];
   command: string;
   cwd: string;
   envKeys: string[];
   killGraceMs: number;
   launchMode: LaunchMode;
   mode: RunMode;
   model?: string;
   permissions: RunMode;
   promptDigest: string;
   promptTransport: PromptTransport;
   provider: ProviderId;
   reasoningEffort?: ReasoningEffort;
   skills: ResolvedSkill[];
   timeoutMs: number;
};

export type PersistedRunRecord = {
   agent: string;
   agentPath: string;
   agentScope: AgentScope;
   cwd: string;
   durationMs: number;
   endedAt: string;
   errorMessage?: string;
   exitCode: number | null;
   finalText: string;
   launchMode: LaunchMode;
   launch: RunLaunchSnapshot;
   model?: string;
   mode: RunMode;
   paths: RunPaths;
   provider: ProviderId;
   reasoningEffort?: ReasoningEffort;
   runId: string;
   signal: string | null;
   startedAt: string;
   status: RunStatus;
   usage?: UsageStats;
};

export type RunResult = {
   agent: string;
   agentPath?: string;
   agentScope?: AgentScope;
   errorMessage?: string;
   finalText: string;
   launchMode?: LaunchMode;
   mode?: RunMode;
   provider: ProviderId;
   rights?: string;
   runPath?: string;
   runId: string;
   status: RunStatus;
};

export type LaunchedRun = {
   active: boolean;
   agent: string;
   agentPath: string;
   agentScope: AgentScope;
   showCommand: string;
   inspectCommand: string;
   launchMode: "detached";
   logsCommand: string;
   mode: RunMode;
   pid?: number;
   provider: ProviderId;
   rights: string;
   runId: string;
   startedAt: string;
   status: "running";
};

export type StoredRunState = {
   agent: string;
   agentPath: string;
   agentScope: AgentScope;
   cwd: string;
   endedAt?: string;
   errorMessage?: string;
   heartbeatAt?: string;
   launchMode: LaunchMode;
   launch: RunLaunchSnapshot;
   model?: string;
   mode: RunMode;
   pid?: number;
   paths: RunPaths;
   provider: ProviderId;
   reasoningEffort?: ReasoningEffort;
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
   detect(agent: AgentDefinition): Promise<ValidationIssue[]>;
   id: ProviderId;
   parseCompletedRun(input: CompletedRunInput): Promise<PersistedRunRecord>;
   prepare(agent: AgentDefinition, input: PreparedRunInput): PreparedInvocation;
   validateAgent(agent: AgentDefinition): ValidationIssue[];
};
