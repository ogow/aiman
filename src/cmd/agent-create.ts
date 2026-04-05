import type { ArgumentsCamelCase, Argv } from "yargs";

import { createAiman } from "../api/index.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import { agentScopeChoices, formatProfileModel } from "../lib/agents.js";
import type {
   ProfileScope,
   ProviderId,
   ReasoningEffort,
   RunMode
} from "../lib/types.js";

type AgentCreateArguments = {
   description?: string;
   force?: boolean;
   instructions?: string;
   json?: boolean;
   mode?: RunMode;
   model?: string;
   name?: string;
   provider?: ProviderId;
   reasoningEffort?: ReasoningEffort;
   scope?: ProfileScope;
};

const providerChoices = ["codex", "gemini"] as const;
const modeChoices = ["safe", "yolo"] as const;
const reasoningEffortChoices = ["none", "low", "medium", "high"] as const;

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
         demandOption: true,
         describe: "Provider backend for this agent",
         type: "string"
      })
      .option("mode", {
         choices: modeChoices,
         demandOption: true,
         describe: "Default mode for this agent",
         type: "string"
      })
      .option("description", {
         demandOption: true,
         describe: "Short description for listings",
         type: "string"
      })
      .option("instructions", {
         describe: "Agent instructions; use stdin for multiline input",
         type: "string"
      })
      .option("model", {
         demandOption: true,
         describe:
            'Model for this agent. For Gemini, use "auto" to let the Gemini CLI choose its automatic default model.',
         type: "string"
      })
      .option("reasoning-effort", {
         choices: reasoningEffortChoices,
         demandOption: true,
         describe:
            'Required reasoning effort for this agent. Use "none" when the selected provider/model does not support reasoning effort.',
         type: "string"
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

   if (instructions.length === 0) {
      throw new UserError(
         "Agent instructions are required. Provide them with --instructions or stdin."
      );
   }

   if (typeof args.provider !== "string") {
      throw new UserError("Provider is required.");
   }

   if (typeof args.mode !== "string") {
      throw new UserError("Mode is required.");
   }

   if (typeof args.model !== "string" || args.model.trim().length === 0) {
      throw new UserError("Model is required.");
   }

   if (typeof args.reasoningEffort !== "string") {
      throw new UserError("Reasoning effort is required.");
   }

   const aiman = await createAiman();
   const agent = await aiman.agents.create({
      description: args.description ?? "",
      ...(args.force === true ? { force: true } : {}),
      instructions,
      model: args.model,
      mode: args.mode,
      name: args.name,
      provider: args.provider,
      reasoningEffort: args.reasoningEffort,
      scope: args.scope ?? "project"
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
            { label: "Mode", value: agent.mode },
            {
               label: "Model",
               value: formatProfileModel(agent)
            },
            { label: "Reasoning", value: agent.reasoningEffort },
            { label: "Path", value: agent.path }
         ])
      )}\n`
   );
}
