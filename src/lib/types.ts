export type ProviderId = "codex" | "gemini";

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

export type ValidationIssue = {
   code: string;
   level: "error" | "warning";
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
   artifactsDir?: string;
   promptFile: string;
   reportFile?: string;
   resultFile: string;
   runDir: string;
   stderrLog: string;
   stdoutLog: string;
};

export type ReportValue =
   | string
   | ReportValue[]
   | {
        [key: string]: ReportValue;
     };

export type ReportFrontmatter = Record<string, ReportValue>;

export type ReportArtifact = {
   exists: boolean;
   kind?: string;
   label?: string;
   metadata?: ReportValue;
   path: string;
   resolvedPath: string;
};

export type RunReport = {
   artifacts: ReportArtifact[];
   body?: string;
   exists: boolean;
   frontmatter?: ReportFrontmatter;
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
   reportFile: string;
   resultFile: string;
   runId: string;
   task: string;
};

export type CompletedRunInput = {
   agent: AgentDefinition;
   cwd: string;
   endedAt: string;
   exitCode: number | null;
   mode: RunMode;
   promptFile: string;
   resultFile: string;
   runDir: string;
   runId: string;
   signal: string | null;
   startedAt: string;
   stderr: string;
   stderrLog: string;
   stdout: string;
   stdoutLog: string;
};

export type PersistedRunRecord = {
   agent: string;
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
   errorMessage?: string;
   finalText: string;
   mode?: RunMode;
   provider: ProviderId;
   reportPath?: string;
   runId: string;
   status: RunStatus;
};

export type StoredRunState = {
   agent: string;
   cwd: string;
   endedAt?: string;
   errorMessage?: string;
   mode: RunMode;
   pid?: number;
   provider: ProviderId;
   reportFile?: string;
   resultFile: string;
   runId: string;
   startedAt: string;
   status: RunStatus | "running";
};

export type RunInspection = (PersistedRunRecord | StoredRunState) & {
   report: RunReport;
};

export type ProviderAdapter = {
   detect(): Promise<ValidationIssue[]>;
   id: ProviderId;
   parseCompletedRun(input: CompletedRunInput): Promise<PersistedRunRecord>;
   prepare(agent: AgentDefinition, input: PreparedRunInput): PreparedInvocation;
   validateAgent(agent: AgentDefinition): ValidationIssue[];
};
