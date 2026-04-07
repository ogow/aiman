import type { ArgumentsCamelCase, Argv } from "yargs";

import { getProjectPaths } from "../lib/paths.js";
import {
   agentScopeChoices,
   formatProfileModel,
   loadAgentDefinition
} from "../lib/agents.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import { getProviderCapabilities } from "../lib/provider-capabilities.js";
import type { ProfileScope } from "../lib/types.js";

type AgentShowArguments = {
   json?: boolean;
   agent?: string;
   scope?: ProfileScope;
};

export const command = "show <agent>";
export const describe = "Show one agent";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("agent", {
         describe: "Agent name",
         type: "string"
      })
      .option("scope", {
         choices: agentScopeChoices,
         describe: "Resolve the agent from one scope only",
         type: "string"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<AgentShowArguments>
): Promise<void> {
   if (typeof args.agent !== "string" || args.agent.trim().length === 0) {
      throw new UserError("Agent name is required.");
   }

   const agent = await loadAgentDefinition(
      getProjectPaths(),
      args.agent,
      args.scope
   );
   const capabilities = getProviderCapabilities(agent.provider);

   if (args.json) {
      writeJson({ agent, capabilities });
      return;
   }

   process.stdout.write(
      `${renderSection(
         "Agent",
         renderLabelValueBlock([
            { label: "Name", value: agent.name },
            {
               label: "Scope",
               value: agent.isBuiltIn === true ? "builtin" : agent.scope
            },
            { label: "Provider", value: agent.provider },
            { label: "Model", value: formatProfileModel(agent) },
            { label: "Reasoning", value: agent.reasoningEffort },
            { label: "Description", value: agent.description },
            { label: "Path", value: agent.path }
         ])
      )}\n\n${renderSection(
         "Rights",
         renderLabelValueBlock([
            {
               label: "Launch",
               value: capabilities.launchSummary
            },
            {
               label: "Details",
               value: capabilities.details
            },
            {
               label: "Environment",
               value: capabilities.environmentSummary
            }
         ])
      )}\n\n${renderSection("Prompt", agent.body)}\n`
   );
}
