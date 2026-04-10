import * as path from "node:path";

import type { ProviderAdapter } from "../types.js";
import {
   buildAllowedEnvironment,
   detectRequiredMcps,
   detectExecutable,
   parseGeminiMcpList,
   rejectUnsupportedReasoningEffort,
   renderAgentPrompt
} from "./runtime.js";

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
   return ["--output-format", "stream-json"];
}

function getGeminiWorkspaceArgs(artifactsDir: string): string[] {
   return artifactsDir.length > 0
      ? ["--include-directories", artifactsDir]
      : [];
}

function extractLastJsonObject(text: string): string | undefined {
   let start = -1;
   let depth = 0;
   let inString = false;
   let isEscaped = false;
   let lastValidCandidate: string | undefined;

   for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (start === -1) {
         if (char === "{") {
            start = index;
            depth = 1;
            inString = false;
            isEscaped = false;
         }

         continue;
      }

      if (inString) {
         if (isEscaped) {
            isEscaped = false;
            continue;
         }

         if (char === "\\") {
            isEscaped = true;
            continue;
         }

         if (char === '"') {
            inString = false;
         }

         continue;
      }

      if (char === '"') {
         inString = true;
         continue;
      }

      if (char === "{") {
         depth += 1;
         continue;
      }

      if (char !== "}") {
         continue;
      }

      depth -= 1;

      if (depth !== 0) {
         continue;
      }

      const candidate = text.slice(start, index + 1).trim();

      try {
         JSON.parse(candidate);
         lastValidCandidate = candidate;
      } catch {
         // Keep scanning for the next balanced JSON object.
      }

      start = -1;
   }

   return lastValidCandidate;
}

function parseGeminiJsonOutput(stdout: string): {
   errorMessage?: string;
   responseText: string;
   parseError?: string;
} {
   const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

   if (lines.length === 0) {
      return {
         responseText: "",
         parseError: "Gemini did not produce any output."
      };
   }

   let responseText = "";
   let errorMessage: string | undefined;

   for (const line of lines) {
      try {
         const payload = JSON.parse(line) as Record<string, unknown>;

         if (typeof payload["response"] === "string") {
            responseText = payload["response"];
         }

         if (typeof payload["error"] === "object" && payload["error"] !== null) {
            const topLevelError = payload["error"] as Record<string, unknown>;
            if (typeof topLevelError["message"] === "string") {
               errorMessage = topLevelError["message"];
            }
         }

         if (payload["type"] === "message" && payload["role"] === "assistant") {
            const content = payload["content"];
            if (typeof content === "string") {
               if (payload["delta"] === true) {
                  responseText += content;
               } else {
                  responseText = content;
               }
            }
         }

         if (payload["type"] === "error") {
            const error = payload["error"] as Record<string, unknown> | undefined;
            const message = error?.["message"] ?? payload["message"];
            if (typeof message === "string") {
               errorMessage = message;
            }
         }
      } catch {
         // Ignore lines that are not valid JSON (e.g. YOLO warnings)
      }
   }

   if (errorMessage !== undefined) {
      return { errorMessage, responseText: "" };
   }

   return { responseText: responseText.trim() };
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
      async parseCompletion(input) {
         const parsedOutput = parseGeminiJsonOutput(input.stdout);
         if (parsedOutput.parseError !== undefined) {
            return {
               error: {
                  message: parsedOutput.parseError
               }
            };
         }

         if (parsedOutput.errorMessage !== undefined) {
            return {
               error: {
                  message: parsedOutput.errorMessage
               }
            };
         }

         const output =
            input.profile?.resultMode === "schema"
               ? extractLastJsonObject(parsedOutput.responseText) ??
                 parsedOutput.responseText
               : parsedOutput.responseText;

         return {
            output
         };
      },
      async prepare(agent, input) {
         const prompt = input.renderedPrompt ?? renderAgentPrompt(agent, input);
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
               GEMINI_CLI_SYSTEM_SETTINGS_PATH: childSettingsOverlay.path,
               PLAYWRIGHT_MCP_OUTPUT_DIR: input.artifactsDir
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
