import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import { installSkill } from "../lib/skills.js";
import type { AgentScope } from "../lib/types.js";

type InstallSkillArguments = {
   force?: boolean;
   json?: boolean;
   path?: string;
   scope?: AgentScope;
   source?: string;
};

const skillScopeChoices = ["project", "user"] as const;
const defaultSkillSourceEnvVar = "AIMAN_DEFAULT_SKILL_SOURCE";
const defaultSkillSource = "https://github.com/ogow/aiman";

export const command = "install [source]";
export const describe =
   "Install a local skill folder or git repo into project or user scope";

function getDefaultSkillSource(): string {
   const overriddenSource = process.env[defaultSkillSourceEnvVar];

   if (
      typeof overriddenSource === "string" &&
      overriddenSource.trim().length > 0
   ) {
      return overriddenSource.trim();
   }

   return defaultSkillSource;
}

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("source", {
         describe:
            "Local path or git URL; defaults to the official aiman skill repo",
         type: "string"
      })
      .option("scope", {
         choices: skillScopeChoices,
         default: "project",
         describe: "Where to install the skill",
         type: "string"
      })
      .option("force", {
         default: false,
         describe: "Replace an existing installed skill with the same name",
         type: "boolean"
      })
      .option("path", {
         describe:
            "Skill directory inside a repo source; defaults to auto-detecting one bundled skill on main",
         type: "string"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      })
      .example(
         "$0 skill install",
         "Install the default aiman skill from the official repo's main branch"
      )
      .example(
         "$0 skill install --scope user",
         "Install the default aiman skill into ~/.agents/skills/"
      )
      .example(
         "$0 skill install ./skills/aiman",
         "Install a local skill into the current project's .agents/skills/"
      )
      .example(
         "$0 skill install https://github.com/org/repo.git",
         "Clone the repo's main branch and install the only bundled skill it contains"
      )
      .example(
         "$0 skill install https://github.com/org/repo.git --path skills/aiman",
         "Clone the repo's main branch and install one specific bundled skill"
      );
}

export async function handler(
   args: ArgumentsCamelCase<InstallSkillArguments>
): Promise<void> {
   if (args.scope !== "project" && args.scope !== "user") {
      throw new UserError(
         "Skill scope must be project or user. Provide --scope project or --scope user."
      );
   }

   const source =
      typeof args.source === "string" && args.source.trim().length > 0
         ? args.source.trim()
         : getDefaultSkillSource();

   const skill = await installSkill(getProjectPaths(), {
      ...(args.force === true ? { force: true } : {}),
      ...(typeof args.path === "string" && args.path.trim().length > 0
         ? { repositorySubpath: args.path }
         : {}),
      scope: args.scope,
      sourcePath: source
   });

   if (args.json) {
      writeJson({
         installed: true,
         skill
      });
      return;
   }

   const details = renderLabelValueBlock([
      { label: "Name", value: skill.name },
      { label: "Scope", value: skill.scope },
      { label: "Path", value: skill.path },
      { label: "List", value: `aiman skill list --scope ${skill.scope}` }
   ]);

   process.stdout.write(`${renderSection("Installed skill", details)}\n`);
}
