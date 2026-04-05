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

function getCodexContextConfigArgs(
   contextFileNames: string[] | undefined
): string[] {
   const fallbackFileNames = (contextFileNames ?? []).filter(
      (fileName) => fileName !== "AGENTS.md"
   );

   return [
      "--config",
      `project_doc_fallback_filenames=${JSON.stringify(fallbackFileNames)}`,
      "--config",
      'developer_instructions=""',
      "--config",
      'instructions=""',
      "--config",
      "agents={}"
   ];
}

function getCodexApprovalConfigArgs(): string[] {
   return ["--config", 'approval_policy="never"'];
}

function getCodexOutputArgs(): string[] {
   return ["--json"];
}

function getWindowsAutomationConfigArgs(): string[] {
   if (process.platform !== "win32") {
      return [];
   }

   return [
      "--config",
      "allow_login_shell=false",
      "--config",
      "shell_environment_policy.experimental_use_profile=false"
   ];
}

function getReasoningEffortConfigArgs(reasoningEffort: string): string[] {
   if (reasoningEffort === "none") {
      return [];
   }

   return ["--config", `model_reasoning_effort=${reasoningEffort}`];
}

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
         const profile = input.profile ?? input.agent;

         if (profile === undefined) {
            throw new Error("Completed Codex run is missing its profile.");
         }

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
            cwd: input.cwd,
            endedAt: input.endedAt,
            exitCode: input.exitCode,
            finalText: lastMessage,
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
         const runDir = path.dirname(input.runFile);
         const lastMessagePath = deriveCodexLastMessagePath(runDir);
         const prompt = input.renderedPrompt ?? buildPrompt(agent, input);
         const writableRoots =
            input.artifactsDir.length > 0
               ? ["--add-dir", input.artifactsDir]
               : [];
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
               input.mode === "yolo" ? "workspace-write" : "read-only",
               "--cd",
               input.cwd,
               "--output-last-message",
               lastMessagePath,
               ...getCodexOutputArgs(),
               ...writableRoots,
               ...getCodexApprovalConfigArgs(),
               ...getCodexContextConfigArgs(input.contextFileNames),
               ...getWindowsAutomationConfigArgs(),
               ...getReasoningEffortConfigArgs(agent.reasoningEffort),
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
