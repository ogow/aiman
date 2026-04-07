import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { hasErrorCode } from "../errors.js";
import { resolveCommandLaunch, resolveExecutable } from "../executables.js";
import type {
   AgentSuccessResult,
   JsonValue,
   LaunchMode,
   PersistedRunRecord,
   ProfileDefinition,
   ResultArtifact,
   ResultError,
   RunLaunchSnapshot,
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
const defaultMcpDetectionTimeoutMs = 5_000;

type ListedMcp = {
   connected: boolean;
   enabled: boolean;
   name: string;
   status: string;
};

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

export async function runCommandCapture(input: {
   args: string[];
   command: string;
   cwd?: string;
   env?: Record<string, string>;
   timeoutMs?: number;
}): Promise<{
   exitCode: number | null;
   signal: string | null;
   stderr: string;
   stdout: string;
   timedOut: boolean;
}> {
   const launch = await resolveCommandLaunch(input.command, input.args);
   const timeoutMs = input.timeoutMs ?? defaultMcpDetectionTimeoutMs;

   return new Promise((resolve) => {
      const child = spawn(launch.command, launch.args, {
         cwd: input.cwd,
         env: input.env ?? buildAllowedEnvironment(),
         shell: launch.needsShell,
         windowsVerbatimArguments: launch.windowsVerbatimArguments,
         stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      const resolveOnce = (value: {
         exitCode: number | null;
         signal: string | null;
         stderr: string;
         stdout: string;
         timedOut: boolean;
      }) => {
         if (!settled) {
            settled = true;
            resolve(value);
         }
      };
      const timer = setTimeout(() => {
         timedOut = true;
         if (launch.usesCommandProcessor && process.platform === "win32") {
            if (typeof child.pid === "number") {
               void killWindowsProcessTree(child.pid);
            }
         } else {
            child.kill();
         }
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer | string) => {
         stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
         stderr += chunk.toString();
      });
      child.once("error", (error: NodeJS.ErrnoException) => {
         clearTimeout(timer);
         resolveOnce({
            exitCode: typeof error.errno === "number" ? error.errno : null,
            signal: null,
            stderr: stderr.length > 0 ? stderr : error.message,
            stdout,
            timedOut
         });
      });
      child.once("close", (exitCode, signal) => {
         clearTimeout(timer);
         resolveOnce({
            exitCode,
            signal,
            stderr,
            stdout,
            timedOut
         });
      });
   });
}

async function killWindowsProcessTree(pid: number): Promise<void> {
   await new Promise<void>((resolve) => {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
         stdio: "ignore",
         windowsHide: true
      });

      child.once("error", () => {
         resolve();
      });
      child.once("close", () => {
         resolve();
      });
   });
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

export function buildPrompt(
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
      "{{mode}}": "",
      "{{runFile}}": input.runFile,
      "{{runId}}": input.runId,
      "{{task}}": input.task
   };

   const renderedBody = profile.body.replaceAll(
      /\{\{artifactsDir\}\}|\{\{cwd\}\}|\{\{mode\}\}|\{\{runFile\}\}|\{\{runId\}\}|\{\{task\}\}/g,
      (placeholder) => replacements[placeholder] ?? placeholder
   );
   return `${renderedBody.trimEnd()}\n\n${buildRuntimeOutputContract()}`;
}

export function finalizeRecord(input: {
   profile: ScopedProfileDefinition;
   artifacts?: ResultArtifact[];
   cwd: string;
   endedAt: string;
   error?: ResultError;
   exitCode: number | null;
   launchMode: LaunchMode;
   launch: RunLaunchSnapshot;
   projectRoot: string;
   runId: string;
   signal: string | null;
   startedAt: string;
   status: PersistedRunRecord["status"];
   result?: AgentSuccessResult;
   usage?: UsageStats;
}): PersistedRunRecord {
   return {
      agent: input.profile.name,
      agentPath: input.profile.path,
      agentScope: input.profile.scope,
      artifacts: input.result?.artifacts ?? input.artifacts ?? [],
      cwd: input.cwd,
      durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
      endedAt: input.endedAt,
      ...(input.error ? { error: input.error } : {}),
      exitCode: input.exitCode,
      ...(input.result?.handoff ? { handoff: input.result.handoff } : {}),
      launch: input.launch,
      launchMode: input.launchMode,
      logs: {
         stderr: "stderr.log",
         stdout: "stdout.log"
      },
      ...(typeof input.profile.model === "string"
         ? { model: input.profile.model }
         : {}),
      projectRoot: input.projectRoot,
      provider: input.profile.provider,
      ...(input.result?.result !== undefined
         ? { result: input.result.result }
         : {}),
      ...(typeof input.result?.resultType === "string"
         ? { resultType: input.result.resultType }
         : {}),
      runId: input.runId,
      schemaVersion: 1,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
      startedAt: input.startedAt,
      status: input.status,
      ...(typeof input.result?.summary === "string"
         ? { summary: input.result.summary }
         : {}),
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

function buildRuntimeOutputContract(): string {
   return [
      "## Required Result Contract",
      'Return only valid JSON with exactly these top-level keys: "resultType", "summary", "result", "handoff", and "artifacts".',
      'Use "resultType" as a short stable identifier such as "review.v1" or "build.v1".',
      '"summary" must be a concise human-readable sentence.',
      '"result" must contain the task-specific structured output.',
      '"handoff" must be an object with keys "outcome", "nextTask", "nextAgent", "inputs", "notes", and "questions".',
      '"notes" and "questions" must always be arrays of strings.',
      '"artifacts" must always be an array. Each artifact object must use relative paths under the run artifacts directory and may include "id", "kind", "path", and "summary".',
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

function normalizeStringArray(
   value: JsonValue | undefined
): string[] | undefined {
   if (!Array.isArray(value)) {
      return undefined;
   }

   return value.every((entry) => typeof entry === "string")
      ? (value as string[])
      : undefined;
}

function normalizeArtifact(value: JsonValue): ResultArtifact | undefined {
   if (!isJsonRecord(value)) {
      return undefined;
   }

   if (typeof value.path !== "string" || value.path.trim().length === 0) {
      return undefined;
   }

   const normalizedPath = path.normalize(value.path.trim());

   if (normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
      return undefined;
   }

   return {
      ...(typeof value.id === "string" ? { id: value.id } : {}),
      ...(typeof value.kind === "string" ? { kind: value.kind } : {}),
      path: normalizedPath,
      ...(typeof value.summary === "string" ? { summary: value.summary } : {})
   };
}

export function parseAgentSuccessResult(output: string): {
   error?: ResultError;
   result?: AgentSuccessResult;
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

   const { artifacts, handoff, result, resultType, summary, ...rest } = parsed;

   if (Object.keys(rest).length > 0) {
      return {
         error: {
            message: "Agent JSON output included unexpected top-level keys."
         }
      };
   }

   if (typeof resultType !== "string" || resultType.trim().length === 0) {
      return {
         error: {
            message: 'Agent JSON output is missing "resultType".'
         }
      };
   }

   if (typeof summary !== "string" || summary.trim().length === 0) {
      return {
         error: {
            message: 'Agent JSON output is missing "summary".'
         }
      };
   }

   if (!isJsonRecord(handoff)) {
      return {
         error: {
            message: 'Agent JSON output is missing "handoff".'
         }
      };
   }

   const notes = normalizeStringArray(handoff.notes);
   const questions = normalizeStringArray(handoff.questions);

   if (notes === undefined || questions === undefined) {
      return {
         error: {
            message:
               'Agent JSON output must use string arrays for "handoff.notes" and "handoff.questions".'
         }
      };
   }

   if (
      typeof handoff.outcome !== "string" ||
      handoff.outcome.trim().length === 0
   ) {
      return {
         error: {
            message: 'Agent JSON output is missing "handoff.outcome".'
         }
      };
   }

   if (!Array.isArray(artifacts)) {
      return {
         error: {
            message: 'Agent JSON output must use an array for "artifacts".'
         }
      };
   }

   const normalizedArtifacts = artifacts.flatMap((artifact) => {
      const normalizedArtifact = normalizeArtifact(artifact);
      return normalizedArtifact ? [normalizedArtifact] : [];
   });

   if (normalizedArtifacts.length !== artifacts.length) {
      return {
         error: {
            message:
               "Agent JSON output contained an invalid artifact entry or path."
         }
      };
   }

   const inputs =
      handoff.inputs !== undefined && isJsonRecord(handoff.inputs)
         ? handoff.inputs
         : handoff.inputs === undefined
           ? undefined
           : null;

   if (inputs === null) {
      return {
         error: {
            message:
               'Agent JSON output must use an object for "handoff.inputs" when present.'
         }
      };
   }

   if (result === undefined) {
      return {
         error: {
            message: 'Agent JSON output is missing "result".'
         }
      };
   }

   return {
      result: {
         artifacts: normalizedArtifacts,
         handoff: {
            ...(typeof handoff.nextAgent === "string"
               ? { nextAgent: handoff.nextAgent }
               : {}),
            ...(typeof handoff.nextTask === "string"
               ? { nextTask: handoff.nextTask }
               : {}),
            ...(inputs ? { inputs } : {}),
            notes,
            outcome: handoff.outcome.trim(),
            questions
         },
         result,
         resultType: resultType.trim(),
         summary: summary.trim()
      }
   };
}
