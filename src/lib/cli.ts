import { readFile } from "node:fs/promises";

import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { openAimanApp } from "../cmd/app.js";
import { commands } from "../cmd/index.js";

async function readPackageVersion(): Promise<string> {
   const packageJsonUrl = new URL("../../package.json", import.meta.url);
   const packageJsonRaw = await readFile(packageJsonUrl, "utf8");
   const packageJson = JSON.parse(packageJsonRaw) as { version?: unknown };

   if (
      typeof packageJson.version !== "string" ||
      packageJson.version.length === 0
   ) {
      throw new Error("package.json version is missing.");
   }

   return packageJson.version;
}

export async function runCli(argv = hideBin(process.argv)): Promise<number> {
   const version = await readPackageVersion();

   const cli = yargs(argv)
      .scriptName("aiman")
      .usage("$0 [command]")
      .command(commands)
      .strict()
      .help()
      .alias("h", "help")
      .version(version)
      .alias("v", "version")
      .recommendCommands()
      .exitProcess(false)
      .fail((message, error) => {
         if (error) {
            throw error;
         }

         throw new Error(message);
      });

   try {
      process.exitCode = 0;

      if (argv.length === 0) {
         await openAimanApp();
         return process.exitCode ?? 0;
      }

      await cli.parseAsync();
      return process.exitCode ?? 0;
   } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      return 1;
   }
}
