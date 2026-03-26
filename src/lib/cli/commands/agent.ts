import type { Argv, ArgumentsCamelCase } from "yargs";

import type { Application } from "../../app.js";
import type { CliContext } from "../../types.js";
import { readStdinText, resolveTextInput } from "../input.js";

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

export function registerAgentCommands(
  program: Argv,
  context: CliContext<Application>
): void {
  program.command(
    "agent <subcommand>",
    "Manage reusable agents.",
    (yargs: Argv) =>
      yargs
        .command(
          "list",
          "List visible agents from the merged home and project registries.",
          () => {},
          async () => {
            const result = await getApp(context).actions.listAgents();
            setResponse(context, "agent:list", result);
          }
        )
        .command(
          "get <name>",
          "Get one visible agent by name.",
          (child: Argv) =>
            child.positional("name", {
              type: "string",
              describe: "Visible agent name."
            }),
          async (argv: ArgumentsCamelCase<{ name: string }>) => {
            const result = await getApp(context).actions.getAgent({
              name: argv.name
            });
            setResponse(context, "agent:get", result);
          }
        )
        .command(
          "create",
          "Create a reusable agent in the home or project registry.",
          (child: Argv) =>
            child
              .option("name", {
                type: "string",
                demandOption: true,
                describe: "Agent name."
              })
              .option("provider", {
                type: "string",
                demandOption: true,
                describe: "Provider name."
              })
              .option("description", {
                type: "string",
                describe: "Optional agent description."
              })
              .option("model", {
                type: "string",
                describe: "Optional provider model."
              })
              .option("reasoning-effort", {
                type: "string",
                describe: "Optional provider-specific reasoning effort."
              })
              .option("scope", {
                type: "string",
                choices: ["home", "project"],
                default: "project",
                describe: "Where to store the agent."
              })
              .option("prompt", {
                type: "string",
                describe: "Inline prompt body."
              })
              .option("prompt-file", {
                type: "string",
                describe: "Read prompt body from a file."
              }),
          async (
            argv: ArgumentsCamelCase<{
              name: string;
              provider: string;
              description?: string;
              model?: string;
              reasoningEffort?: string;
              scope: "home" | "project";
              prompt?: string;
              promptFile?: string;
            }>
          ) => {
            const stdinText = await readStdinText(context.io.stdin);
            const prompt = await resolveTextInput({
              value: argv.prompt,
              filePath: argv.promptFile,
              stdinText,
              cwd: context.cwd,
              label: "prompt",
              valueFlag: "--prompt",
              fileFlag: "--prompt-file"
            });
            const agent = await getApp(context).actions.createAgent({
              name: argv.name,
              provider: argv.provider,
              description: argv.description ?? "",
              model: argv.model ?? "",
              reasoningEffort: argv.reasoningEffort ?? "",
              scope: argv.scope,
              prompt
            });

            setResponse(context, "agent:create", { agent });
          }
        )
        .demandCommand(1)
        .strictCommands(),
    () => {}
  );
}
