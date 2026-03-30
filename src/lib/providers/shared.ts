import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { hasErrorCode } from "../errors.js";
import { resolveExecutable } from "../executables.js";
import type {
   AgentDefinition,
   PersistedRunRecord,
   RunMode,
   UsageStats,
   ValidationIssue
} from "../types.js";

const allowedEnvironmentKeys = [
   "AIMAN_ARTIFACTS_DIR",
   "AIMAN_RUN_PATH",
   "AIMAN_RUN_DIR",
   "AIMAN_RUN_ID",
   "AIMAN_TASK_ID",
   "CI",
   "COLORTERM",
   "GEMINI_API_KEY",
   "GOOGLE_API_KEY",
   "GOOGLE_APPLICATION_CREDENTIALS",
   "GOOGLE_CLOUD_PROJECT",
   "HOME",
   "LANG",
   "LC_ALL",
   "LC_CTYPE",
   "LOGNAME",
   "NO_COLOR",
   "OPENAI_API_BASE",
   "OPENAI_API_KEY",
   "OPENAI_BASE_URL",
   "PATH",
   "SHELL",
   "TEMP",
   "TERM",
   "TMP",
   "TMPDIR",
   "USER",
   "XDG_CACHE_HOME",
   "XDG_CONFIG_HOME",
   "XDG_DATA_HOME",
   "XDG_STATE_HOME"
];

export function buildAllowedEnvironment(
   extraValues?: Record<string, string>
): Record<string, string> {
   const entries = allowedEnvironmentKeys.flatMap((key) => {
      const value = extraValues?.[key] ?? process.env[key];
      return typeof value === "string" ? ([[key, value]] as const) : [];
   });

   return Object.fromEntries(entries);
}

export async function detectExecutable(
   command: string
): Promise<ValidationIssue[]> {
   const executable = await resolveExecutable(command);

   if (typeof executable === "string") {
      return [];
   }

   return [
      {
         code: "missing-executable",
         level: "error",
         message: `Executable "${command}" was not found on PATH.`
      }
   ];
}

export function validateReasoningEffort(
   agent: AgentDefinition
): ValidationIssue[] {
   if (agent.reasoningEffort === undefined) {
      return [];
   }

   return [
      {
         code: "unsupported-reasoning-effort",
         level: "warning",
         message: `Provider "${agent.provider}" does not map reasoningEffort in v1.`
      }
   ];
}

export function buildPrompt(
   agent: AgentDefinition,
   input: {
      artifactsDir: string;
      cwd: string;
      mode: RunMode;
      runFile: string;
      runId: string;
      task: string;
   }
): string {
   return `${agent.body}

---
Task: ${input.task}
Working directory: ${input.cwd}
Execution mode: ${input.mode}
Run ID: ${input.runId}
Optional artifacts directory: ${input.artifactsDir}
Optional structured run path: ${input.runFile}

Use the optional run/artifact paths only when your authored instructions need persisted handoff files.
Create those files or directories yourself if you decide to use them.
Do not assume any task beyond the task above.
Return a final answer in the CLI output.`;
}

export function finalizeRecord(input: {
   agent: AgentDefinition;
   cwd: string;
   endedAt: string;
   errorMessage?: string;
   exitCode: number | null;
   finalText: string;
   mode: RunMode;
   promptFile: string;
   runDir: string;
   runId: string;
   signal: string | null;
   startedAt: string;
   status: PersistedRunRecord["status"];
   stderrLog?: string;
   stdoutLog?: string;
   usage?: UsageStats;
}): PersistedRunRecord {
   return {
      agent: input.agent.name,
      cwd: input.cwd,
      durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
      endedAt: input.endedAt,
      exitCode: input.exitCode,
      finalText: input.finalText,
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
      provider: input.agent.provider,
      runId: input.runId,
      signal: input.signal,
      startedAt: input.startedAt,
      status: input.status,
      ...(typeof input.errorMessage === "string"
         ? { errorMessage: input.errorMessage }
         : {}),
      ...(input.usage ? { usage: input.usage } : {})
   };
}

export async function readOptionalFile(filePath: string): Promise<string> {
   try {
      return await readFile(filePath, "utf8");
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return "";
      }

      throw error;
   }
}

export function deriveCodexLastMessagePath(runDir: string): string {
   return path.join(runDir, ".codex-last-message.txt");
}
