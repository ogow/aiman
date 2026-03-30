import * as path from "node:path";

import type { ProviderAdapter } from "../types.js";
import {
   buildAllowedEnvironment,
   buildPrompt,
   deriveCodexLastMessagePath,
   detectExecutable,
   finalizeRecord,
   readOptionalFile
} from "./shared.js";

export function createCodexAdapter(): ProviderAdapter {
   return {
      async detect() {
         return detectExecutable("codex");
      },
      id: "codex",
      async parseCompletedRun(input) {
         const lastMessagePath = deriveCodexLastMessagePath(input.runDir);
         const fallbackMessage = (
            await readOptionalFile(lastMessagePath)
         ).trim();
         const finalText = fallbackMessage || input.stdout.trim();
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
         const runDir = path.dirname(input.runFile);
         const lastMessagePath = deriveCodexLastMessagePath(runDir);
         const prompt = buildPrompt(agent, input);
         const environment = buildAllowedEnvironment({
            AIMAN_ARTIFACTS_DIR: input.artifactsDir,
            AIMAN_RUN_PATH: input.runFile,
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
               "--output-last-message",
               lastMessagePath,
               ...(agent.reasoningEffort
                  ? [
                       "--config",
                       `model_reasoning_effort="${agent.reasoningEffort}"`
                    ]
                  : []),
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
      validateAgent() {
         return [];
      }
   };
}
