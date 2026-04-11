import { createInterface } from "node:readline/promises";
import type { ArgumentsCamelCase, Argv } from "yargs";

import { getProjectPaths } from "../lib/paths.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import {
   agentScopeChoices,
   createAgentFile,
   formatProfileModel
} from "../lib/agents.js";
import { formatAuthoredTimeout } from "../lib/timeouts.js";
import type {
   ProfileScope,
   ProviderId,
   ReasoningEffort,
   ResultMode
} from "../lib/types.js";

type AgentCreateArguments = {
   description?: string;
   force?: boolean;
   instructions?: string;
   json?: boolean;
   model?: string;
   name?: string;
   provider?: ProviderId;
   reasoningEffort?: ReasoningEffort;
   resultMode?: ResultMode;
   scope?: ProfileScope;
   timeoutMs?: number;
};

const providerChoices = ["codex", "gemini"] as const;
const reasoningEffortChoices = ["none", "low", "medium", "high"] as const;
const resultModeChoices = ["text", "schema"] as const;

export const command = "create <name>";
export const describe = "Create an agent";

function toBuffer(value: Buffer | string): Buffer {
   return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

async function readInstructionsFromStdin(): Promise<string> {
   if (process.stdin.isTTY) {
      return "";
   }

   const chunks: Buffer[] = [];

   for await (const chunk of process.stdin) {
      chunks.push(toBuffer(chunk));
   }

   return Buffer.concat(chunks).toString("utf8").trim();
}

type CreatePromptAnswers = {
   description?: string;
   provider?: ProviderId;
   resultMode?: ResultMode;
};

function normalizePromptResultMode(value: string): ResultMode | undefined {
   const normalized = value.trim().toLowerCase();

   if (normalized === "json" || normalized === "schema") {
      return "schema";
   }

   if (normalized === "text") {
      return "text";
   }

   return undefined;
}

async function promptForMissingCreateFields(
   input: CreatePromptAnswers
): Promise<CreatePromptAnswers> {
   if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return input;
   }

   const answers: CreatePromptAnswers = { ...input };
   const prompt = createInterface({
      input: process.stdin,
      output: process.stdout
   });

   try {
      if (answers.provider === undefined) {
         while (answers.provider === undefined) {
            const value = await prompt.question("Provider (codex/gemini): ");
            const normalized = value.trim().toLowerCase();

            if (normalized === "codex" || normalized === "gemini") {
               answers.provider = normalized;
               break;
            }
         }
      }

      if (
         typeof answers.description !== "string" ||
         answers.description.trim().length === 0
      ) {
         while (
            typeof answers.description !== "string" ||
            answers.description.trim().length === 0
         ) {
            answers.description = await prompt.question(
               "What job does this agent own? "
            );
         }
      }

      if (answers.resultMode === undefined) {
         while (answers.resultMode === undefined) {
            const value = await prompt.question(
               "Output style (text/json) [text]: "
            );
            const resultMode =
               value.trim().length === 0
                  ? "text"
                  : normalizePromptResultMode(value);

            if (resultMode !== undefined) {
               answers.resultMode = resultMode;
            }
         }
      }
   } finally {
      prompt.close();
   }

   return answers;
}

function buildDefaultInstructions(input: {
   description: string;
   resultMode: ResultMode;
}): string {
   if (input.resultMode === "schema") {
      return [
         `Do the work needed to ${input.description.trim().toLowerCase()}.`,
         "Return only the task result as strict JSON."
      ].join("\n");
   }

   return `Do the work needed to ${input.description.trim().toLowerCase()}.`;
}

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("name", {
         describe: "Agent name",
         type: "string"
      })
      .option("scope", {
         choices: agentScopeChoices,
         default: "project",
         describe: "Where to create the agent",
         type: "string"
      })
      .option("provider", {
         choices: providerChoices,
         describe: "Provider backend for this agent",
         type: "string"
      })
      .option("description", {
         describe: "Short description for listings",
         type: "string"
      })
      .option("instructions", {
         describe:
            "Optional agent instructions; when omitted, aiman generates a minimal default scaffold",
         type: "string"
      })
      .option("model", {
         describe:
            'Optional advanced override. For Gemini, use "auto" to let the Gemini CLI choose its automatic default model.',
         type: "string"
      })
      .option("reasoning-effort", {
         choices: reasoningEffortChoices,
         describe:
            "Optional advanced override for provider reasoning behavior.",
         type: "string"
      })
      .option("result-mode", {
         choices: resultModeChoices,
         describe:
            'How the runtime should treat the final answer. Use "text" for human-readable output or "schema" for strict JSON.',
         type: "string"
      })
      .option("timeout-ms", {
         describe:
            "Optional authored timeout in milliseconds. Use 0 to disable the runtime timeout for this agent.",
         type: "number"
      })
      .option("force", {
         default: false,
         describe: "Overwrite the target file in the selected scope",
         type: "boolean"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<AgentCreateArguments>
): Promise<void> {
   if (typeof args.name !== "string" || args.name.trim().length === 0) {
      throw new UserError("Agent name is required.");
   }

   const optionInstructions =
      typeof args.instructions === "string" ? args.instructions.trim() : "";
   const stdinInstructions = await readInstructionsFromStdin();

   if (optionInstructions.length > 0 && stdinInstructions.length > 0) {
      throw new UserError(
         "Provide agent instructions with --instructions or stdin, not both."
      );
   }

   const instructions =
      optionInstructions.length > 0 ? optionInstructions : stdinInstructions;

   const prompted = await promptForMissingCreateFields({
      ...(typeof args.description === "string"
         ? { description: args.description.trim() }
         : {}),
      ...(typeof args.provider === "string" ? { provider: args.provider } : {}),
      ...(args.resultMode !== undefined ? { resultMode: args.resultMode } : {})
   });

   const provider = prompted.provider;

   if (provider === undefined) {
      throw new UserError(
         "Provider is required. Pass --provider or run this command in an interactive TTY."
      );
   }

   const description = prompted.description?.trim();

   if (typeof description !== "string" || description.length === 0) {
      throw new UserError(
         "Description is required. Pass --description or run this command in an interactive TTY."
      );
   }

   const resultMode = prompted.resultMode ?? "text";

   const projectPaths = getProjectPaths();
   const agent = await createAgentFile(projectPaths, {
      description,
      ...(args.force === true ? { force: true } : {}),
      instructions:
         instructions.length > 0
            ? instructions
            : buildDefaultInstructions({ description, resultMode }),
      ...(typeof args.model === "string" && args.model.trim().length > 0
         ? { model: args.model.trim() }
         : {}),
      name: args.name,
      provider,
      ...(args.reasoningEffort !== undefined
         ? { reasoningEffort: args.reasoningEffort }
         : {}),
      resultMode,
      scope: args.scope ?? "project",
      ...(typeof args.timeoutMs === "number"
         ? { timeoutMs: args.timeoutMs }
         : {})
   });

   if (args.json) {
      writeJson({ agent, created: true, path: agent.path });
      return;
   }

   process.stdout.write(
      `${renderSection(
         "Created agent",
         renderLabelValueBlock([
            { label: "Name", value: agent.name },
            { label: "Scope", value: agent.scope },
            { label: "Provider", value: agent.provider },
            {
               label: "Model",
               value: formatProfileModel(agent)
            },
            { label: "Reasoning", value: agent.reasoningEffort },
            { label: "Result", value: agent.resultMode },
            { label: "Timeout", value: formatAuthoredTimeout(agent.timeoutMs) },
            { label: "Path", value: agent.path }
         ])
      )}\n`
   );
}
