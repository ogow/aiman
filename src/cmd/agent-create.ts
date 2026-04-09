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
import type {
   ProfileScope,
   ProviderId,
   ReasoningEffort,
   ResultMode
} from "../lib/types.js";

type AgentCreateArguments = {
   capability?: string[];
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
      .option("description", {
         demandOption: true,
         describe: "Short description for listings",
         type: "string"
      })
      .option("capability", {
         array: true,
         describe:
            "Optional informational capability declaration. Repeat for multiple values.",
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
         describe:
            'Reasoning effort for this agent. Required for Codex. Use "none" for Gemini.',
         type: "string"
      })
      .option("result-mode", {
         choices: resultModeChoices,
         default: "text",
         describe:
            'How the runtime should treat the final answer. Use "text" for the default article-aligned mode, or "schema" when the agent must return structured JSON.',
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

   if (typeof args.model !== "string" || args.model.trim().length === 0) {
      throw new UserError("Model is required.");
   }

   const reasoningEffort =
      args.reasoningEffort ?? (args.provider === "gemini" ? "none" : undefined);

   if (reasoningEffort === undefined) {
      throw new UserError(
         `Reasoning effort is required for provider "${args.provider}".`
      );
   }

   const projectPaths = getProjectPaths();
   const agent = await createAgentFile(projectPaths, {
      ...(Array.isArray(args.capability) ? { capabilities: args.capability } : {}),
      description: args.description ?? "",
      ...(args.force === true ? { force: true } : {}),
      instructions,
      model: args.model,
      name: args.name,
      provider: args.provider,
      reasoningEffort,
      resultMode: args.resultMode ?? "text",
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
            {
               label: "Model",
               value: formatProfileModel(agent)
            },
            { label: "Reasoning", value: agent.reasoningEffort },
            { label: "Result", value: agent.resultMode },
            {
               label: "Capabilities",
               value: agent.capabilities?.join(", ") ?? ""
            },
            { label: "Path", value: agent.path }
         ])
      )}\n`
   );
}
