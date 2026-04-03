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

const impossibleGeminiContextFileName = "__AIMAN_UNUSED_CONTEXT__.md";

function getGeminiChildSettingsOverlay(input: { runDir: string }): {
   content: string;
   path: string;
} {
   return {
      content: JSON.stringify(
         {
            context: {
               fileName: impossibleGeminiContextFileName
            }
         },
         null,
         2
      ),
      path: path.join(input.runDir, ".gemini-system-settings.json")
   };
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

         const finalText = input.stdout.trim();
         const status =
            input.signal === "SIGTERM"
               ? "cancelled"
               : input.exitCode === 0
                 ? "success"
                 : "error";
         const errorMessage =
            status === "error"
               ? input.stderr.trim() || "Gemini execution failed."
               : undefined;

         return finalizeRecord({
            cwd: input.cwd,
            endedAt: input.endedAt,
            exitCode: input.exitCode,
            finalText,
            launchMode: input.launchMode,
            launch: input.launch,
            mode: input.mode,
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
            runDir
         });

         return {
            args: [
               "--prompt",
               "",
               "--approval-mode",
               input.mode === "yolo" ? "auto_edit" : "plan",
               ...(agent.model ? ["--model", agent.model] : [])
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
