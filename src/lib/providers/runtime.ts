import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { z } from "zod";

import { hasErrorCode } from "../errors.js";
import { resolveExecutable } from "../executables.js";
import type {
   JsonValue,
   LaunchMode,
   PersistedRunRecord,
   ProviderCompletion,
   ProfileDefinition,
   ResultArtifact,
   ResultError,
   ResultNext,
   RunLaunchSnapshot,
   SchemaModeResult,
   ScopedProfileDefinition,
   UsageStats,
   ValidationIssue
} from "../types.js";

const allowedEnvironmentKeys = [
   "AIMAN_ARTIFACTS_DIR",
   "AIMAN_RUN_PATH",
   "AIMAN_RUN_DIR",
   "AIMAN_RUN_ID",
   "AIMAN_TASK_ID",
   "APPDATA",
   "CI",
   "COLORTERM",
   "COMSPEC",
   "GEMINI_API_KEY",
   "GEMINI_CLI_SYSTEM_SETTINGS_PATH",
   "GOOGLE_API_KEY",
   "GOOGLE_APPLICATION_CREDENTIALS",
   "GOOGLE_CLOUD_PROJECT",
   "HOME",
   "HOMEDRIVE",
   "HOMEPATH",
   "LANG",
   "LC_ALL",
   "LC_CTYPE",
   "LOCALAPPDATA",
   "LOGNAME",
   "NO_COLOR",
   "OPENAI_API_BASE",
   "OPENAI_API_KEY",
   "OPENAI_BASE_URL",
   "PATH",
   "PATHEXT",
   "PROGRAMDATA",
   "SHELL",
   "SYSTEMROOT",
   "TEMP",
   "TERM",
   "TMP",
   "TMPDIR",
   "USER",
   "USERPROFILE",
   "WINDIR",
   "XDG_CACHE_HOME",
   "XDG_CONFIG_HOME",
   "XDG_DATA_HOME",
   "XDG_STATE_HOME"
];
type ListedMcp = {
   connected: boolean;
   enabled: boolean;
   name: string;
   status: string;
};

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
   z.union([
      z.boolean(),
      z.null(),
      z.number(),
      z.string(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema)
   ])
);

const nextSchema = z
   .object({
      agent: z.string().trim().min(1).optional(),
      inputs: z.record(z.string(), jsonValueSchema).optional(),
      task: z.string().trim().min(1).optional()
   })
   .strict()
   .transform((value) => {
      const normalized = {
         ...(typeof value.agent === "string" ? { agent: value.agent.trim() } : {}),
         ...(value.inputs !== undefined ? { inputs: value.inputs } : {}),
         ...(typeof value.task === "string" ? { task: value.task.trim() } : {})
      };

      return Object.keys(normalized).length > 0 ? normalized : undefined;
   });

const agentSuccessSchema = z
   .object({
      next: nextSchema.optional(),
      outcome: z.string().trim().min(1),
      result: jsonValueSchema,
      summary: z.string().trim().min(1)
   })
   .strict()
   .transform((value) => ({
      ...(value.next !== undefined ? { next: value.next } : {}),
      outcome: value.outcome.trim(),
      result: value.result,
      summary: value.summary.trim()
   }));

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
         message: `Executable "${command}" was not found on PATH.`
      }
   ];
}

export function parseCodexMcpList(stdout: string): ListedMcp[] {
   try {
      const parsed = JSON.parse(stdout) as unknown;

      if (!Array.isArray(parsed)) {
         return [];
      }

      return parsed.flatMap((entry) => {
         if (typeof entry !== "object" || entry === null) {
            return [];
         }

         const name = entry["name"];
         const enabled = entry["enabled"];

         if (typeof name !== "string" || typeof enabled !== "boolean") {
            return [];
         }

         return [
            {
               connected: enabled,
               enabled,
               name,
               status: enabled ? "enabled" : "disabled"
            }
         ];
      });
   } catch {
      return [];
   }
}

export function parseGeminiMcpList(stdout: string): ListedMcp[] {
   return stdout.split(/\r?\n/).flatMap((line) => {
      const trimmedLine = line.trim();

      if (
         trimmedLine.length === 0 ||
         trimmedLine === "Configured MCP servers:" ||
         trimmedLine === "Loaded cached credentials."
      ) {
         return [];
      }

      const match = trimmedLine.match(
         /^[^A-Za-z0-9._-]*([A-Za-z0-9._-]+)(?:\s+\(from [^)]+\))?:.* - ([A-Za-z]+)\s*$/
      );

      if (!match) {
         return [];
      }

      const name = match[1];
      const rawStatus = match[2];

      if (name === undefined || rawStatus === undefined) {
         return [];
      }

      const status = rawStatus.toLowerCase();

      return [
         {
            connected: status === "connected",
            enabled: status !== "disabled",
            name,
            status
         }
      ];
   });
}

