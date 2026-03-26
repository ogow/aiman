import path from "node:path";
import type { Argv, ArgumentsCamelCase } from "yargs";

import type { Application } from "../../app.js";
import type { CliContext } from "../../types.js";
import {
   normalizeWriteScope,
   parsePositiveInteger,
   readStdinText,
   resolveTextInput
} from "../input.js";

function getApp(context: CliContext<Application>): Application {
   if (!context.app) {
      throw new Error("CLI application is not initialized.");
   }

   return context.app;
}

function setResponse(
   context: CliContext<Application>,
   command: string,
   result: unknown
): void {
   context.response = {
      command,
      result
   };
}

export function registerRunCommands(
   program: Argv,
   context: CliContext<Application>
): void {
   program.command(
      "run <subcommand>",
      "Manage agent runs.",
      (yargs: Argv) =>
         yargs
            .command(
               "spawn",
               "Spawn a new run from a visible agent definition.",
               (child: Argv) =>
                  child
                     .option("agent", {
                        type: "string",
                        demandOption: true,
                        describe: "Visible agent name."
                     })
                     .option("task", {
                        type: "string",
                        describe: "Inline task prompt."
                     })
                     .option("task-file", {
                        type: "string",
                        describe: "Read task prompt from a file."
                     })
                     .option("model", {
                        type: "string",
                        describe: "Override the agent model."
                     })
                     .option("reasoning-effort", {
                        type: "string",
                        describe: "Override the agent reasoning effort."
                     })
                     .option("workspace", {
                        type: "string",
                        describe: "Workspace directory for the run."
                     })
                     .option("write-scope", {
                        type: "string",
                        array: true,
                        describe:
                           "Repeatable write scope path or comma-separated list."
                     })
                     .option("timeout-ms", {
                        type: "string",
                        describe: "Optional timeout in milliseconds."
                     })
                     .option("dry-run", {
                        type: "boolean",
                        default: false,
                        describe:
                           "Resolve and record the run without spawning a process."
                     }),
               async (
                  argv: ArgumentsCamelCase<{
                     agent: string;
                     task?: string;
                     taskFile?: string;
                     model?: string;
                     reasoningEffort?: string;
                     workspace?: string;
                     writeScope?: string[];
                     timeoutMs?: string;
                     dryRun?: boolean;
                  }>
               ) => {
                  const stdinText = await readStdinText(context.io.stdin);
                  const taskPrompt = await resolveTextInput({
                     value: argv.task,
                     filePath: argv.taskFile,
                     stdinText,
                     cwd: context.cwd,
                     label: "task prompt",
                     valueFlag: "--task",
                     fileFlag: "--task-file"
                  });
                  const result = await getApp(context).actions.spawnRun({
                     agentName: argv.agent,
                     taskPrompt,
                     model: argv.model ?? null,
                     reasoningEffort: argv.reasoningEffort ?? null,
                     workspace: argv.workspace
                        ? path.resolve(context.cwd, argv.workspace)
                        : context.cwd,
                     writeScope: normalizeWriteScope(argv.writeScope),
                     timeoutMs:
                        parsePositiveInteger(argv.timeoutMs, "--timeout-ms") ??
                        null,
                     dryRun: Boolean(argv.dryRun)
                  });

                  setResponse(context, "run:spawn", result);
               }
            )
            .command(
               "list",
               "List all runs.",
               () => {},
               async () => {
                  const result = await getApp(context).actions.listRuns();
                  setResponse(context, "run:list", result);
               }
            )
            .command(
               "get <runId>",
               "Get one run by id.",
               (child: Argv) =>
                  child.positional("runId", {
                     type: "string",
                     describe: "Run id."
                  }),
               async (argv: ArgumentsCamelCase<{ runId: string }>) => {
                  const result = await getApp(context).actions.getRun({
                     runId: argv.runId
                  });
                  setResponse(context, "run:get", result);
               }
            )
            .command(
               "wait <runId>",
               "Wait until a run reaches a terminal status or timeout.",
               (child: Argv) =>
                  child
                     .positional("runId", {
                        type: "string",
                        describe: "Run id."
                     })
                     .option("timeout-ms", {
                        type: "string",
                        describe:
                           "How long to wait before returning the latest run state."
                     }),
               async (
                  argv: ArgumentsCamelCase<{
                     runId: string;
                     timeoutMs?: string;
                  }>
               ) => {
                  const result = await getApp(context).actions.waitForRun({
                     runId: argv.runId,
                     timeoutMs:
                        parsePositiveInteger(argv.timeoutMs, "--timeout-ms") ??
                        30000
                  });
                  setResponse(context, "run:wait", result);
               }
            )
            .command(
               "cancel <runId>",
               "Cancel a running run.",
               (child: Argv) =>
                  child.positional("runId", {
                     type: "string",
                     describe: "Run id."
                  }),
               async (argv: ArgumentsCamelCase<{ runId: string }>) => {
                  const result = await getApp(context).actions.cancelRun({
                     runId: argv.runId
                  });
                  setResponse(context, "run:cancel", result);
               }
            )
            .command(
               "logs <runId>",
               "Read recent log events for a run.",
               (child: Argv) =>
                  child
                     .positional("runId", {
                        type: "string",
                        describe: "Run id."
                     })
                     .option("limit", {
                        type: "string",
                        describe: "Maximum number of events to return."
                     }),
               async (
                  argv: ArgumentsCamelCase<{ runId: string; limit?: string }>
               ) => {
                  const result = await getApp(context).actions.readRunLogs({
                     runId: argv.runId,
                     limit: parsePositiveInteger(argv.limit, "--limit") ?? 200
                  });
                  setResponse(context, "run:logs", result);
               }
            )
            .demandCommand(1)
            .strictCommands(),
      () => {}
   );
}
