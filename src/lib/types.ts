export type Scope = "home" | "project";

export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AgentFrontmatter {
  name: string;
  provider: string;
  description?: string;
  model?: string;
  reasoningEffort?: string;
}

export interface AgentConfigRecord extends AgentFrontmatter {
  systemPrompt: string;
}

export interface AgentMetadata {
  source: Scope;
  path: string;
  registryDir: string;
}

export interface Agent extends AgentConfigRecord, AgentMetadata {
  description: string;
  model: string;
  reasoningEffort: string;
}

export interface AgentCreateInput {
  name?: string;
  provider?: string;
  description?: string;
  model?: string;
  reasoningEffort?: string;
  prompt?: string;
  systemPrompt?: string;
}

export interface CreateAgentOptions {
  scope?: Scope;
}

export interface RunPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface Run {
  id: string;
  agentName: string;
  agentSource: Scope;
  provider: string;
  model: string;
  reasoningEffort: string;
  status: RunStatus;
  taskPrompt: string;
  assembledPrompt: string;
  workspace: string;
  writeScope: string[];
  timeoutMs: number | null;
  command: string;
  args: string[];
  env: Record<string, string>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  exitCode: number | null;
  pid: number | null;
  resultSummary: string | null;
}

export interface RunCreateInput {
  id?: string;
  agentName: string;
  agentSource: Scope;
  provider: string;
  model?: string;
  reasoningEffort?: string;
  status?: RunStatus;
  taskPrompt: string;
  assembledPrompt: string;
  workspace: string;
  writeScope?: string[];
  timeoutMs?: number | null;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  pid?: number | null;
  resultSummary?: string | null;
}

export type RunUpdate = Partial<Run>;

export interface RunEvent<TPayload = unknown> {
  timestamp: string;
  type: string;
  payload: TPayload;
}

export interface RunState {
  runs: Run[];
}

export type AppErrorDetails = Record<string, unknown> | null;

export interface AppErrorOptions {
  code: string;
  title: string;
  message: string;
  fix?: string | null;
  details?: AppErrorDetails;
}

export interface SerializedAppError {
  code: string;
  title: string;
  message: string;
  fix: string | null;
  details: AppErrorDetails;
}

export interface ReadableInput {
  isTTY?: boolean;
  setEncoding(encoding: BufferEncoding): void;
  [Symbol.asyncIterator](): AsyncIterableIterator<string | Buffer>;
}

export interface WritableOutput {
  write(chunk: string): unknown;
}

export interface CliIO {
  stdin: ReadableInput;
  stdout: WritableOutput;
  stderr: WritableOutput;
}

export interface CliResponse {
  command: string;
  result: unknown;
}

export interface CliContext<TApp = unknown> {
  io: CliIO;
  cwd: string;
  response: CliResponse | null;
  app: TApp | null;
}

export interface ReasoningEffortConfig {
  values: string[];
  aliases?: Record<string, string>;
  toCliValue?: (value: string) => string;
}

export interface ProviderModelConfig {
  models: string[];
  defaultModel?: string;
  reasoningEffort?: ReasoningEffortConfig;
  modelOverrides?: Record<
    string,
    {
      reasoningEffort?: ReasoningEffortConfig;
    }
  >;
}
