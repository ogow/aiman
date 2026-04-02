import type { ArgumentsCamelCase, Argv } from "yargs";

import { agentScopeChoices, loadAgentDefinition } from "../lib/agents.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import {
   getProviderCapabilities,
   summarizeProviderModes
} from "../lib/provider-capabilities.js";
import type { AgentScope } from "../lib/types.js";

type ShowArguments = {
   agent?: string;
   json?: boolean;
   scope?: AgentScope;
};

export const command = "show <agent>";
export const describe = "Show one specialist agent";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("agent", {
         describe: "Agent name",
         type: "string"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      })
      .option("scope", {
         choices: agentScopeChoices,
         describe: "Resolve the agent from one scope only",
         type: "string"
      });
}

export async function handler(
   args: ArgumentsCamelCase<ShowArguments>
): Promise<void> {
   if (typeof args.agent !== "string" || args.agent.length === 0) {
      throw new UserError("Agent name is required.");
   }

   const agent = await loadAgentDefinition(
      getProjectPaths(),
      args.agent,
      args.scope
   );
   const capabilities = getProviderCapabilities(agent.provider);

   if (args.json) {
      writeJson({
         agent,
         capabilities
      });
      return;
   }

   const summary = renderLabelValueBlock([
      { label: "Name", value: agent.name },
      { label: "Scope", value: agent.scope },
      { label: "Provider", value: agent.provider },
      {
         label: "Permissions",
         value: agent.permissions ?? agent.mode ?? ""
      },
      { label: "Run modes", value: summarizeProviderModes(agent.provider) },
      { label: "Model", value: agent.model ?? "" },
      { label: "Reasoning", value: agent.reasoningEffort ?? "" },
      { label: "Required MCPs", value: agent.requiredMcps?.join(", ") ?? "" },
      { label: "Context files", value: agent.contextFiles?.join(", ") ?? "" },
      { label: "Skills", value: agent.skills?.join(", ") ?? "" },
      { label: "Description", value: agent.description },
      { label: "Path", value: agent.path }
   ]);
   const rights = renderLabelValueBlock([
      ...capabilities.modes.map((modeCapability) => ({
         label: modeCapability.mode,
         value: modeCapability.details
      })),
      {
         label: "Environment",
         value: capabilities.environmentSummary
      }
   ]);

   process.stdout.write(
      `${renderSection("Agent", summary)}\n\n${renderSection("Rights", rights)}\n\n${renderSection("Instructions", agent.body)}\n`
   );
}
