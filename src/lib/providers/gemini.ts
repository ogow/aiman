import * as path from "node:path";

import type { ProviderAdapter } from "../types.js";
import {
   buildAllowedEnvironment,
   buildPrompt,
   detectExecutable,
   extractUsageCandidate,
   finalizeRecord,
   validateReasoningEffort
} from "./shared.js";

function extractGeminiText(parsed: Record<string, unknown>): string {
   const response = parsed.response;

   if (typeof response === "string") {
      return response;
   }

   if (typeof response === "object" && response !== null) {
      const responseRecord = response as Record<string, unknown>;

      if (typeof responseRecord.text === "string") {
         return responseRecord.text;
      }

      if (Array.isArray(responseRecord.candidates)) {
         const texts = responseRecord.candidates.flatMap((candidate) => {
            if (typeof candidate !== "object" || candidate === null) {
               return [];
            }

            const content = (candidate as Record<string, unknown>).content;

            if (typeof content !== "object" || content === null) {
               return [];
            }

            const parts = (content as Record<string, unknown>).parts;

            if (!Array.isArray(parts)) {
               return [];
            }

            return parts.flatMap((part) => {
               if (typeof part !== "object" || part === null) {
                  return [];
               }

               const text = (part as Record<string, unknown>).text;
               return typeof text === "string" ? [text] : [];
            });
         });

         if (texts.length > 0) {
            return texts.join("\n");
         }
      }
   }

   if (typeof parsed.text === "string") {
      return parsed.text;
   }

   return "";
}

export function createGeminiAdapter(): ProviderAdapter {
   return {
      async detect() {
         return detectExecutable("gemini");
      },
      id: "gemini",
      async parseCompletedRun(input) {
         let parsed: Record<string, unknown> = {};

         if (input.stdout.trim().length > 0) {
            parsed = JSON.parse(input.stdout) as Record<string, unknown>;
         }

         const finalText = extractGeminiText(parsed);
         const status =
            input.signal === "SIGTERM"
               ? "cancelled"
               : input.exitCode === 0
                 ? "success"
                 : "error";
         const errorMessage =
            typeof parsed.error === "string"
               ? parsed.error
               : status === "error"
                 ? input.stderr.trim() || "Gemini execution failed."
                 : undefined;
         const usage =
            extractUsageCandidate(parsed.stats) ??
            extractUsageCandidate(parsed.usage);

         return finalizeRecord({
            agent: input.agent,
            cwd: input.cwd,
            endedAt: input.endedAt,
            exitCode: input.exitCode,
            finalText,
            mode: input.mode,
            promptFile: input.promptFile,
            resultFile: input.resultFile,
            runDir: input.runDir,
            runId: input.runId,
            signal: input.signal,
            startedAt: input.startedAt,
            status,
            stderrLog: input.stderrLog,
            stdoutLog: input.stdoutLog,
            ...(typeof errorMessage === "string" ? { errorMessage } : {}),
            ...(usage ? { usage } : {})
         });
      },
      prepare(agent, input) {
         const prompt = buildPrompt(agent, input);
         const runDir = path.dirname(input.reportFile);

         return {
            args: [
               "--prompt",
               prompt,
               "--approval-mode",
               input.mode === "workspace-write" ? "auto_edit" : "plan",
               "--output-format",
               "json",
               ...(agent.model ? ["--model", agent.model] : [])
            ],
            command: "gemini",
            cwd: input.cwd,
            env: buildAllowedEnvironment({
               AIMAN_ARTIFACTS_DIR: input.artifactsDir,
               AIMAN_REPORT_PATH: input.reportFile,
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
