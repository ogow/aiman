import type { ArgumentsCamelCase, Argv } from "yargs";

import { agentScopeChoices } from "../lib/agents.js";
import { runAgent } from "../lib/runs.js";
import { readTaskInput } from "../lib/task-input.js";
import { writeJson } from "../lib/output.js";
import type { AgentScope } from "../lib/types.js";

type RunArguments = {
   agent?: string;
   cwd?: string;
   json?: boolean;
   mode?: "read-only" | "workspace-write";
   scope?: AgentScope;
   task?: string;
};

export const command = "run <agent>";
export const describe = "Execute an authored agent";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("agent", {
         describe: "Agent name",
         type: "string"
      })
      .option("task", {
         describe: "Task text",
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
         default: "read-only",
         describe: "Execution mode"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<RunArguments>
): Promise<void> {
   const task = await readTaskInput(args.task);
   const result = await runAgent({
      agentName: args.agent ?? "",
      mode: args.mode ?? "read-only",
      ...(args.scope !== undefined ? { agentScope: args.scope } : {}),
      task,
      ...(typeof args.cwd === "string" && args.cwd.length > 0
         ? { cwd: args.cwd }
         : {})
   });
   process.exitCode = result.status === "success" ? 0 : 1;

   if (args.json) {
      writeJson(result);
      return;
   }

   if (result.finalText.length > 0) {
      process.stdout.write(`${result.finalText}\n\n`);
   }

   process.stdout.write(`runId: ${result.runId}\n`);
   if (result.agentScope) {
      process.stdout.write(`agentScope: ${result.agentScope}\n`);
   }
   if (result.agentPath) {
      process.stdout.write(`agentPath: ${result.agentPath}\n`);
   }
   process.stdout.write(`status: ${result.status}\n`);
   process.stdout.write(`inspect: aiman inspect ${result.runId}\n`);
   process.stdout.write(`run: aiman inspect ${result.runId} --stream run\n`);
   process.stdout.write(
      `prompt: aiman inspect ${result.runId} --stream prompt\n`
   );
}
