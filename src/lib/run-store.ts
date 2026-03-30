import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import { getProjectPaths } from "./paths.js";
import { readMarkdownDocument, writeMarkdownDocument } from "./run-doc.js";
import type {
   MarkdownDocument,
   MarkdownFrontmatter,
   PersistedRunRecord,
   ProviderId,
   RunInspection,
   RunMode,
   RunPaths,
   RunResult,
   RunStatus,
   StoredRunState,
   UsageStats
} from "./types.js";

type StoredRunPaths = RunPaths & {
   artifactsDir: string;
   runFile: string;
   stderrLog: string;
   stdoutLog: string;
};

const reservedRunFrontmatterKeys = new Set([
   "agent",
   "artifactsDir",
   "cwd",
   "durationMs",
   "endedAt",
   "errorMessage",
   "exitCode",
   "mode",
   "pid",
   "promptPath",
   "provider",
   "runId",
   "signal",
   "startedAt",
   "status",
   "stderrPath",
   "stdoutPath",
   "usage"
]);

export function createRunId(agentName: string): string {
   const iso = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
   const safeAgentName = agentName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

   return `${iso}-${safeAgentName}-${randomUUID().slice(0, 8)}`;
}

export function buildRunPaths(runDir: string): StoredRunPaths {
   return {
      artifactsDir: path.join(runDir, "artifacts"),
      promptFile: path.join(runDir, "prompt.md"),
      runFile: path.join(runDir, "run.md"),
      runDir,
      stderrLog: path.join(runDir, "stderr.log"),
      stdoutLog: path.join(runDir, "stdout.log")
   };
}

function isProviderId(value: unknown): value is ProviderId {
   return value === "codex" || value === "gemini";
}

function isRunMode(value: unknown): value is RunMode {
   return value === "read-only" || value === "workspace-write";
}

function isRunStatus(value: unknown): value is RunStatus {
   return value === "cancelled" || value === "error" || value === "success";
}

function getStringValue(
   frontmatter: MarkdownFrontmatter,
   key: string
): string | undefined {
   const value = frontmatter[key];
   return typeof value === "string" ? value : undefined;
}

function getNumberValue(
   frontmatter: MarkdownFrontmatter,
   key: string
): number | undefined {
   const value = frontmatter[key];
   return typeof value === "number" ? value : undefined;
}

function getNullableNumberValue(
   frontmatter: MarkdownFrontmatter,
   key: string
): number | null | undefined {
   const value = frontmatter[key];

   if (value === null) {
      return null;
   }

   return typeof value === "number" ? value : undefined;
}

function getNullableStringValue(
   frontmatter: MarkdownFrontmatter,
   key: string
): string | null | undefined {
   const value = frontmatter[key];

   if (value === null) {
      return null;
   }

   return typeof value === "string" ? value : undefined;
}

function getUsageStats(
   frontmatter: MarkdownFrontmatter
): UsageStats | undefined {
   const value = frontmatter.usage;

   if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return undefined;
   }

   const record = value as Record<string, unknown>;
   const inputTokens =
      typeof record.inputTokens === "number" ? record.inputTokens : undefined;
   const outputTokens =
      typeof record.outputTokens === "number" ? record.outputTokens : undefined;
   const totalTokens =
      typeof record.totalTokens === "number" ? record.totalTokens : undefined;

   if (
      inputTokens === undefined &&
      outputTokens === undefined &&
      totalTokens === undefined
   ) {
      return undefined;
   }

   return {
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(totalTokens !== undefined ? { totalTokens } : {})
   };
}

function buildRunPathsFromFrontmatter(
   frontmatter: MarkdownFrontmatter,
   paths: StoredRunPaths,
   runFilePath: string
): RunPaths {
   const stderrPath = getStringValue(frontmatter, "stderrPath");
   const stdoutPath = getStringValue(frontmatter, "stdoutPath");

   return {
      artifactsDir:
         getStringValue(frontmatter, "artifactsDir") ?? paths.artifactsDir,
      promptFile: getStringValue(frontmatter, "promptPath") ?? paths.promptFile,
      runFile: runFilePath,
      runDir: paths.runDir,
      ...(typeof stderrPath === "string" ? { stderrLog: stderrPath } : {}),
      ...(typeof stdoutPath === "string" ? { stdoutLog: stdoutPath } : {})
   };
}

