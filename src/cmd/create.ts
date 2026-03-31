import type { ArgumentsCamelCase, Argv } from "yargs";

import { agentScopeChoices, createAgentFile } from "../lib/agents.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import type {
   AgentDefinition,
   AgentScope,
   ProviderId,
   RunMode
} from "../lib/types.js";

type CreateArguments = {
   description?: string;
   force?: boolean;
   instructions?: string;
   json?: boolean;
   model?: string;
   name?: string;
   permissions?: RunMode;
   provider?: ProviderId;
   reasoningEffort?: AgentDefinition["reasoningEffort"];
   scope?: AgentScope;
};

const providerChoices = ["codex", "gemini"] as const;
const permissionChoices = ["read-only", "workspace-write"] as const;
const reasoningEffortChoices = ["low", "medium", "high"] as const;

export const command = "create <name>";
export const describe = "Create an authored agent";

function quoteCliValue(value: string): string {
   return JSON.stringify(value);
}

function toBuffer(value: Buffer | string): Buffer {
   return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

async function readBufferedStdin(): Promise<string> {
   await new Promise<void>((resolve) => {
      setImmediate(resolve);
   });

   const chunks: Buffer[] = [];
   let chunk = process.stdin.read();

   while (chunk !== null) {
      chunks.push(toBuffer(chunk));
      chunk = process.stdin.read();
   }

   return Buffer.concat(chunks).toString("utf8").trim();
}

async function readInstructionsFromStdin(waitForEnd: boolean): Promise<string> {
   if (process.stdin.isTTY) {
      return "";
   }

   if (!waitForEnd) {
      return readBufferedStdin();
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
         demandOption: true,
         describe: "Where to create the agent",
         type: "string"
      })
      .option("provider", {
         choices: providerChoices,
         demandOption: true,
         describe: "Provider adapter for this agent",
         type: "string"
      })
      .option("permissions", {
         choices: permissionChoices,
         default: "read-only",
         describe: "Declared execution permissions for this agent",
         type: "string"
      })
      .option("description", {
         demandOption: true,
         describe: "Short description for listings",
         type: "string"
      })
      .option("instructions", {
         describe:
            "Primary task instructions for the agent; use stdin for multiline input",
         type: "string"
      })
      .option("model", {
         demandOption: true,
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
      })
      .example(
         '$0 agent create reviewer --scope project --provider codex --permissions read-only --model gpt-5.4 --description "Reviews diffs" --instructions "Review the current patch."',
         "Create an agent with inline instructions"
      )
      .example(
         'cat reviewer.md | $0 agent create reviewer --scope user --provider gemini --permissions workspace-write --model gemini-2.5-pro --description "Reviews diffs"',
         "Create an agent from piped multiline instructions"
      );
}

export async function handler(
   args: ArgumentsCamelCase<CreateArguments>
): Promise<void> {
   if (typeof args.name !== "string" || args.name.trim().length === 0) {
      throw new UserError("Agent name is required.");
   }

   if (
      typeof args.description !== "string" ||
      args.description.trim().length === 0
   ) {
      throw new UserError(
         "Agent description is required. Provide it with --description."
      );
   }

   const scope = args.scope;
   const provider = args.provider;
   const permissions = args.permissions ?? "read-only";

   if (scope !== "project" && scope !== "user") {
      throw new UserError(
         "Agent scope is required. Provide --scope project or --scope user."
      );
   }

   if (provider !== "codex" && provider !== "gemini") {
      throw new UserError(
         "Agent provider is required. Provide --provider codex or --provider gemini."
      );
   }

   if (permissions !== "read-only" && permissions !== "workspace-write") {
      throw new UserError(
         "Agent permissions are required. Provide --permissions read-only or --permissions workspace-write."
      );
   }

   if (typeof args.model !== "string" || args.model.trim().length === 0) {
      throw new UserError("Agent model is required. Provide it with --model.");
   }

   const optionInstructions =
      typeof args.instructions === "string" ? args.instructions.trim() : "";
   const stdinInstructions = await readInstructionsFromStdin(
      optionInstructions.length === 0
   );

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

   const agent = await createAgentFile(getProjectPaths(), {
      description: args.description,
      instructions,
      ...(args.force === true ? { force: true } : {}),
      model: args.model.trim(),
      name: args.name,
      permissions,
      provider,
      ...(typeof args.reasoningEffort === "string"
         ? { reasoningEffort: args.reasoningEffort }
         : {}),
      scope
   });

   if (args.json) {
      writeJson({
         agent,
         created: true,
         path: agent.path
      });
      return;
   }

   const details = renderLabelValueBlock([
      { label: "Name", value: agent.name },
      { label: "Scope", value: agent.scope },
      { label: "Provider", value: agent.provider },
      { label: "Permissions", value: agent.permissions },
      { label: "Model", value: agent.model ?? "" },
      { label: "Path", value: agent.path },
      {
         label: "Show",
         value: `aiman agent show ${quoteCliValue(agent.name)} --scope ${agent.scope}`
      },
      {
         label: "Run",
         value: `aiman run ${quoteCliValue(agent.name)} --scope ${agent.scope} --task ${quoteCliValue("...")}`
      }
   ]);

   process.stdout.write(`${renderSection("Created agent", details)}\n`);
}
