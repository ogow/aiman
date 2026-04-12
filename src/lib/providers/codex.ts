import * as path from "node:path";

import type { ProviderAdapter } from "../types.js";
import {
   buildAllowedEnvironment,
   detectRequiredMcps,
   deriveCodexLastMessagePath,
   detectExecutable,
   parseCodexMcpList,
   readOptionalFile,
   renderAgentPrompt
} from "./runtime.js";

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

function getCodexTrustArgs(): string[] {
   return ["--skip-git-repo-check"];
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
      async parseCompletion(input) {
         const lastMessagePath = deriveCodexLastMessagePath(input.runDir);
         const lastMessage = (await readOptionalFile(lastMessagePath)).trim();
         if (lastMessage.length === 0 && input.exitCode === 0) {
            return {
               error: {
                  message: "Codex did not write the expected last-message file."
               }
            };
         }

         return lastMessage.length > 0 ? { output: lastMessage } : {};
      },
      async prepare(agent, input) {
         const runDir = path.dirname(input.runFile);
         const lastMessagePath = deriveCodexLastMessagePath(runDir);
         const prompt = input.renderedPrompt ?? renderAgentPrompt(agent, input);
         const writableRoots =
            input.artifactsDir.length > 0
               ? ["--add-dir", input.artifactsDir]
               : [];
         const environment = buildAllowedEnvironment({
            AIMAN_ARTIFACTS_DIR: input.artifactsDir,
            AIMAN_RUN_PATH: input.runFile,
            AIMAN_RUN_DIR: runDir,
            AIMAN_RUN_ID: input.runId,
            PLAYWRIGHT_MCP_OUTPUT_DIR: input.artifactsDir
         });

         return {
            args: [
               "exec",
               "--sandbox",
               "workspace-write",
               "--cd",
               input.cwd,
               "--output-last-message",
               lastMessagePath,
               ...getCodexTrustArgs(),
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
