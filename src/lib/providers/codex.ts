import * as path from "node:path";

import type { ProviderAdapter } from "../types.js";
import {
   buildAllowedEnvironment,
   buildPrompt,
   detectRequiredMcps,
   deriveCodexLastMessagePath,
   detectExecutable,
   finalizeRecord,
   parseCodexMcpList,
   readOptionalFile
} from "./shared.js";

export function createCodexAdapter(): ProviderAdapter {
   return {
      async detect(agent) {
         const issues = await detectExecutable("codex");

         if (issues.length > 0) {
            return issues;
         }

         return [
            ...issues,
            ...(await detectRequiredMcps({
               agent,
               args: ["mcp", "list", "--json"],
               command: "codex",
               parseList: parseCodexMcpList
            }))
         ];
      },
      id: "codex",
      async parseCompletedRun(input) {
         const lastMessagePath = deriveCodexLastMessagePath(input.runDir);
         const lastMessage = (await readOptionalFile(lastMessagePath)).trim();
         const wroteExpectedOutput = lastMessage.length > 0;
         const status =
            input.signal === "SIGTERM"
               ? "cancelled"
               : input.exitCode === 0 && wroteExpectedOutput
                 ? "success"
                 : "error";
         const errorMessage =
            status === "error"
               ? input.exitCode === 0 && !wroteExpectedOutput
                  ? "Codex did not write the expected last-message file."
                  : input.stderr.trim() || "Codex execution failed."
               : undefined;

         return finalizeRecord({
            agent: input.agent,
            cwd: input.cwd,
            endedAt: input.endedAt,
            exitCode: input.exitCode,
            finalText: lastMessage,
            launchMode: input.launchMode,
            launch: input.launch,
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
         const prompt = input.renderedPrompt ?? buildPrompt(agent, input);
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
            promptTransport: "stdin",
            renderedPrompt: prompt,
            stdin: prompt
         };
      },
      validateAgent() {
         return [];
      }
   };
}
