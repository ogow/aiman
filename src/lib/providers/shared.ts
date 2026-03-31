import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { hasErrorCode } from "../errors.js";
import { resolveExecutable } from "../executables.js";
import type {
   AgentDefinition,
   LaunchMode,
   PersistedRunRecord,
   RunLaunchSnapshot,
   RunMode,
   ScopedAgentDefinition,
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

const mcpDetectionTimeoutMs = 5_000;

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

async function runCommandCapture(input: {
   args: string[];
   command: string;
}): Promise<{
   exitCode: number | null;
   signal: string | null;
   stderr: string;
   stdout: string;
   timedOut: boolean;
}> {
   return new Promise((resolve) => {
      execFile(
         input.command,
         input.args,
         {
            encoding: "utf8",
            env: buildAllowedEnvironment(),
            maxBuffer: 1024 * 1024,
            timeout: mcpDetectionTimeoutMs
         },
         (error, stdout, stderr) => {
            if (error === null) {
               resolve({
                  exitCode: 0,
                  signal: null,
                  stderr,
                  stdout,
                  timedOut: false
               });
               return;
            }

            const failedCommand = error as NodeJS.ErrnoException & {
               code?: number | string;
               killed?: boolean;
               signal?: string;
            };

            resolve({
               exitCode:
                  typeof failedCommand.code === "number"
                     ? failedCommand.code
                     : null,
               signal:
                  typeof failedCommand.signal === "string"
                     ? failedCommand.signal
                     : null,
               stderr,
               stdout,
               timedOut: failedCommand.killed === true
            });
         }
      );
   });
}

function formatShellCommand(command: string, args: string[]): string {
   return [command, ...args].join(" ");
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

export async function detectRequiredMcps(input: {
   agent: AgentDefinition;
   args: string[];
   command: string;
   parseList: (stdout: string) => ListedMcp[];
}): Promise<ValidationIssue[]> {
   if (
      input.agent.requiredMcps === undefined ||
      input.agent.requiredMcps.length === 0
   ) {
      return [];
   }

   const commandLabel = formatShellCommand(input.command, input.args);
   const result = await runCommandCapture({
      args: input.args,
      command: input.command
   });

   if (result.exitCode !== 0 || result.timedOut) {
      const reason = result.timedOut
         ? `timed out while running "${commandLabel}".`
         : `failed while running "${commandLabel}".`;
      const stderr = result.stderr.trim();

      return [
         {
            code: "mcp-detection-failed",
            message: `Agent "${input.agent.name}" requires MCP checks, but provider "${input.agent.provider}" ${reason}${stderr.length > 0 ? ` ${stderr}` : ""}`
         }
      ];
   }

   const listedMcps = new Map(
      input.parseList(result.stdout).map((mcp) => [mcp.name, mcp])
   );

   return input.agent.requiredMcps.flatMap((requiredMcp) => {
      const detectedMcp = listedMcps.get(requiredMcp);

      if (!detectedMcp) {
         return [
            {
               code: "missing-required-mcp",
               message: `Agent "${input.agent.name}" requires MCP "${requiredMcp}", but provider "${input.agent.provider}" did not list it in "${commandLabel}".`
            }
         ];
      }

      if (!detectedMcp.enabled) {
         return [
            {
               code: "disabled-required-mcp",
               message: `Agent "${input.agent.name}" requires MCP "${requiredMcp}", but provider "${input.agent.provider}" reported it as ${detectedMcp.status}.`
            }
         ];
      }

      if (!detectedMcp.connected) {
         return [
            {
               code: "disconnected-required-mcp",
               message: `Agent "${input.agent.name}" requires MCP "${requiredMcp}", but provider "${input.agent.provider}" reported it as ${detectedMcp.status}.`
            }
         ];
      }

      return [];
   });
}

export function rejectUnsupportedReasoningEffort(
   agent: AgentDefinition
): ValidationIssue[] {
   if (agent.reasoningEffort === undefined) {
      return [];
   }

   return [
      {
         code: "unsupported-reasoning-effort",
         message: `Provider "${agent.provider}" does not support reasoningEffort.`
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
      task?: string;
   }
): string {
   if (typeof input.task !== "string" || input.task.trim().length === 0) {
      throw new Error("A task is required to render a provider prompt.");
   }

   const replacements: Record<string, string> = {
      "{{artifactsDir}}": input.artifactsDir,
      "{{cwd}}": input.cwd,
      "{{mode}}": input.mode,
      "{{runFile}}": input.runFile,
      "{{runId}}": input.runId,
      "{{task}}": input.task
   };

   return agent.body.replaceAll(
      /\{\{artifactsDir\}\}|\{\{cwd\}\}|\{\{mode\}\}|\{\{runFile\}\}|\{\{runId\}\}|\{\{task\}\}/g,
      (placeholder) => replacements[placeholder] ?? placeholder
   );
}

export function finalizeRecord(input: {
   agent: ScopedAgentDefinition;
   cwd: string;
   endedAt: string;
   errorMessage?: string;
   exitCode: number | null;
   finalText: string;
   launchMode: LaunchMode;
   launch: RunLaunchSnapshot;
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
      agentPath: input.agent.path,
      agentScope: input.agent.scope,
      cwd: input.cwd,
      durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
      endedAt: input.endedAt,
      exitCode: input.exitCode,
      finalText: input.finalText,
      launch: input.launch,
      launchMode: input.launchMode,
      ...(typeof input.agent.model === "string"
         ? { model: input.agent.model }
         : {}),
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
      ...(typeof input.agent.reasoningEffort === "string"
         ? { reasoningEffort: input.agent.reasoningEffort }
         : {}),
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
