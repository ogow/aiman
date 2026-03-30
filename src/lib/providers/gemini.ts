import * as path from "node:path";

import type { ProviderAdapter } from "../types.js";
import {
   buildAllowedEnvironment,
   buildPrompt,
   detectExecutable,
   finalizeRecord,
   validateReasoningEffort
} from "./shared.js";

export function createGeminiAdapter(): ProviderAdapter {
   return {
      async detect() {
         return detectExecutable("gemini");
      },
      id: "gemini",
      async parseCompletedRun(input) {
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
            agent: input.agent,
            cwd: input.cwd,
            endedAt: input.endedAt,
            exitCode: input.exitCode,
            finalText,
            mode: input.mode,
            promptFile: input.promptFile,
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
      prepare(agent, input) {
         const prompt = buildPrompt(agent, input);
         const runDir = path.dirname(input.runFile);

         return {
            args: [
               "--prompt",
               prompt,
               "--approval-mode",
               input.mode === "workspace-write" ? "auto_edit" : "plan",
               ...(agent.model ? ["--model", agent.model] : [])
            ],
            command: "gemini",
            cwd: input.cwd,
            env: buildAllowedEnvironment({
               AIMAN_ARTIFACTS_DIR: input.artifactsDir,
               AIMAN_RUN_PATH: input.runFile,
               AIMAN_RUN_DIR: runDir,
               AIMAN_RUN_ID: input.runId
            }),
            renderedPrompt: prompt
         };
      },
      validateAgent(agent) {
         return validateReasoningEffort(agent);
      }
   };
}
