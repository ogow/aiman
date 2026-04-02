import type { ArgumentsCamelCase, Argv } from "yargs";

import * as inspectCommand from "./inspect.js";
import * as logsCommand from "./logs.js";
import * as listCommand from "./ps.js";
import * as showCommand from "./status.js";
import * as stopCommand from "./stop-agent.js";
import { agentScopeChoices } from "../lib/agents.js";
import { createActivityRenderer } from "../lib/activity.js";
import { writeJson } from "../lib/output.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import { formatRunRights } from "../lib/provider-capabilities.js";
import { launchRun, runAgent } from "../lib/runs.js";
import { readTaskInput } from "../lib/task-input.js";
import type {
   AgentScope,
   ProviderId,
   RunMode,
   RunResult
} from "../lib/types.js";

type RunArguments = {
   all?: boolean;
   cwd?: string;
   detach?: boolean;
   extra?: string;
   follow?: boolean;
   json?: boolean;
   limit?: number;
   profile?: string;
   skill?: string[];
   scope?: AgentScope;
    stream?: "all" | "prompt" | "run" | "stderr" | "stdout";
   task?: string;
   tail?: number;
};

export const command = "run <profile> [extra]";
export const describe = "Run one profile";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("profile", {
         describe: "Profile name",
         type: "string"
      })
      .positional("extra", {
         describe: "Run id for run subcommands",
         type: "string"
      })
      .option("task", {
         describe: "Task text; use stdin for larger input",
         type: "string"
      })
      .option("cwd", {
         describe: "Working directory for the downstream provider",
         type: "string"
      })
      .option("scope", {
         choices: agentScopeChoices,
         describe: "Resolve the profile from one scope only",
         type: "string"
      })
      .option("skill", {
         array: true,
         describe: "Activate one or more local aiman skills for this run",
         type: "string"
      })
      .option("detach", {
         default: false,
         describe: "Launch in the background and return immediately",
         type: "boolean"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      })
      .option("all", {
         default: false,
         describe: "Include recent finished runs",
         type: "boolean"
      })
      .option("limit", {
         default: 20,
         describe: "Maximum number of runs to show",
         type: "number"
      })
      .option("follow", {
         alias: "f",
         default: false,
         describe: "Follow new output until the run finishes",
         type: "boolean"
      })
      .option("tail", {
         default: 40,
         describe: "How many lines to show from the end",
         type: "number"
      })
      .option("stream", {
         choices: ["all", "prompt", "run", "stderr", "stdout"] as const,
         describe: "Which persisted stream or file to show"
      })
      .example(
         '$0 run build --task "Fix the failing tests"',
         "Run in the foreground and return the final result"
      )
      .example(
         '$0 run plan --task "Review this patch" --detach',
         "Launch a detached run"
      );
}

function renderLaunchSummary(input: {
   profile: string;
   inspectCommand: string;
   logsCommand: string;
   mode: RunMode;
   pid?: number;
   provider: ProviderId;
   runId: string;
   showCommand: string;
   scope: string;
}): string {
   return renderSection(
      "Run started",
      renderLabelValueBlock([
         { label: "Profile", value: input.profile },
         { label: "Scope", value: input.scope },
         { label: "Launch", value: "detached" },
         { label: "Provider", value: input.provider },
         { label: "Mode", value: input.mode },
         {
            label: "Rights",
            value: formatRunRights(input.provider, input.mode)
         },
         { label: "Run ID", value: input.runId },
         {
            label: "PID",
            value: typeof input.pid === "number" ? String(input.pid) : ""
         },
         { label: "Show", value: input.showCommand },
         { label: "Logs", value: input.logsCommand },
         { label: "Inspect", value: input.inspectCommand }
      ])
   );
}

