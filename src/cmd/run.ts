import type { ArgumentsCamelCase, Argv } from "yargs";

import { createAiman } from "../api/index.js";
import { createActivityRenderer } from "../lib/activity.js";
import { writeJson } from "../lib/output.js";
import { renderLabelValueBlock, renderSection } from "../lib/pretty.js";
import { formatRunRights } from "../lib/provider-capabilities.js";
import { agentScopeChoices } from "../lib/agents.js";
import { readTaskInput } from "../lib/task-input.js";
import type { ProviderId, ProfileScope, RunResult } from "../lib/types.js";

type RunArguments = {
   agent?: string;
   cwd?: string;
   detach?: boolean;
   json?: boolean;
   scope?: ProfileScope;
   task?: string;
};

export const command = "run <agent>";
export const describe = "Run one agent";

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
         '$0 run build --task "Fix the failing tests"',
         "Run in the foreground and return the final result"
      )
      .example(
         '$0 run plan --task "Review this patch" --detach',
         "Launch a detached run"
      );
}

function renderLaunchSummary(input: {
   agent: string;
   pid?: number;
   provider: ProviderId;
   runId: string;
   scope: string;
}): string {
   return renderSection(
      "Run started",
      renderLabelValueBlock([
         { label: "Agent", value: input.agent },
         { label: "Scope", value: input.scope },
         { label: "Launch", value: "detached" },
         { label: "Provider", value: input.provider },
         {
            label: "Rights",
            value: formatRunRights(input.provider)
         },
         { label: "Run ID", value: input.runId },
         {
            label: "PID",
            value: typeof input.pid === "number" ? String(input.pid) : ""
         },
         { label: "Show", value: `aiman runs show ${input.runId}` },
         { label: "Logs", value: `aiman runs logs ${input.runId} -f` },
         { label: "Inspect", value: `aiman runs inspect ${input.runId}` }
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
         { label: "Launch", value: result.launchMode },
         {
            label: "Rights",
            value: formatRunRights(result.provider)
         },
         { label: "Error", value: result.error?.message ?? "Unknown failure" },
         { label: "Logs", value: `aiman runs logs ${result.runId} -f` },
         { label: "Inspect", value: `aiman runs inspect ${result.runId}` }
      ])
   );
}

export async function handler(
   args: ArgumentsCamelCase<RunArguments>
): Promise<void> {
   const task = await readTaskInput(args.task);
   const runInput = {
      profileName: args.agent ?? "",
      ...(typeof args.cwd === "string" && args.cwd.length > 0
         ? { cwd: args.cwd }
         : {}),
      ...(args.scope !== undefined ? { profileScope: args.scope } : {}),
      task
   };

   if (args.detach === true) {
      const launched = await (
         await createAiman()
      ).runs.launch(runInput.profileName, runInput);

      if (args.json) {
         writeJson(launched);
         return;
      }

      process.stderr.write(
         `${renderLaunchSummary({
            agent: launched.agent,
            ...(typeof launched.pid === "number" ? { pid: launched.pid } : {}),
            provider: launched.provider,
            runId: launched.runId,
            scope: launched.agentScope
         })}\n\n`
      );
      return;
   }

   let stopActivity: (() => void) | undefined;
   const result = await (
      await createAiman()
   ).runs
      .run(runInput.profileName, {
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
      })
      .finally(() => {
         stopActivity?.();
      });

   if (args.json) {
      process.exitCode = result.status === "success" ? 0 : 1;
      writeJson(result);
      return;
   }

   process.exitCode = result.status === "success" ? 0 : 1;
   if (result.status === "success" && typeof result.summary === "string") {
      process.stdout.write(`${result.summary.trimEnd()}\n`);
      return;
   }

   if (result.status === "success") {
      return;
   }

   process.stdout.write(`${renderForegroundFailure(result)}\n`);
}