export async function detectRequiredMcps(_input: {
   agent: ProfileDefinition;
   args: string[];
   command: string;
   parseList: (stdout: string) => ListedMcp[];
}): Promise<ValidationIssue[]> {
   return [];
}

export function rejectUnsupportedReasoningEffort(
   agent: ProfileDefinition
): ValidationIssue[] {
   if (agent.reasoningEffort !== "none") {
      return [
         {
            code: "unsupported-reasoning-effort",
            message: `Provider "${agent.provider}" requires reasoningEffort "none".`
         }
      ];
   }

   return [];
}

export function renderAgentPrompt(
   profile: ProfileDefinition,
   input: {
      artifactsDir: string;
      cwd: string;
      runFile: string;
      runId: string;
      task?: string;
   }
): string {
   if (typeof input.task !== "string" || input.task.trim().length === 0) {
      throw new Error("A task is required to render a provider prompt.");
   }

   const replacements: Record<string, string> = {
      "{{artifactsDir}}": input.artifactsDir,
      "{{cwd}}": input.cwd,
      "{{runFile}}": input.runFile,
      "{{runId}}": input.runId,
      "{{task}}": input.task
   };

   const renderedBody = profile.body.replaceAll(
      /\{\{artifactsDir\}\}|\{\{cwd\}\}|\{\{runFile\}\}|\{\{runId\}\}|\{\{task\}\}/g,
      (placeholder) => replacements[placeholder] ?? placeholder
   );
   return profile.resultMode === "schema"
      ? `${renderedBody.trimEnd()}\n\n${buildSchemaModeContract()}`
      : renderedBody.trimEnd();
}

