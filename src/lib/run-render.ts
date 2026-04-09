import chalk from "chalk";

import { renderActivityBar } from "./activity.js";
import { formatRunRights } from "../lib/provider-capabilities.js";
import {
   formatDuration,
   renderLabelValueBlock,
   renderSection,
   renderTable
} from "../lib/pretty.js";
import {
   formatCompactTimestamp,
   getRunShortLabel,
   getRunStatusLabel
} from "../tui/workbench-model.js";
import type { RunInspection } from "../lib/types.js";

function getStatusColor(run: RunInspection): (text: string) => string {
   if (run.active) {
      return chalk.yellow;
   }

   switch (run.status) {
      case "success":
         return chalk.green;
      case "error":
         return chalk.red;
      case "cancelled":
      case "running":
         return chalk.yellow;
      default:
         return chalk.dim;
   }
}

function formatRunDurationSummary(run: RunInspection): string {
   return typeof run.durationMs === "number"
      ? formatDuration(run.durationMs)
      : "n/a";
}

function renderWarning(run: RunInspection): string {
   return typeof run.warning === "string"
      ? renderSection("Warning", run.warning)
      : "";
}

function formatArg(value: string): string {
   return /\s/.test(value) ? JSON.stringify(value) : value;
}

function formatArgsSummary(args: string[]): string {
   return args.map((arg) => formatArg(arg)).join(" ");
}

function formatStringList(values: string[]): string {
   return values.join(", ");
}

function stringifyJson(value: unknown): string {
   return JSON.stringify(value, null, 2);
}

export function renderRunTable(runs: RunInspection[]): string {
   return renderTable(
      [
         chalk.bold("Status"),
         chalk.bold("Agent"),
         chalk.bold("Provider"),
         chalk.bold("Started"),
         chalk.bold("Time"),
         chalk.bold("Run ID")
      ],
      runs.map((run) => {
         const color = getStatusColor(run);
         const status = getRunStatusLabel(run, 0);

         return [
            color(status),
            chalk.cyan(getRunShortLabel(run)),
            run.provider,
            chalk.dim(formatCompactTimestamp(run.startedAt)),
            formatRunDurationSummary(run),
            chalk.dim(run.runId)
         ];
      })
   );
}

export function renderStatusView(input: {
   activityFrameIndex?: number;
   recentOutput: string;
   run: RunInspection;
}): string {
   const overviewRows = [
      { label: "Active", value: input.run.active ? "yes" : "no" },
      { label: "Recorded status", value: input.run.status },
      { label: "Run ID", value: input.run.runId },
      { label: "Agent", value: getRunShortLabel(input.run) },
      { label: "Provider", value: input.run.provider },
      { label: "Launch", value: input.run.launchMode },
      { label: "Project", value: input.run.projectRoot },
      {
         label: "Rights",
         value: formatRunRights(input.run.provider)
      },
      { label: "Cwd", value: input.run.cwd },
      { label: "Started", value: input.run.startedAt },
      {
         label: "PID",
         value: typeof input.run.pid === "number" ? String(input.run.pid) : ""
      },
      {
         label: "Ended",
         value: typeof input.run.endedAt === "string" ? input.run.endedAt : ""
      },
      {
         label: "Duration",
         value:
            typeof input.run.durationMs === "number"
               ? formatDuration(input.run.durationMs)
               : ""
      }
   ];

   if (input.run.active && typeof input.activityFrameIndex === "number") {
      overviewRows.splice(2, 0, {
         label: "Activity",
         value: `[${renderActivityBar(input.activityFrameIndex)}]`
      });
   }

   const sections = [
      renderSection("Status", renderLabelValueBlock(overviewRows))
   ];
   const warning = renderWarning(input.run);

   if (warning.length > 0) {
      sections.push(warning);
   }

   if (typeof input.run.summary === "string" && input.run.summary.length > 0) {
      sections.push(renderSection("Summary", input.run.summary));
   }

   if (input.recentOutput.length > 0) {
      sections.push(renderSection("Recent output", input.recentOutput));
   }

   sections.push(
      renderSection(
         "Next steps",
         renderLabelValueBlock([
            { label: "Logs", value: `aiman runs logs ${input.run.runId} -f` },
            { label: "Inspect", value: `aiman runs inspect ${input.run.runId}` }
         ])
      )
   );

   return `${sections.join("\n\n")}\n`;
}

