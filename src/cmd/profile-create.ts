import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { getProjectPaths } from "../lib/paths.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import {
   createProfileFile,
   profileScopeChoices
} from "../lib/profiles.js";
import type { ProfileScope, ProviderId, RunMode } from "../lib/types.js";

type ProfileCreateArguments = {
   description?: string;
   force?: boolean;
   instructions?: string;
   json?: boolean;
   mode?: RunMode;
   model?: string;
   name?: string;
   provider?: ProviderId;
   scope?: ProfileScope;
};

const providerChoices = ["codex", "gemini"] as const;
const modeChoices = ["safe", "yolo"] as const;

export const command = "create <name>";
export const describe = "Create a profile";

function toBuffer(value: Buffer | string): Buffer {
   return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

async function readInstructionsFromStdin(): Promise<string> {
   if (process.stdin.isTTY) {
      return "";
   }

   const chunks: Buffer[] = [];

   for await (const chunk of process.stdin) {
      chunks.push(toBuffer(chunk));
   }

   return Buffer.concat(chunks).toString("utf8").trim();
}

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("name", {
         describe: "Profile name",
         type: "string"
      })
      .option("scope", {
         choices: profileScopeChoices,
         demandOption: true,
         describe: "Where to create the profile",
         type: "string"
      })
      .option("provider", {
         choices: providerChoices,
         demandOption: true,
         describe: "Provider backend for this profile",
         type: "string"
      })
      .option("mode", {
         choices: modeChoices,
         demandOption: true,
         describe: "Default mode for this profile",
         type: "string"
      })
      .option("description", {
         demandOption: true,
         describe: "Short description for listings",
         type: "string"
      })
      .option("instructions", {
         describe: "Profile instructions; use stdin for multiline input",
         type: "string"
      })
      .option("model", {
         demandOption: true,
         describe: "Model for this profile",
         type: "string"
      })
      .option("force", {
         default: false,
         describe: "Overwrite the target file in the selected scope",
         type: "boolean"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<ProfileCreateArguments>
): Promise<void> {
   if (typeof args.name !== "string" || args.name.trim().length === 0) {
      throw new UserError("Profile name is required.");
   }

   const optionInstructions =
      typeof args.instructions === "string" ? args.instructions.trim() : "";
   const stdinInstructions = await readInstructionsFromStdin();

   if (optionInstructions.length > 0 && stdinInstructions.length > 0) {
      throw new UserError(
         "Provide profile instructions with --instructions or stdin, not both."
      );
   }

   const instructions =
      optionInstructions.length > 0 ? optionInstructions : stdinInstructions;

   if (instructions.length === 0) {
      throw new UserError(
         "Profile instructions are required. Provide them with --instructions or stdin."
      );
   }

   const profile = await createProfileFile(getProjectPaths(), {
      description: args.description ?? "",
      ...(args.force === true ? { force: true } : {}),
      instructions,
      model: args.model ?? "",
      mode: args.mode ?? "safe",
      name: args.name,
      provider: args.provider ?? "codex",
      scope: args.scope ?? "project"
   });

   if (args.json) {
      writeJson({ created: true, path: profile.path, profile });
      return;
   }

   process.stdout.write(
      `${renderSection(
         "Created profile",
         renderLabelValueBlock([
            { label: "Name", value: profile.name },
            { label: "Scope", value: profile.scope },
            { label: "Provider", value: profile.provider },
            { label: "Mode", value: profile.mode ?? "" },
            { label: "Model", value: profile.model },
            { label: "Path", value: profile.path }
         ])
      )}\n`
   );
}
