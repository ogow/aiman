import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import { loadSkillDefinition } from "../lib/skills.js";
import type { ProfileScope } from "../lib/types.js";

type SkillShowArguments = {
   json?: boolean;
   scope?: ProfileScope;
   skill?: string;
};

export const command = "show <skill>";
export const describe = "Show one local aiman skill";

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
   args: ArgumentsCamelCase<SkillShowArguments>
): Promise<void> {
   if (typeof args.skill !== "string" || args.skill.trim().length === 0) {
      throw new UserError("Skill name is required.");
   }

   const skill = await loadSkillDefinition(getProjectPaths(), args.skill, args.scope);

   if (args.json) {
      writeJson({ skill });
      return;
   }

   process.stdout.write(
      `${renderSection(
         "Skill",
         renderLabelValueBlock([
            { label: "Name", value: skill.name },
            { label: "Scope", value: skill.scope },
            { label: "Description", value: skill.description },
            { label: "Keywords", value: skill.keywords.join(", ") },
            { label: "Profiles", value: skill.profiles?.join(", ") ?? "" },
            { label: "Modes", value: skill.modes?.join(", ") ?? "" },
            { label: "Path", value: skill.path }
         ])
      )}\n\n${renderSection("Instructions", skill.body)}\n`
   );
}
