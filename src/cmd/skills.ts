import type { ArgumentsCamelCase } from "yargs";

import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderSection, renderTable, truncateText } from "../lib/pretty.js";
import { listSkills } from "../lib/skills.js";
import type { AgentScope } from "../lib/types.js";

type SkillsArguments = {
   json?: boolean;
   scope?: AgentScope;
};

const skillScopeChoices = ["project", "user"] as const;
const maxDescriptionLength = 60;

export const command = "list";
export const describe = "List available skills";

export const builder = {
   json: {
      default: false,
      describe: "Print JSON output",
      type: "boolean"
   },
   scope: {
      choices: skillScopeChoices,
      describe: "Limit listing to one scope",
      type: "string"
   }
} as const;

export async function handler(
   args: ArgumentsCamelCase<SkillsArguments>
): Promise<void> {
   const skills = await listSkills(getProjectPaths(), args.scope);

   if (args.json) {
      writeJson({ skills });
      return;
   }

   if (skills.length === 0) {
      process.stdout.write(
         'No skills found.\n\nCreate one under ".aiman/skills/<name>/SKILL.md" or "~/.aiman/skills/<name>/SKILL.md".\n'
      );
      return;
   }

   const table = renderTable(
      ["Name", "Scope", "Description"],
      skills.map((skill) => [
         skill.name,
         skill.scope,
         truncateText(skill.description, maxDescriptionLength)
      ])
   );

   process.stdout.write(
      `${renderSection("Skills", table)}\n\nUse these names in profile frontmatter under "skills:" or pass them with "--skill".\n`
   );
}
