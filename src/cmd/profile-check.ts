import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import {
   checkProfileDefinition,
   profileScopeChoices
} from "../lib/profiles.js";
import type { ProfileScope, ValidationIssue } from "../lib/types.js";

type ProfileCheckArguments = {
   json?: boolean;
   profile?: string;
   scope?: ProfileScope;
};

export const command = "check <profile>";
export const describe = "Statically validate one profile";

function renderIssueList(issues: ValidationIssue[]): string {
   if (issues.length === 0) {
      return "None.";
   }

   return issues.map((issue) => `- [${issue.code}] ${issue.message}`).join("\n");
}

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("profile", {
         describe: "Profile name",
         type: "string"
      })
      .option("scope", {
         choices: profileScopeChoices,
         describe: "Resolve the profile from one scope only",
         type: "string"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<ProfileCheckArguments>
): Promise<void> {
   if (typeof args.profile !== "string" || args.profile.trim().length === 0) {
      throw new UserError("Profile name is required.");
   }

   const report = await checkProfileDefinition(
      getProjectPaths(),
      args.profile,
      args.scope
   );

   process.exitCode = report.errors.length > 0 ? 1 : 0;

   if (args.json) {
      writeJson(report);
      return;
   }

   process.stdout.write(
      `${renderSection(
         "Profile check",
         renderLabelValueBlock([
            { label: "Status", value: report.status },
            { label: "Name", value: report.profile.name ?? report.profile.id },
            { label: "Scope", value: report.profile.scope },
            { label: "Provider", value: report.profile.provider ?? "" },
            { label: "Mode", value: report.profile.mode ?? "" },
            { label: "Model", value: report.profile.model ?? "" },
            { label: "Path", value: report.profile.path },
            { label: "Errors", value: String(report.errors.length) },
            { label: "Warnings", value: String(report.warnings.length) }
         ])
      )}\n\n${renderSection("Errors", renderIssueList(report.errors))}\n\n${renderSection("Warnings", renderIssueList(report.warnings))}\n`
   );
}