function buildRunRecord(input: {
   profile: ScopedProfileDefinition;
   artifacts: ResultArtifact[];
   cwd: string;
   endedAt: string;
   error?: ResultError;
   exitCode: number | null;
   finalText?: string;
   launchMode: LaunchMode;
   launch: RunLaunchSnapshot;
   next?: ResultNext;
   outcome?: string;
   projectRoot: string;
   runId: string;
   signal: string | null;
   startedAt: string;
   status: PersistedRunRecord["status"];
   structuredResult?: JsonValue;
   summary?: string;
   usage?: UsageStats;
}): PersistedRunRecord {
   return {
      agent: input.profile.name,
      agentPath: input.profile.path,
      agentScope: input.profile.scope,
      artifacts: input.artifacts,
      cwd: input.cwd,
      durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
      endedAt: input.endedAt,
      ...(input.error ? { error: input.error } : {}),
      exitCode: input.exitCode,
      ...(typeof input.finalText === "string" ? { finalText: input.finalText } : {}),
      launch: input.launch,
      launchMode: input.launchMode,
      logs: {
         stderr: "stderr.log",
         stdout: "stdout.log"
      },
      ...(typeof input.profile.model === "string"
         ? { model: input.profile.model }
         : {}),
      ...(input.next ? { next: input.next } : {}),
      ...(typeof input.outcome === "string" ? { outcome: input.outcome } : {}),
      projectRoot: input.projectRoot,
      provider: input.profile.provider,
      resultMode: input.profile.resultMode,
      ...(input.structuredResult !== undefined
         ? { structuredResult: input.structuredResult }
         : {}),
      runId: input.runId,
      schemaVersion: 1,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      startedAt: input.startedAt,
      status: input.status,
      ...(typeof input.summary === "string" ? { summary: input.summary } : {}),
      ...(typeof input.launch.task === "string"
         ? { task: input.launch.task }
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

function buildSchemaModeContract(): string {
   return [
      "## Required Result Contract",
      '"summary" must be a concise human-readable sentence.',
      '"outcome" must be a short status such as "done", "blocked", or "needs_followup".',
      '"result" must contain the task-specific structured output.',
      'Optional "next" may be an object with keys "task", "agent", and "inputs" when there is a clear next step.',
      "Do not wrap the JSON in markdown fences.",
      "Do not include any text before or after the JSON object."
   ].join("\n");
}

function stripJsonCodeFence(value: string): string {
   return value.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
}

function isJsonRecord(
   value: JsonValue | undefined
): value is Record<string, JsonValue> {
   return (
      value !== undefined &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
   );
}

function formatSchemaPath(pathEntries: PropertyKey[]): string {
   if (pathEntries.length === 0) {
      return "root";
   }

   return pathEntries
      .map((entry) => (typeof entry === "number" ? `[${entry}]` : String(entry)))
      .join(".");
}

function toSchemaError(details: string): ResultError {
   return {
      details,
      message: "Agent JSON output did not satisfy the required result contract."
   };
}

function parseSchemaModeResult(output: string): {
   error?: ResultError;
   result?: SchemaModeResult;
} {
   const trimmed = stripJsonCodeFence(output);

   if (trimmed.length === 0) {
      return {
         error: {
            message: "Agent did not return the required JSON result."
         }
      };
   }

   let parsed: JsonValue;

   try {
      parsed = JSON.parse(trimmed) as JsonValue;
   } catch {
      return {
         error: {
            message: "Agent did not return valid JSON."
         }
      };
   }

   if (!isJsonRecord(parsed)) {
      return {
         error: {
            message: "Agent JSON output must be an object."
         }
      };
   }

   const parsedResult = agentSuccessSchema.safeParse(parsed);

   if (!parsedResult.success) {
      const issue = parsedResult.error.issues[0];
      return {
         error: toSchemaError(
            issue === undefined
               ? "Unknown schema validation failure."
               : `${formatSchemaPath(issue.path)}: ${issue.message}`
         )
      };
   }

   return {
      result: parsedResult.data
   };
}

function getProviderFailureMessage(profile: ScopedProfileDefinition): string {
   return profile.provider === "codex"
      ? "Codex execution failed."
      : "Gemini execution failed.";
}

function summarizeTextAnswer(finalText: string): string | undefined {
   const compact = finalText.trim().replace(/\s+/g, " ");

   if (compact.length === 0) {
      return undefined;
   }

   return compact.length <= 140 ? compact : `${compact.slice(0, 137)}...`;
}

export function finalizeRunRecord(input: {
   artifacts: ResultArtifact[];
   completion: ProviderCompletion;
   cwd: string;
   endedAt: string;
   exitCode: number | null;
   launch: RunLaunchSnapshot;
   launchMode: LaunchMode;
   profile: ScopedProfileDefinition;
   projectRoot: string;
   runId: string;
   signal: string | null;
   startedAt: string;
   stderr: string;
}): PersistedRunRecord {
   const parsedResult =
      input.profile.resultMode === "schema" &&
      input.completion.output !== undefined
         ? parseSchemaModeResult(input.completion.output)
         : {};
   const finalText =
      input.profile.resultMode === "text" ? input.completion.output : undefined;
   const summary =
      input.profile.resultMode === "text"
         ? summarizeTextAnswer(finalText ?? "")
         : parsedResult.result?.summary;
   const status =
      input.signal === "SIGTERM"
         ? "cancelled"
         : input.exitCode === 0 &&
             input.completion.error === undefined &&
             parsedResult.error === undefined
           ? "success"
           : "error";
   const error =
      status === "error"
         ? (input.completion.error ??
           parsedResult.error ??
           (input.stderr.trim().length > 0
              ? { message: input.stderr.trim() }
              : { message: getProviderFailureMessage(input.profile) }))
         : undefined;

   return buildRunRecord({
      artifacts: input.artifacts,
      cwd: input.cwd,
      endedAt: input.endedAt,
      ...(error ? { error } : {}),
      exitCode: input.exitCode,
      ...(typeof finalText === "string" ? { finalText } : {}),
      launchMode: input.launchMode,
      launch: input.launch,
      ...(parsedResult.result?.next ? { next: parsedResult.result.next } : {}),
      ...(parsedResult.result?.outcome
         ? { outcome: parsedResult.result.outcome }
         : {}),
      profile: input.profile,
      projectRoot: input.projectRoot,
      runId: input.runId,
      ...(parsedResult.result?.result !== undefined
         ? { structuredResult: parsedResult.result.result }
         : {}),
      signal: input.signal,
      startedAt: input.startedAt,
      status,
      ...(typeof summary === "string" ? { summary } : {}),
      ...(input.completion.usage ? { usage: input.completion.usage } : {})
   });
}
