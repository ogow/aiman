import yargs from "yargs";
import type { Argv } from "yargs";

import { createApplication, type Application } from "../app.js";
import { ValidationError } from "../errors.js";
import type { CliContext, CliIO } from "../types.js";
import { registerAgentCommands } from "./commands/agent.js";
import { registerRunCommands } from "./commands/run.js";
import { getExitCode, renderError, renderResponse } from "./output.js";

function createProgram(argv: string[], context: CliContext<Application>): Argv {
   const program = yargs(argv)
      .scriptName("aiman")
      .strict()
      .exitProcess(false)
      .help()
      .example("$0 agent list", "List visible agents.")
      .example("$0 agent get reviewer", "Inspect one agent.")
      .example(
         '$0 agent create --name reviewer --provider codex --prompt "Review the diff."',
         "Create an agent."
      )
      .example(
         '$0 run spawn --agent reviewer --task "Review the current changes."',
         "Start a run."
      )
      .example("$0 run wait <run-id>", "Wait for a run to finish.")
      .example("$0 run logs <run-id>", "Read recent run logs.")
      .option("json", {
         type: "boolean",
         default: false,
         global: true,
         describe: "Render machine-readable JSON output."
      })
      .fail((message: string | undefined, error: Error | undefined) => {
         if (error) {
            throw error;
         }

         throw new ValidationError(message || "Invalid command.");
      });

   registerAgentCommands(program, context);
   registerRunCommands(program, context);

   return program;
}

export async function main(
   argv: string[] = process.argv.slice(2),
   io: CliIO = {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr
   }
): Promise<number> {
   const context: CliContext<Application> = {
      io,
      cwd: process.cwd(),
      response: null,
      app: null
   };
   const json = argv.includes("--json");
   const app = await createApplication({ rootDir: context.cwd });
   context.app = app;

   try {
      const program = createProgram(argv, context);

      if (argv.length === 0 || (argv.length === 1 && argv[0] === "help")) {
         program.showHelp();
         io.stdout.write("\n");
         return 0;
      }

      const parsed = await program.parseAsync();

      if (!context.response) {
         if (!parsed.help) {
            program.showHelp();
            io.stdout.write("\n");
         }

         return 0;
      }

      renderResponse(io, {
         json: Boolean(parsed.json),
         command: context.response.command,
         result: context.response.result
      });

      return 0;
   } catch (error) {
      renderError(io, {
         json,
         error
      });
      return getExitCode(error);
   }
}
