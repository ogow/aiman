import * as path from "node:path";

import type { ProviderAdapter } from "../types.js";
import {
   buildAllowedEnvironment,
   buildPrompt,
   deriveCodexLastMessagePath,
   detectExecutable,
   extractUsageCandidate,
   finalizeRecord,
   readOptionalFile,
   validateReasoningEffort
} from "./shared.js";

function extractTextParts(value: unknown): string[] {
   if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? [trimmed] : [];
   }

   if (Array.isArray(value)) {
      return value.flatMap((item) => extractTextParts(item));
   }

   if (typeof value !== "object" || value === null) {
      return [];
   }

   const record = value as Record<string, unknown>;
   const directText = [
      record.finalText,
      record.text,
      record.message,
      record.content
   ].flatMap((item) => extractTextParts(item));

   return directText.length > 0
      ? directText
      : Object.values(record).flatMap((item) => extractTextParts(item));
}

export function createCodexAdapter(): ProviderAdapter {
   return {
      async detect() {
         return detectExecutable("codex");
      },
      id: "codex",
      async parseCompletedRun(input) {
         const lastMessagePath = deriveCodexLastMessagePath(input.resultFile);
         const usageCandidates: Array<
            ReturnType<typeof extractUsageCandidate>
         > = [];
         const textCandidates: string[] = [];

         for (const line of input.stdout.split("\n")) {
            const trimmed = line.trim();

            if (trimmed.length === 0) {
               continue;
            }

            try {
               const parsed = JSON.parse(trimmed) as Record<string, unknown>;
               textCandidates.push(...extractTextParts(parsed));

               for (const value of Object.values(parsed)) {
                  const usage = extractUsageCandidate(value);

                  if (usage) {
                     usageCandidates.push(usage);
                  }
               }
            } catch {}
         }

         const fallbackMessage = (
            await readOptionalFile(lastMessagePath)
         ).trim();
         const finalText =
            [...textCandidates]
               .reverse()
               .find((candidate) => candidate.length > 0) ?? fallbackMessage;
         const status =
            input.signal === "SIGTERM"
               ? "cancelled"
               : input.exitCode === 0
                 ? "success"
                 : "error";
         const errorMessage =
            status === "error"
               ? input.stderr.trim() || "Codex execution failed."
               : undefined;
         const usage = usageCandidates.find(
            (candidate) => candidate !== undefined
         );

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
         const lastMessagePath = deriveCodexLastMessagePath(input.resultFile);
         const prompt = buildPrompt(agent, input);
         const runDir = path.dirname(input.reportFile);
         const environment = buildAllowedEnvironment({
            AIMAN_ARTIFACTS_DIR: input.artifactsDir,
            AIMAN_REPORT_PATH: input.reportFile,
            AIMAN_RUN_DIR: runDir,
            AIMAN_RUN_ID: input.runId
         });

         return {
            args: [
               "exec",
               "--sandbox",
               input.mode === "workspace-write"
                  ? "workspace-write"
                  : "read-only",
               "-a",
               "never",
               "--cd",
               input.cwd,
               "--json",
               "--output-last-message",
               lastMessagePath,
               ...(agent.model ? ["--model", agent.model] : []),
               "-"
            ],
            command: "codex",
            cwd: input.cwd,
            env: environment,
            renderedPrompt: prompt,
            stdin: prompt
         };
      },
      validateAgent(agent) {
         return validateReasoningEffort(agent);
      }
   };
}
