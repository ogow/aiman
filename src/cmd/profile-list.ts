import type { ArgumentsCamelCase, Argv } from "yargs";

import { profileScopeChoices } from "../lib/profiles.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderSection, renderTable } from "../lib/pretty.js";
import { listProfiles } from "../lib/profiles.js";
import type { ProfileScope } from "../lib/types.js";

type ProfileListArguments = {
   json?: boolean;
   scope?: ProfileScope;
};

export const command = "list";
export const describe = "List available profiles";

export function builder(yargs: Argv): Argv {
   return yargs
      .option("scope", {
         choices: profileScopeChoices,
         describe: "Resolve profiles from one scope only",
         type: "string"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<ProfileListArguments>
): Promise<void> {
   const profiles = await listProfiles(getProjectPaths(), args.scope);

   if (args.json) {
      writeJson({ profiles });
      return;
   }

   if (profiles.length === 0) {
      process.stdout.write("No profiles found.\n");
      return;
   }

   process.stdout.write(
      `${renderSection(
         "Profiles",
         renderTable(
            ["Name", "Scope", "Provider", "Mode", "Description"],
            profiles.map((profile) => [
               profile.name,
               profile.isBuiltIn === true ? "builtin" : profile.scope,
               profile.provider,
               profile.mode ?? profile.permissions ?? "",
               profile.description
            ])
         )
      )}\n`
   );
}
