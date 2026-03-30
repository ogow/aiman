import { createInterface } from "node:readline/promises";

import type { ArgumentsCamelCase, Argv } from "yargs";

import { agentScopeChoices, createAgentFile } from "../lib/agents.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import type { AgentDefinition, AgentScope, ProviderId } from "../lib/types.js";

type CreateArguments = {
   description?: string;
   force?: boolean;
   instructions?: string;
   json?: boolean;
   model?: string;
   name?: string;
   provider?: ProviderId;
   reasoningEffort?: AgentDefinition["reasoningEffort"];
   scope?: AgentScope;
};

const providerChoices = ["codex", "gemini"] as const;
const reasoningEffortChoices = ["low", "medium", "high"] as const;

export const command = "create <name>";
export const describe = "Create an authored agent";

function quoteCliValue(value: string): string {
   return JSON.stringify(value);
}

async function readInstructionsFromPrompt(): Promise<string> {
   if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new UserError(
         "Agent instructions are required. Provide them with --instructions."
      );
   }

   const readline = createInterface({
      input: process.stdin,
      output: process.stdout
   });

   try {
      const instructions = (await readline.question("Instructions: ")).trim();

      if (instructions.length === 0) {
         throw new UserError(
            "Agent instructions are required. Provide them with --instructions."
         );
      }

      return instructions;
   } finally {
      readline.close();
   }
}

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("name", {
         describe: "Agent name",
         type: "string"
      })
      .option("scope", {
         choices: agentScopeChoices,
         describe: "Where to create the agent",
         type: "string"
      })
      .option("provider", {
         choices: providerChoices,
         describe: "Provider adapter for this agent",
         type: "string"
      })
      .option("description", {
         describe: "Short description for listings",
         type: "string"
      })
      .option("instructions", {
         describe: "Primary task instructions for the agent",
         type: "string"
      })
      .option("model", {
         describe: "Model for this agent",
         type: "string"
      })
      .option("reasoning-effort", {
         choices: reasoningEffortChoices,
         describe: "Optional reasoning effort override",
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
   args: ArgumentsCamelCase<CreateArguments>
): Promise<void> {
   if (typeof args.name !== "string" || args.name.trim().length === 0) {
      throw new UserError("Agent name is required.");
   }

   if (args.scope !== "project" && args.scope !== "user") {
      throw new UserError(
         "Agent scope is required. Provide --scope project or --scope user."
      );
   }

   if (
      typeof args.description !== "string" ||
      args.description.trim().length === 0
   ) {
      throw new UserError(
         "Agent description is required. Provide it with --description."
      );
   }

   if (args.provider !== "codex" && args.provider !== "gemini") {
      throw new UserError(
         "Agent provider is required. Provide --provider codex or --provider gemini."
      );
   }

   if (typeof args.model !== "string" || args.model.trim().length === 0) {
      throw new UserError("Agent model is required. Provide it with --model.");
   }

   const instructions =
      typeof args.instructions === "string" &&
      args.instructions.trim().length > 0
         ? args.instructions.trim()
         : await readInstructionsFromPrompt();
   const agent = await createAgentFile(getProjectPaths(), {
      description: args.description,
      instructions,
      ...(args.force === true ? { force: true } : {}),
      model: args.model.trim(),
      name: args.name,
      provider: args.provider,
      ...(typeof args.reasoningEffort === "string"
         ? { reasoningEffort: args.reasoningEffort }
         : {}),
      scope: args.scope
   });

   if (args.json) {
      writeJson({
         agent,
         created: true,
         path: agent.path
      });
      return;
   }

   process.stdout.write(`created: ${agent.path}\n`);
   process.stdout.write(`scope: ${agent.scope}\n`);
   process.stdout.write(
      `show: aiman show ${quoteCliValue(agent.name)} --scope ${agent.scope}\n`
   );
   process.stdout.write(
      `run: aiman run ${quoteCliValue(agent.name)} --scope ${agent.scope} --task ${quoteCliValue("...")}\n`
   );
}
