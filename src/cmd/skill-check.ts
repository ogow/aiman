import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import { checkSkillDefinition } from "../lib/skills.js";
import type { ProfileScope } from "../lib/types.js";

type SkillCheckArguments = {
   json?: boolean;
   scope?: ProfileScope;
   skill?: string;
};

export const command = "check <skill>";
export const describe = "Validate one local aiman skill";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("skill", {
         describe: "Skill name",
         type: "string"
      })
      .option("scope", {
         choices: ["project", "user"] as const,
         describe: "Resolve the skill from one scope only",
         type: "string"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<SkillCheckArguments>
): Promise<void> {
   if (typeof args.skill !== "string" || args.skill.trim().length === 0) {
      throw new UserError("Skill name is required.");
   }

   const result = await checkSkillDefinition(
      getProjectPaths(),
      args.skill,
      args.scope
   );

   process.exitCode = result.status === "ok" ? 0 : 1;

   if (args.json) {
      writeJson(result);
      return;
   }

   process.stdout.write(
      `${renderSection(
         "Skill check",
         renderLabelValueBlock([
            { label: "Status", value: result.status },
            { label: "Name", value: result.skill.name },
            { label: "Scope", value: result.skill.scope },
            { label: "Path", value: result.skill.path },
            { label: "Errors", value: String(result.errors.length) }
         ])
      )}\n\n${renderSection(
         "Errors",
         result.errors.length === 0
            ? "None."
            : result.errors
                 .map((issue) => `- [${issue.code}] ${issue.message}`)
                 .join("\n")
      )}\n`
   );
}
