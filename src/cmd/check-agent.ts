import type { ArgumentsCamelCase, Argv } from "yargs";

import { agentScopeChoices, checkAgentDefinition } from "../lib/agents.js";
import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import type {
   AgentCheckReport,
   AgentScope,
   ValidationIssue
} from "../lib/types.js";

type CheckArguments = {
   agent?: string;
   json?: boolean;
   scope?: AgentScope;
};

export const command = "check <agent>";
export const describe = "Statically validate one authored agent";

function quoteCliValue(value: string): string {
   return JSON.stringify(value);
}

function renderIssueList(issues: ValidationIssue[]): string {
   if (issues.length === 0) {
      return "None.";
   }

   return issues
      .map((issue) => `- [${issue.code}] ${issue.message}`)
      .join("\n");
}

function renderNextSteps(report: AgentCheckReport): string {
   const entries = [
      {
         label: "Show",
         value: `aiman agent show ${quoteCliValue(report.agent.name ?? report.agent.id)} --scope ${report.agent.scope}`
      },
      ...(report.errors.length === 0
         ? [
              {
                 label: "Run",
                 value: `aiman run ${quoteCliValue(report.agent.name ?? report.agent.id)} --scope ${report.agent.scope} --task ${quoteCliValue("...")}`
              }
           ]
         : [])
   ];

   return renderLabelValueBlock(entries);
}

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
   args: ArgumentsCamelCase<CheckArguments>
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

   const summary = renderLabelValueBlock([
      { label: "Status", value: report.status },
      { label: "Name", value: report.agent.name ?? report.agent.id },
      { label: "Scope", value: report.agent.scope },
      { label: "Provider", value: report.agent.provider ?? "" },
      {
         label: "Permissions",
         value: report.agent.permissions ?? report.agent.mode ?? ""
      },
      { label: "Model", value: report.agent.model ?? "" },
      { label: "Path", value: report.agent.path },
      { label: "Errors", value: String(report.errors.length) },
      { label: "Warnings", value: String(report.warnings.length) }
   ]);
   const sections = [
      renderSection("Agent check", summary),
      renderSection("Errors", renderIssueList(report.errors)),
      renderSection("Warnings", renderIssueList(report.warnings))
   ];
   const nextSteps = renderNextSteps(report);

   if (nextSteps.length > 0) {
      sections.push(renderSection("Next steps", nextSteps));
   }

   process.stdout.write(`${sections.join("\n\n")}\n`);
}
