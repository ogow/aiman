import type { ArgumentsCamelCase, Argv } from "yargs";

import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderSection, renderTable } from "../lib/pretty.js";
import { migrateLegacyAgents } from "../lib/profiles.js";

type ProfileMigrateArguments = {
   json?: boolean;
};

export const command = "migrate";
export const describe = "Migrate legacy agent files into profiles";

export function builder(yargs: Argv): Argv {
   return yargs.option("json", {
      default: false,
      describe: "Print JSON output",
      type: "boolean"
   });
}

export async function handler(
   args: ArgumentsCamelCase<ProfileMigrateArguments>
): Promise<void> {
   const result = await migrateLegacyAgents(getProjectPaths());

   if (args.json) {
      writeJson(result);
      return;
   }

   const sections = [
      renderSection(
         "Migrated profiles",
         result.created.length === 0
            ? "No legacy agent files were found."
            : renderTable(
                 ["Name", "Scope", "Provider", "Mode", "Path"],
                 result.created.map((profile) => [
                    profile.name,
                    profile.scope,
                    profile.provider,
                    profile.mode ?? "",
                    profile.path
                 ])
              )
      )
   ];

   if (result.warnings.length > 0) {
      sections.push(
         renderSection(
            "Warnings",
            result.warnings
               .map(
                  (warning) =>
                     `- ${warning.profile}: ${warning.message} (${warning.path})`
               )
               .join("\n")
         )
      );
   }

   process.stdout.write(`${sections.join("\n\n")}\n`);
}
