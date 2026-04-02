import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import {
   getProviderCapabilities,
   summarizeProviderModes
} from "../lib/provider-capabilities.js";
import {
   loadProfileDefinition,
   profileScopeChoices
} from "../lib/profiles.js";
import type { ProfileScope } from "../lib/types.js";

type ProfileShowArguments = {
   json?: boolean;
   profile?: string;
   scope?: ProfileScope;
};

export const command = "show <profile>";
export const describe = "Show one profile";

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
   args: ArgumentsCamelCase<ProfileShowArguments>
): Promise<void> {
   if (typeof args.profile !== "string" || args.profile.trim().length === 0) {
      throw new UserError("Profile name is required.");
   }

   const profile = await loadProfileDefinition(
      getProjectPaths(),
      args.profile,
      args.scope
   );
   const capabilities = getProviderCapabilities(profile.provider);

   if (args.json) {
      writeJson({ capabilities, profile });
      return;
   }

   process.stdout.write(
      `${renderSection(
         "Profile",
         renderLabelValueBlock([
            { label: "Name", value: profile.name },
            {
               label: "Scope",
               value: profile.isBuiltIn === true ? "builtin" : profile.scope
            },
            { label: "Provider", value: profile.provider },
            { label: "Mode", value: profile.mode ?? profile.permissions ?? "" },
            { label: "Run modes", value: summarizeProviderModes(profile.provider) },
            { label: "Model", value: profile.model },
            { label: "Skills", value: profile.skills?.join(", ") ?? "" },
            { label: "Description", value: profile.description },
            { label: "Path", value: profile.path }
         ])
      )}\n\n${renderSection(
         "Rights",
         renderLabelValueBlock([
            ...capabilities.modes.map((capability) => ({
               label: capability.mode,
               value: capability.details
            })),
            {
               label: "Environment",
               value: capabilities.environmentSummary
            }
         ])
      )}\n\n${renderSection("Prompt", profile.body)}\n`
   );
}
