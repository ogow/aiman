import type { ArgumentsCamelCase, Argv } from "yargs";

import { getProjectPaths } from "../lib/paths.js";
import {
   agentScopeChoices,
   checkAgentDefinition,
   formatProfileModel
} from "../lib/agents.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import type { ProfileScope, ValidationIssue } from "../lib/types.js";

type AgentCheckArguments = {
   json?: boolean;
   agent?: string;
   scope?: ProfileScope;
};

export const command = "check <agent>";
export const describe = "Statically validate one agent";

function renderIssueList(issues: ValidationIssue[]): string {
   if (issues.length === 0) {
      return "None.";
   }

   return issues
      .map((issue) => `- [${issue.code}] ${issue.message}`)
      .join("\n");
}

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
   args: ArgumentsCamelCase<AgentCheckArguments>
): Promise<void> {
   if (typeof args.agent !== "string" || args.agent.trim().length === 0) {
      throw new UserError("Agent name is required.");
   }

   const report = await checkAgentDefinition(
      getProjectPaths(),
      args.agent,
      args.scope
   );

   process.exitCode = report.errors.length > 0 ? 1 : 0;

   if (args.json) {
      writeJson(report);
      return;
   }

   process.stdout.write(
      `${renderSection(
         "Agent check",
         renderLabelValueBlock([
            { label: "Status", value: report.status },
            { label: "Name", value: report.profile.name ?? report.profile.id },
            { label: "Scope", value: report.profile.scope },
            { label: "Provider", value: report.profile.provider ?? "" },
            {
               label: "Model",
               value: formatProfileModel({
                  ...(typeof report.profile.model === "string"
                     ? { model: report.profile.model }
                     : {}),
                  ...(typeof report.profile.provider === "string"
                     ? { provider: report.profile.provider }
                     : {})
               })
            },
            { label: "Reasoning", value: report.profile.reasoningEffort ?? "" },
            { label: "Path", value: report.profile.path },
            { label: "Errors", value: String(report.errors.length) },
            { label: "Warnings", value: String(report.warnings.length) }
         ])
      )}\n\n${renderSection("Errors", renderIssueList(report.errors))}\n\n${renderSection("Warnings", renderIssueList(report.warnings))}\n`
   );
}
