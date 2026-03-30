import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { writeJson } from "../lib/output.js";
import { readRunDetails, readRunLog } from "../lib/runs.js";
import type { RunInspection } from "../lib/types.js";

type InspectArguments = {
   json?: boolean;
   runId?: string;
   stream?: "prompt" | "run" | "stderr" | "stdout";
};

export const command = "inspect <runId>";
export const describe = "Inspect one persisted run";

export function builder(yargs: Argv): Argv {
   return yargs
      .positional("runId", {
         describe: "Run id",
         type: "string"
      })
      .option("stream", {
         choices: ["run", "prompt", "stdout", "stderr"] as const,
         describe: "Show one log stream instead of the run record"
      })
      .option("json", {
         default: false,
         describe: "Print JSON output",
         type: "boolean"
      });
}

export async function handler(
   args: ArgumentsCamelCase<InspectArguments>
): Promise<void> {
   if (typeof args.runId !== "string" || args.runId.length === 0) {
      throw new UserError("Run id is required.");
   }

   if (args.stream) {
      const content = await readRunLog(args.runId, args.stream);

      if (args.json) {
         writeJson({
            content,
            runId: args.runId,
            stream: args.stream
         });
         return;
      }

      process.stdout.write(content);
      return;
   }

   const run = await readRunDetails(args.runId);

   if (args.json) {
      writeJson(run);
      return;
   }

   process.stdout.write(renderRunSummary(run));
}

function renderRunSummary(run: RunInspection): string {
   const lines = [
      `runId: ${run.runId}`,
      `status: ${run.status}`,
      `agent: ${run.agent}`,
      `agentScope: ${run.agentScope}`,
      `agentPath: ${run.agentPath}`,
      `provider: ${run.provider}`,
      `mode: ${run.mode}`,
      `cwd: ${run.cwd}`,
      `startedAt: ${run.startedAt}`
   ];

   if ("endedAt" in run && typeof run.endedAt === "string") {
      lines.push(`endedAt: ${run.endedAt}`);
   }

   if ("durationMs" in run && typeof run.durationMs === "number") {
      lines.push(`durationMs: ${run.durationMs}`);
   }

   if ("errorMessage" in run && typeof run.errorMessage === "string") {
      lines.push(`error: ${run.errorMessage}`);
   }

   if ("finalText" in run && typeof run.finalText === "string") {
      lines.push(
         "",
         "finalText:",
         run.finalText.length > 0 ? run.finalText : ""
      );
   }

   lines.push(
      "",
      "files:",
      `run: ${run.paths.runFile}`,
      `prompt: ${run.paths.promptFile}`
   );

   if (run.paths.stdoutLog) {
      lines.push(`stdout: ${run.paths.stdoutLog}`);
   }

   if (run.paths.stderrLog) {
      lines.push(`stderr: ${run.paths.stderrLog}`);
   }

   if (run.paths.artifactsDir && run.document.artifacts.length > 0) {
      lines.push(`artifacts: ${run.paths.artifactsDir}`);
   }

   if (run.document.frontmatter) {
      const kind = run.document.frontmatter.kind;
      const summary = run.document.frontmatter.summary;

      if (typeof kind === "string") {
         lines.push(`kind: ${kind}`);
      }

      if (typeof summary === "string") {
         lines.push(`summary: ${summary}`);
      }
   }

   lines.push(
      "",
      `Use "aiman inspect ${run.runId} --stream run" to read the canonical run file.`,
      `Use "aiman inspect ${run.runId} --stream prompt" to see the exact prompt.`,
      `Use "aiman inspect ${run.runId} --stream stdout" or "--stream stderr" for logs.`
   );

   return `${lines.join("\n")}\n`;
}
