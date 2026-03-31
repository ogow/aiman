import type { ArgumentsCamelCase, Argv } from "yargs";

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
   agent?: string;
   cwd?: string;
   detach?: boolean;
   json?: boolean;
   mode?: "read-only" | "workspace-write";
   scope?: AgentScope;
   task?: string;
};

export const command = "run <agent>";
export const describe = "Run one specialist agent";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("agent", {
         describe: "Agent name",
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
         describe: "Resolve the agent from one scope only",
         type: "string"
      })
      .option("mode", {
         choices: ["read-only", "workspace-write"] as const,
         describe:
            "Override the execution mode; must match the agent file's declared permissions"
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
      .example(
         '$0 run reviewer --task "Review this patch"',
         "Run in the foreground and return the final result"
      )
      .example(
         '$0 run reviewer --task "Review this patch" --detach',
         "Launch a detached run"
      );
}

function renderLaunchSummary(input: {
   agent: string;
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
         { label: "Agent", value: input.agent },
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
         { label: "Agent", value: result.agent },
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
         { label: "Logs", value: `aiman sesh logs ${result.runId} -f` },
         { label: "Inspect", value: `aiman sesh inspect ${result.runId}` }
      ])
   );
}

export async function handler(
   args: ArgumentsCamelCase<RunArguments>
): Promise<void> {
   const task = await readTaskInput(args.task);
   const runInput = {
      agentName: args.agent ?? "",
      ...(args.scope !== undefined ? { agentScope: args.scope } : {}),
      ...(typeof args.cwd === "string" && args.cwd.length > 0
         ? { cwd: args.cwd }
         : {}),
      ...(args.mode !== undefined ? { mode: args.mode } : {}),
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
            agent: launched.agent,
            inspectCommand: launched.inspectCommand,
            logsCommand: launched.logsCommand,
            mode: launched.mode,
            ...(typeof launched.pid === "number" ? { pid: launched.pid } : {}),
            provider: launched.provider,
            runId: launched.runId,
            showCommand: launched.showCommand,
            scope: launched.agentScope,
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
               agent: started.agent,
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