export function renderInspectView(
   run: RunInspection,
   activityFrameIndex?: number
): string {
   const overviewRows = [
      { label: "Active", value: run.active ? "yes" : "no" },
      { label: "Recorded status", value: run.status },
      { label: "Run ID", value: run.runId },
      { label: "Agent", value: getRunShortLabel(run) },
      { label: "Provider", value: run.provider },
      { label: "Launch", value: run.launchMode },
      { label: "Project", value: run.projectRoot },
      {
         label: "Rights",
         value: formatRunRights(run.provider)
      },
      { label: "Cwd", value: run.cwd },
      { label: "Started", value: run.startedAt },
      {
         label: "PID",
         value: typeof run.pid === "number" ? String(run.pid) : ""
      },
      {
         label: "Ended",
         value: typeof run.endedAt === "string" ? run.endedAt : ""
      },
      {
         label: "Duration",
         value:
            typeof run.durationMs === "number"
               ? formatDuration(run.durationMs)
               : ""
      },
      {
         label: "Error",
         value: typeof run.error?.message === "string" ? run.error.message : ""
      }
   ];

   if (run.active && typeof activityFrameIndex === "number") {
      overviewRows.splice(2, 0, {
         label: "Activity",
         value: `[${renderActivityBar(activityFrameIndex)}]`
      });
   }

   const sections = [renderSection("Run", renderLabelValueBlock(overviewRows))];
   const warning = renderWarning(run);

   if (warning.length > 0) {
      sections.push(warning);
   }

   if (typeof run.summary === "string" && run.summary.length > 0) {
      sections.push(renderSection("Summary", run.summary));
   }

   if (typeof run.outcome === "string" && run.outcome.length > 0) {
      sections.push(renderSection("Outcome", run.outcome));
   }

   if (typeof run.finalText === "string" && run.finalText.length > 0) {
      sections.push(renderSection("Final text", run.finalText));
   }

   if (run.structuredResult !== undefined) {
      sections.push(
         renderSection("Structured result", stringifyJson(run.structuredResult))
      );
   }

   if (run.next !== undefined) {
      sections.push(renderSection("Next", stringifyJson(run.next)));
   }

   sections.push(
      renderSection(
         "Launch",
         renderLabelValueBlock([
            {
               label: "Agent path",
               value: run.launch.profilePath ?? run.launch.agentPath ?? ""
            },
            {
               label: "Agent digest",
               value: run.launch.profileDigest ?? run.launch.agentDigest ?? ""
            },
            { label: "Prompt digest", value: run.launch.promptDigest },
            { label: "Task", value: run.launch.task ?? "" },
            { label: "Command", value: run.launch.command },
            { label: "Args", value: formatArgsSummary(run.launch.args) },
            { label: "Prompt", value: run.launch.promptTransport },
            {
               label: `Env keys (${run.launch.envKeys.length})`,
               value: run.launch.envKeys.join(", ")
            },
            { label: "Cwd", value: run.launch.cwd },
            {
               label: "Rights",
               value: formatRunRights(run.launch.provider)
            },
            { label: "Timeout", value: formatDuration(run.launch.timeoutMs) },
            {
               label: "Kill grace",
               value: formatDuration(run.launch.killGraceMs)
            },
            {
               label: `Capabilities (${run.launch.capabilities?.length ?? 0})`,
               value: formatStringList(run.launch.capabilities ?? [])
            },
            {
               label: `Context files (${run.launch.contextFiles?.length ?? 0})`,
               value: formatStringList(run.launch.contextFiles ?? [])
            }
         ])
      )
   );

   sections.push(
      renderSection(
         "Files",
        renderLabelValueBlock([
            { label: "Run", value: run.paths.runFile },
            { label: "Stdout", value: run.paths.stdoutLog },
            { label: "Stderr", value: run.paths.stderrLog },
            { label: "Artifacts", value: run.paths.artifactsDir }
         ])
      )
   );

   if (run.artifacts.length > 0) {
      sections.push(
         renderSection(
            "Artifacts",
            renderTable(
               ["Kind", "ID", "Path", "Exists", "Summary"],
               run.artifacts.map((artifact) => [
                  artifact.kind ?? "",
                  artifact.id ?? "",
                  artifact.path,
                  artifact.exists === true ? "yes" : "no",
                  artifact.summary ?? ""
               ])
            )
         )
      );
   }

   sections.push(
      renderSection(
         "Next steps",
         renderLabelValueBlock([
            { label: "Show", value: `aiman runs show ${run.runId}` },
            { label: "Logs", value: `aiman runs logs ${run.runId} -f` },
            {
               label: "Result file",
               value: `aiman runs inspect ${run.runId} --stream run`
            },
            {
               label: "Prompt",
               value: `aiman runs inspect ${run.runId} --stream prompt`
            }
         ])
      )
   );

   return `${sections.join("\n\n")}\n`;
}
