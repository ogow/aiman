export type ProviderId = "codex" | "gemini";

export type AgentScope = "project" | "user";

export type RunMode = "read-only" | "workspace-write";

export type RunStatus = "cancelled" | "error" | "success";

export type AgentDefinition = {
   body: string;
   description: string;
   model?: string;
   name: string;
   provider: ProviderId;
   reasoningEffort?: "high" | "low" | "medium";
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

export type PreparedInvocation = {
   args: string[];
   command: string;
   cwd: string;
   env: Record<string, string>;
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
   runFile: string;
   runId: string;
   task: string;
};

export type CompletedRunInput = {
   agent: ScopedAgentDefinition;
   cwd: string;
   endedAt: string;
   exitCode: number | null;
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
   mode: RunMode;
   paths: RunPaths;
   provider: ProviderId;
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
   mode?: RunMode;
   provider: ProviderId;
   runPath?: string;
   runId: string;
   status: RunStatus;
};

export type StoredRunState = {
   agent: string;
   agentPath: string;
   agentScope: AgentScope;
   cwd: string;
   endedAt?: string;
   errorMessage?: string;
   mode: RunMode;
   pid?: number;
   paths: RunPaths;
   provider: ProviderId;
   runId: string;
   startedAt: string;
   status: RunStatus | "running";
};

export type RunInspection = (PersistedRunRecord | StoredRunState) & {
   document: MarkdownDocument;
};

export type ProviderAdapter = {
   detect(): Promise<ValidationIssue[]>;
   id: ProviderId;
   parseCompletedRun(input: CompletedRunInput): Promise<PersistedRunRecord>;
   prepare(agent: AgentDefinition, input: PreparedRunInput): PreparedInvocation;
   validateAgent(agent: AgentDefinition): ValidationIssue[];
};
