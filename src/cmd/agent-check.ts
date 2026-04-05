import type { ArgumentsCamelCase, Argv } from "yargs";

import { createAiman } from "../api/index.js";
import { formatProfileModel } from "../lib/agents.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import { agentScopeChoices } from "../lib/agents.js";
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

   const report = await (
      await createAiman()
   ).agents.check(args.agent, args.scope);

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
            { label: "Name", value: report.agent.name ?? report.agent.id },
            { label: "Scope", value: report.agent.scope },
            { label: "Provider", value: report.agent.provider ?? "" },
            { label: "Mode", value: report.agent.mode ?? "" },
            {
               label: "Model",
               value: formatProfileModel({
                  ...(typeof report.agent.model === "string"
                     ? { model: report.agent.model }
                     : {}),
                  ...(typeof report.agent.provider === "string"
                     ? { provider: report.agent.provider }
                     : {})
               })
            },
            { label: "Reasoning", value: report.agent.reasoningEffort ?? "" },
            { label: "Path", value: report.agent.path },
            { label: "Errors", value: String(report.errors.length) },
            { label: "Warnings", value: String(report.warnings.length) }
         ])
      )}\n\n${renderSection("Errors", renderIssueList(report.errors))}\n\n${renderSection("Warnings", renderIssueList(report.warnings))}\n`
   );
}