function pickAuthoredFrontmatter(
   frontmatter?: MarkdownFrontmatter
): MarkdownFrontmatter {
   if (!frontmatter) {
      return {};
   }

   return Object.fromEntries(
      Object.entries(frontmatter).filter(
         ([key]) => !reservedRunFrontmatterKeys.has(key)
      )
   );
}

function buildRunFrontmatter(
   value: PersistedRunRecord | StoredRunState
): MarkdownFrontmatter {
   const durationMs =
      "durationMs" in value && typeof value.durationMs === "number"
         ? value.durationMs
         : undefined;
   const pid =
      "pid" in value && typeof value.pid === "number" ? value.pid : undefined;

   return {
      runId: value.runId,
      status: value.status,
      agent: value.agent,
      provider: value.provider,
      mode: value.mode,
      cwd: value.cwd,
      startedAt: value.startedAt,
      ...(typeof value.endedAt === "string" ? { endedAt: value.endedAt } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...("exitCode" in value ? { exitCode: value.exitCode } : {}),
      ...("signal" in value ? { signal: value.signal } : {}),
      ...(typeof value.errorMessage === "string"
         ? { errorMessage: value.errorMessage }
         : {}),
      ...(pid !== undefined ? { pid } : {}),
      promptPath: value.paths.promptFile,
      ...(typeof value.paths.stdoutLog === "string"
         ? { stdoutPath: value.paths.stdoutLog }
         : {}),
      ...(typeof value.paths.stderrLog === "string"
         ? { stderrPath: value.paths.stderrLog }
         : {}),
      ...(typeof value.paths.artifactsDir === "string"
         ? { artifactsDir: value.paths.artifactsDir }
         : {}),
      ...(value.status !== "running" && "usage" in value && value.usage
         ? { usage: value.usage }
         : {})
   };
}

async function readExistingDocument(
   filePath: string,
   artifactsDir: string
): Promise<MarkdownDocument | undefined> {
   const document = await readMarkdownDocument(filePath, artifactsDir);

   return document.exists && document.parseError === undefined
      ? document
      : undefined;
}

function buildFinalBody(
   record: PersistedRunRecord,
   existing?: MarkdownDocument
): string {
   if (typeof existing?.body === "string" && existing.body.trim().length > 0) {
      return existing.body;
   }

   return record.finalText;
}

function parseStoredStateFromDocument(
   document: MarkdownDocument,
   paths: StoredRunPaths
): PersistedRunRecord | StoredRunState | undefined {
   const frontmatter = document.frontmatter;

   if (!frontmatter) {
      return undefined;
   }

   const runId = getStringValue(frontmatter, "runId");
   const agent = getStringValue(frontmatter, "agent");
   const provider = frontmatter.provider;
   const mode = frontmatter.mode;
   const cwd = getStringValue(frontmatter, "cwd");
   const startedAt = getStringValue(frontmatter, "startedAt");
   const status = frontmatter.status;

   if (
      typeof runId !== "string" ||
      typeof agent !== "string" ||
      !isProviderId(provider) ||
      !isRunMode(mode) ||
      typeof cwd !== "string" ||
      typeof startedAt !== "string" ||
      typeof status !== "string"
   ) {
      return undefined;
   }

   const recordPaths = buildRunPathsFromFrontmatter(
      frontmatter,
      paths,
      document.path
   );

   if (status === "running") {
      const endedAt = getStringValue(frontmatter, "endedAt");
      const errorMessage = getStringValue(frontmatter, "errorMessage");
      const pid = getNumberValue(frontmatter, "pid");

      return {
         agent,
         cwd,
         ...(typeof endedAt === "string" ? { endedAt } : {}),
         ...(typeof errorMessage === "string" ? { errorMessage } : {}),
         mode,
         ...(typeof pid === "number" ? { pid } : {}),
         paths: recordPaths,
         provider,
         runId,
         startedAt,
         status
      };
   }

   if (!isRunStatus(status)) {
      return undefined;
   }

   const endedAt = getStringValue(frontmatter, "endedAt");
   const durationMs = getNumberValue(frontmatter, "durationMs");
   const exitCode = getNullableNumberValue(frontmatter, "exitCode");
   const errorMessage = getStringValue(frontmatter, "errorMessage");
   const signal = getNullableStringValue(frontmatter, "signal");
   const usage = getUsageStats(frontmatter);

   if (
      typeof endedAt !== "string" ||
      typeof durationMs !== "number" ||
      exitCode === undefined ||
      signal === undefined
   ) {
      return undefined;
   }

   return {
      agent,
      cwd,
      durationMs,
      endedAt,
      ...(typeof errorMessage === "string" ? { errorMessage } : {}),
      exitCode,
      finalText: document.body?.trimEnd() ?? "",
      mode,
      paths: recordPaths,
      provider,
      runId,
      signal,
      startedAt,
      status,
      ...(usage ? { usage } : {})
   };
}

export function createFailedRunRecord(input: {
   agent: string;
   cwd: string;
   endedAt: string;
   errorMessage: string;
   mode: RunMode;
   promptFile: string;
   provider: PersistedRunRecord["provider"];
   runDir: string;
   runId: string;
   startedAt: string;
   stderrLog?: string;
   stdoutLog?: string;
}): PersistedRunRecord {
   return {
      agent: input.agent,
      cwd: input.cwd,
      durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
      endedAt: input.endedAt,
      errorMessage: input.errorMessage,
      exitCode: null,
      finalText: "",
      mode: input.mode,
      paths: {
         artifactsDir: path.join(input.runDir, "artifacts"),
         promptFile: input.promptFile,
         runFile: path.join(input.runDir, "run.md"),
         runDir: input.runDir,
         ...(typeof input.stderrLog === "string"
            ? { stderrLog: input.stderrLog }
            : {}),
         ...(typeof input.stdoutLog === "string"
            ? { stdoutLog: input.stdoutLog }
            : {})
      },
      provider: input.provider,
      runId: input.runId,
      signal: null,
      startedAt: input.startedAt,
      status: "error"
   };
}

export function toRunResult(record: PersistedRunRecord): RunResult {
   return {
      agent: record.agent,
      finalText: record.finalText,
      mode: record.mode,
      provider: record.provider,
      runId: record.runId,
      runPath: record.paths.runFile,
      status: record.status,
      ...(typeof record.errorMessage === "string"
         ? { errorMessage: record.errorMessage }
         : {})
   };
}

export async function writeRunState(
   filePath: string,
   value: StoredRunState
): Promise<void> {
   const existing = await readExistingDocument(
      filePath,
      value.paths.artifactsDir ?? path.join(value.paths.runDir, "artifacts")
   );

   await writeMarkdownDocument({
      body: existing?.body ?? "",
      filePath,
      frontmatter: {
         ...buildRunFrontmatter(value),
         ...pickAuthoredFrontmatter(existing?.frontmatter)
      }
   });
}

export async function persistResult(
   record: PersistedRunRecord,
   runFile: string
): Promise<void> {
   const existing = await readExistingDocument(
      runFile,
      record.paths.artifactsDir ?? path.join(record.paths.runDir, "artifacts")
   );

   await writeMarkdownDocument({
      body: buildFinalBody(record, existing),
      filePath: runFile,
      frontmatter: {
         ...buildRunFrontmatter(record),
         ...pickAuthoredFrontmatter(existing?.frontmatter)
      }
   });
}

export async function readRunDetails(runId: string): Promise<RunInspection> {
   const projectPaths = getProjectPaths();
   const runDir = path.join(projectPaths.runsDir, runId);
   const paths = buildRunPaths(runDir);
   const document = await readMarkdownDocument(
      paths.runFile,
      paths.artifactsDir
   );

   if (!document.exists) {
      throw new UserError(`Run "${runId}" was not found.`);
   }

   if (document.parseError) {
      throw new UserError(
         `Run "${runId}" exists but its run.md could not be parsed: ${document.parseError}`
      );
   }

   const parsed = parseStoredStateFromDocument(document, paths);

   if (!parsed) {
      throw new UserError(
         `Run "${runId}" exists but its run.md is missing required fields.`
      );
   }

   return {
      ...parsed,
      document
   };
}

export async function readRunLog(
   runId: string,
   stream: "prompt" | "run" | "stderr" | "stdout"
): Promise<string> {
   const projectPaths = getProjectPaths();
   const runDir = path.join(projectPaths.runsDir, runId);
   const paths = buildRunPaths(runDir);
   const filePath =
      stream === "prompt"
         ? paths.promptFile
         : stream === "run"
           ? paths.runFile
           : path.join(
                runDir,
                stream === "stderr" ? "stderr.log" : "stdout.log"
             );

   try {
      return await readFile(filePath, "utf8");
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         throw new UserError(
            stream === "run"
               ? `No run file exists for run "${runId}".`
               : stream === "prompt"
                 ? `No prompt file exists for run "${runId}".`
                 : `No ${stream} log exists for run "${runId}".`
         );
      }

      throw error;
   }
}
