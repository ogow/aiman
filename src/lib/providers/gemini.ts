import * as path from "node:path";

import type { ProviderAdapter } from "../types.js";
import {
   buildAllowedEnvironment,
   buildPrompt,
   detectRequiredMcps,
   detectExecutable,
   finalizeRecord,
   parseGeminiMcpList,
   rejectUnsupportedReasoningEffort
} from "./shared.js";

type GeminiJsonError = {
   message?: string;
   type?: string;
};

type GeminiJsonOutput = {
   error?: GeminiJsonError;
   response?: string;
};

function getGeminiContextFileSetting(
   contextFileNames: string[] | undefined
): string | string[] {
   const fileNames =
      contextFileNames !== undefined && contextFileNames.length > 0
         ? contextFileNames
         : ["AGENTS.md"];

   if (fileNames.length === 1) {
      return fileNames[0] ?? "AGENTS.md";
   }

   return fileNames;
}

function getGeminiChildSettingsOverlay(input: {
   contextFileNames?: string[];
   runDir: string;
}): {
   content: string;
   path: string;
} {
   return {
      content: JSON.stringify(
         {
            context: {
               fileName: getGeminiContextFileSetting(input.contextFileNames)
            }
         },
         null,
         2
      ),
      path: path.join(input.runDir, ".gemini-system-settings.json")
   };
}

function getGeminiOutputFormatArgs(): string[] {
   return ["--output-format", "json"];
}

function getGeminiWorkspaceArgs(artifactsDir: string): string[] {
   return artifactsDir.length > 0
      ? ["--include-directories", artifactsDir]
      : [];
}

function parseGeminiJsonOutput(stdout: string): {
   errorMessage?: string;
   finalText: string;
   parseError?: string;
} {
   const trimmed = stdout.trim();

   if (trimmed.length === 0) {
      return {
         finalText: "",
         parseError: "Gemini did not produce JSON output."
      };
   }

   try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (
         typeof parsed !== "object" ||
         parsed === null ||
         Array.isArray(parsed)
      ) {
         return {
            finalText: "",
            parseError: "Gemini JSON output must be an object."
         };
      }

      const payload = parsed as GeminiJsonOutput;
      const errorMessage =
         typeof payload.error?.message === "string"
            ? payload.error.message.trim()
            : undefined;

      if (typeof errorMessage === "string" && errorMessage.length > 0) {
         return {
            errorMessage,
            finalText: ""
         };
      }

      if (typeof payload.response !== "string") {
         return {
            finalText: "",
            parseError: "Gemini JSON output did not include a response."
         };
      }

      return {
         finalText: payload.response.trim()
      };
   } catch {
      return {
         finalText: "",
         parseError: "Gemini did not return valid JSON output."
      };
   }
}

export function createGeminiAdapter(): ProviderAdapter {
   return {
      async detect(agent) {
         const issues = await detectExecutable("gemini");

         if (issues.length > 0) {
            return issues;
         }

         return [
            ...issues,
            ...(await detectRequiredMcps({
               agent,
               args: ["mcp", "list"],
               command: "gemini",
               parseList: parseGeminiMcpList
            }))
         ];
      },
      id: "gemini",
      async parseCompletedRun(input) {
         const profile = input.profile ?? input.agent;

         if (profile === undefined) {
            throw new Error("Completed Gemini run is missing its profile.");
         }

         const parsedOutput = parseGeminiJsonOutput(input.stdout);
         const status =
            input.signal === "SIGTERM"
               ? "cancelled"
               : input.exitCode === 0 &&
                   parsedOutput.parseError === undefined &&
                   parsedOutput.errorMessage === undefined
                 ? "success"
                 : "error";
         const errorMessage =
            status === "error"
               ? (parsedOutput.parseError ??
                 parsedOutput.errorMessage ??
                 (input.stderr.trim() || "Gemini execution failed."))
               : undefined;

         return finalizeRecord({
            cwd: input.cwd,
            endedAt: input.endedAt,
            exitCode: input.exitCode,
            finalText: parsedOutput.finalText,
            launchMode: input.launchMode,
            launch: input.launch,
            profile,
            promptFile: input.promptFile,
            projectRoot: input.projectRoot,
            runDir: input.runDir,
            runId: input.runId,
            signal: input.signal,
            startedAt: input.startedAt,
            status,
            ...(typeof errorMessage === "string" ? { errorMessage } : {}),
            ...(typeof input.stderrLog === "string"
               ? { stderrLog: input.stderrLog }
               : {}),
            ...(typeof input.stdoutLog === "string"
               ? { stdoutLog: input.stdoutLog }
               : {})
         });
      },
      async prepare(agent, input) {
         const prompt = input.renderedPrompt ?? buildPrompt(agent, input);
         const runDir = path.dirname(input.runFile);
         const childSettingsOverlay = getGeminiChildSettingsOverlay({
            ...(input.contextFileNames !== undefined
               ? { contextFileNames: input.contextFileNames }
               : {}),
            runDir
         });

         return {
            args: [
               "--prompt",
               "",
               ...getGeminiOutputFormatArgs(),
               ...getGeminiWorkspaceArgs(input.artifactsDir),
               "--approval-mode",
               "yolo",
               ...(agent.model !== "auto" ? ["--model", agent.model] : [])
            ],
            command: "gemini",
            cwd: input.cwd,
            env: buildAllowedEnvironment({
               AIMAN_ARTIFACTS_DIR: input.artifactsDir,
               AIMAN_RUN_PATH: input.runFile,
               AIMAN_RUN_DIR: runDir,
               AIMAN_RUN_ID: input.runId,
               GEMINI_CLI_SYSTEM_SETTINGS_PATH: childSettingsOverlay.path
            }),
            promptTransport: "stdin",
            renderedPrompt: prompt,
            stdin: prompt,
            supportFiles: [childSettingsOverlay]
         };
      },
      validateAgent(agent) {
         return rejectUnsupportedReasoningEffort(agent);
      }
   };
}
