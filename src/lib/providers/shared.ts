import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { hasErrorCode } from "../errors.js";
import { resolveCommandLaunch, resolveExecutable } from "../executables.js";
import type {
   LaunchMode,
   PersistedRunRecord,
   ProfileDefinition,
   RunLaunchSnapshot,
   RunMode,
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

   const renderedBody = profile.body.replaceAll(
      /\{\{artifactsDir\}\}|\{\{cwd\}\}|\{\{mode\}\}|\{\{runFile\}\}|\{\{runId\}\}|\{\{task\}\}/g,
      (placeholder) => replacements[placeholder] ?? placeholder
   );
   const sections = [renderedBody];

   return sections.join("\n\n");
}

export function finalizeRecord(input: {
   profile: ScopedProfileDefinition;
   cwd: string;
   endedAt: string;
   errorMessage?: string;
   exitCode: number | null;
   finalText: string;
   launchMode: LaunchMode;
   launch: RunLaunchSnapshot;
   mode: RunMode;
   promptFile: string;
   projectRoot: string;
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
      cwd: input.cwd,
      durationMs: Date.parse(input.endedAt) - Date.parse(input.startedAt),
      endedAt: input.endedAt,
      exitCode: input.exitCode,
      finalText: input.finalText,
      launch: input.launch,
      launchMode: input.launchMode,
      ...(typeof input.profile.model === "string"
         ? { model: input.profile.model }
         : {}),
      mode: input.mode,
      paths: {
         artifactsDir: path.join(input.runDir, "artifacts"),
         promptFile: input.promptFile,
         runFile: path.join(input.runDir, "run.md"),
         runDir: input.runDir,
         stopRequestedFile: path.join(input.runDir, ".stop-requested"),
         ...(typeof input.stderrLog === "string"
            ? { stderrLog: input.stderrLog }
            : {}),
         ...(typeof input.stdoutLog === "string"
            ? { stdoutLog: input.stdoutLog }
            : {})
      },
      profile: input.profile.name,
      profilePath: input.profile.path,
      profileScope: input.profile.scope,
      projectRoot: input.projectRoot,
      provider: input.profile.provider,
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