function renderForegroundFailure(result: RunResult): string {
   return renderSection(
      "Run failed",
      renderLabelValueBlock([
         { label: "Run ID", value: result.runId },
         { label: "Status", value: result.status },
         { label: "Profile", value: result.profile ?? result.agent ?? "" },
         { label: "Provider", value: result.provider },
         { label: "Launch", value: result.launchMode ?? "foreground" },
         {
            label: "Rights",
            value:
               typeof result.mode === "string"
                  ? formatRunRights(result.provider, result.mode)
                  : ""
         },
         { label: "Error", value: result.errorMessage ?? "Unknown failure" },
         { label: "Logs", value: `aiman run logs ${result.runId} -f` },
         { label: "Inspect", value: `aiman run inspect ${result.runId}` }
      ])
   );
}

export async function handler(
   args: ArgumentsCamelCase<RunArguments>
): Promise<void> {
   switch (args.profile) {
      case "list":
         await listCommand.handler(args as ArgumentsCamelCase<{
            all?: boolean;
            json?: boolean;
            limit?: number;
         }>);
         return;
      case "show":
         await showCommand.handler(
            {
               ...args,
               runId: args.extra
            } as ArgumentsCamelCase<{
               json?: boolean;
               runId?: string;
            }>
         );
         return;
      case "logs":
         await logsCommand.handler(
            {
               ...args,
               runId: args.extra
            } as ArgumentsCamelCase<{
               follow?: boolean;
               json?: boolean;
               runId?: string;
               stream?: "all" | "stderr" | "stdout";
               tail?: number;
            }>
         );
         return;
      case "inspect":
         await inspectCommand.handler(
            {
               ...args,
               runId: args.extra
            } as ArgumentsCamelCase<{
               json?: boolean;
               runId?: string;
               stream?: "prompt" | "run" | "stderr" | "stdout";
            }>
         );
         return;
      case "stop":
         await stopCommand.handler(
            {
               ...args,
               id: args.extra
            } as ArgumentsCamelCase<{
               id?: string;
               json?: boolean;
            }>
         );
         return;
      default:
         break;
   }

   const task = await readTaskInput(args.task);
   const runInput = {
      profileName: args.profile ?? "",
      ...(typeof args.cwd === "string" && args.cwd.length > 0
         ? { cwd: args.cwd }
         : {}),
      ...(args.scope !== undefined ? { profileScope: args.scope } : {}),
      ...(Array.isArray(args.skill) && args.skill.length > 0
         ? { selectedSkillNames: args.skill }
         : {}),
      task
   };

   if (args.detach === true) {
      const launched = await launchRun(runInput);

      if (args.json) {
         writeJson(launched);
         return;
      }

      process.stderr.write(
         `${renderLaunchSummary({
            profile: launched.profile ?? launched.agent ?? "",
            inspectCommand: launched.inspectCommand,
            logsCommand: launched.logsCommand,
            mode: launched.mode,
            ...(typeof launched.pid === "number" ? { pid: launched.pid } : {}),
            provider: launched.provider,
            runId: launched.runId,
            showCommand: launched.showCommand,
            scope: launched.profileScope ?? launched.agentScope ?? ""
         })}\n\n`
      );
      return;
   }

   let stopActivity: (() => void) | undefined;
   const result = await runAgent({
      ...runInput,
      onRunStarted: (started) => {
         if (!args.json && process.stderr.isTTY) {
            const activity = createActivityRenderer({
               agent: started.profile,
               runId: started.runId,
               startedAt: started.startedAt
            });
            activity.start();
            stopActivity = () => {
               activity.stop();
            };
         }
      }
   }).finally(() => {
      stopActivity?.();
   });

   if (args.json) {
      process.exitCode = result.status === "success" ? 0 : 1;
      writeJson(result);
      return;
   }

   process.exitCode = result.status === "success" ? 0 : 1;
   if (result.status === "success" && result.finalText.trim().length > 0) {
      process.stdout.write(`${result.finalText.trimEnd()}\n`);
      return;
   }

   if (result.status === "success") {
      return;
   }

   process.stdout.write(`${renderForegroundFailure(result)}\n`);
}
