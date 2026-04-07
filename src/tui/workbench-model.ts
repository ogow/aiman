import { basename } from "node:path";

import { formatProfileModel } from "../lib/agents.js";
import { formatDuration, renderLabelValueBlock } from "../lib/pretty.js";
import { formatRunRights } from "../lib/provider-capabilities.js";
import type {
   ProfileScope,
   ProjectContext,
   RunInspection,
   ScopedProfileDefinition
} from "../lib/types.js";

export type Workspace = "start" | "agents" | "tasks" | "runs";

export type FocusRegion =
   | "startPane"
   | "detailPane"
   | "detailTabs"
   | "profileList"
   | "runFilter"
   | "runList"
   | "taskEditor";

export type RunDetailTab = "answer" | "logs" | "prompt" | "summary";

export type NoticeTone = "error" | "info" | "success";

export type AppNotice = {
   text: string;
   tone: NoticeTone;
};

export const workspaceTabOptions = [
   {
      description: "Start page.",
      name: "Start",
      value: "start"
   },
   {
      description: "View available agents.",
      name: "Agents",
      value: "agents"
   },
   {
      description: "Choose an agent and start a task.",
      name: "Tasks",
      value: "tasks"
   },
   {
      description: "Monitor live and recorded runs.",
      name: "Runs",
      value: "runs"
   }
] as const;

export const detailTabOptions = [
   {
      description: "Run summary and launch details.",
      name: "Summary",
      value: "summary"
   },
   {
      description: "Final answer when available.",
      name: "Answer",
      value: "answer"
   },
   {
      description: "Recent stdout and stderr output.",
      name: "Logs",
      value: "logs"
   },
   {
      description: "Resolved prompt for this run.",
      name: "Prompt",
      value: "prompt"
   }
] as const;

export const startFocusOrder: FocusRegion[] = ["startPane"];
export const agentsFocusOrder: FocusRegion[] = ["profileList", "detailPane"];
export const tasksFocusOrder: FocusRegion[] = ["profileList", "taskEditor"];
export const runsFocusOrder: FocusRegion[] = [
   "runList",
   "detailTabs",
   "detailPane"
];

const runningStatusFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export const runStatusAnimationFrameCount = runningStatusFrames.length;

function formatScope(scope: ProfileScope): string {
   return scope === "project" ? "project" : "user";
}

function formatTimestamp(value: string | undefined): string {
   if (typeof value !== "string" || value.length === 0) {
      return "n/a";
   }

   const date = new Date(value);

   if (Number.isNaN(date.getTime())) {
      return value;
   }

   return date.toISOString().replace("T", " ").replace(".000Z", "Z");
}

function padNumber(value: number): string {
   return String(value).padStart(2, "0");
}

export function formatCompactTimestamp(value: string | undefined): string {
   if (typeof value !== "string" || value.length === 0) {
      return "n/a";
   }

   const date = new Date(value);

   if (Number.isNaN(date.getTime())) {
      return value;
   }

   // Compact: "Apr 04 12:34"
   const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec"
   ];
   return `${months[date.getUTCMonth()]} ${padNumber(date.getUTCDate())} ${padNumber(date.getUTCHours())}:${padNumber(date.getUTCMinutes())}`;
}

export function getRunDisplayStatus(run: RunInspection): string {
   if (run.active) {
      return "running";
   }

   if (run.status === "running") {
      return "stale";
   }

   if (run.status === "error") {
      return "failed";
   }

   if (run.status === "cancelled") {
      return "stopped";
   }

   return run.status;
}

export function getRunStatusLabel(
   run: RunInspection,
   animationFrame: number
): string {
   if (run.active) {
      return `${runningStatusFrames[animationFrame % runningStatusFrames.length]!} running`;
   }

   switch (run.status) {
      case "success":
         return "✔ success";
      case "error":
         return "✘ failed";
      case "cancelled":
         return "⏻ stopped";
      case "running":
         return "◽ stale";
      default:
         return "• unknown";
   }
}

export function getRunStatusColor(run: RunInspection): string {
   if (run.active) {
      return "#f8d477";
   }

   switch (run.status) {
      case "success":
         return "#10b981";
      case "error":
         return "#ef4444";
      case "cancelled":
         return "#f59e0b";
      case "running":
         return "#f59e0b";
      default:
         return "#dbe7f5";
   }
}

export function formatRunDuration(
   run: RunInspection,
   now = Date.now()
): string {
   if ("durationMs" in run && typeof run.durationMs === "number") {
      return formatDuration(run.durationMs);
   }

   if (run.active) {
      const durationMs = now - Date.parse(run.startedAt);

      if (Number.isFinite(durationMs) && durationMs >= 0) {
         return formatDuration(durationMs);
      }
   }

   if (typeof run.endedAt === "string") {
      const durationMs = Date.parse(run.endedAt) - Date.parse(run.startedAt);

      if (Number.isFinite(durationMs) && durationMs >= 0) {
         return formatDuration(durationMs);
      }
   }

   if (run.status === "running") {
      return "running";
   }

   return "n/a";
}

export function getProjectTitle(projectRoot: string): string {
   const label = basename(projectRoot);
   return label.length > 0 ? label : projectRoot;
}

export function getRunShortLabel(run: RunInspection): string {
   return run.agent ?? run.runId.replace(/^\d{8}T\d{6}Z-/, "");
}

export function sortRunsForWorkbench(runs: RunInspection[]): RunInspection[] {
   return [...runs].sort((left, right) => {
      const activityDelta = Number(right.active) - Number(left.active);

      if (activityDelta !== 0) {
         return activityDelta;
      }

      return (
         right.startedAt.localeCompare(left.startedAt) ||
         right.runId.localeCompare(left.runId)
      );
   });
}

export function getSelectedRun(
   runs: RunInspection[],
   selectedRunId: string | undefined
): RunInspection | undefined {
   return runs.find((run) => run.runId === selectedRunId) ?? runs[0];
}

export function getRunCounts(runs: RunInspection[]): {
   failed: number;
   running: number;
} {
   return runs.reduce(
      (counts, run) => ({
         failed:
            counts.failed +
            (run.status === "error" || run.status === "cancelled" ? 1 : 0),
         running: counts.running + (run.active ? 1 : 0)
      }),
      {
         failed: 0,
         running: 0
      }
   );
}

export function buildProfileOptions(
   profiles: ScopedProfileDefinition[]
): Array<{
   description: string;
   name: string;
   value: string;
}> {
   return profiles.map((profile) => ({
      description: `${profile.provider} · ${formatScope(profile.scope)}`,
      name: profile.name,
      value: profile.id
   }));
}

export function buildProfileSummary(input: {
   profile: ScopedProfileDefinition | undefined;
   projectContext: ProjectContext | undefined;
   projectTitle: string;
}): string {
   if (input.profile === undefined) {
      return "No agent available. Create one with `aiman agent create`.";
   }

   const profile = input.profile;
   const header = renderLabelValueBlock([
      { label: "Agent", value: profile.name },
      { label: "Provider", value: profile.provider },
      { label: "Model", value: formatProfileModel(profile) },
      { label: "Reasoning", value: profile.reasoningEffort },
      { label: "Scope", value: formatScope(profile.scope) },
      {
         label: "Rights",
         value: formatRunRights(profile.provider)
      },
      { label: "Project", value: input.projectTitle },
      {
         label: "Context",
         value:
            input.projectContext !== undefined
               ? input.projectContext.title
               : "No shared context attached"
      }
   ]);

   return [header, "", profile.description, "", profile.body].join("\n");
}

export function buildRunSummary(run: RunInspection | undefined): string {
   if (run === undefined) {
      return "No runs recorded yet.";
   }

   const summary = renderLabelValueBlock([
      { label: "Run", value: run.runId },
      { label: "Agent", value: getRunShortLabel(run) },
      { label: "Provider", value: run.provider },
      { label: "Rights", value: formatRunRights(run.provider) },
      { label: "Launch", value: run.launchMode },
      {
         label: "Status",
         value: getRunDisplayStatus(run)
      },
      { label: "Started", value: formatTimestamp(run.startedAt) },
      { label: "Ended", value: formatTimestamp(run.endedAt) },
      { label: "Duration", value: formatRunDuration(run) },
      { label: "Project", value: run.projectRoot },
      { label: "Working dir", value: run.cwd }
   ]);

   const warning =
      typeof run.warning === "string" && run.warning.length > 0
         ? `Warning\n\n${run.warning}`
         : "";
   const errorMessage =
      typeof run.error?.message === "string" && run.error.message.length > 0
         ? `Error\n\n${run.error.message}`
         : "";

   return [summary, warning, errorMessage]
      .filter((part) => part.length > 0)
      .join("\n\n");
}

export function buildAnswerContent(input: {
   liveOutput: string;
   run: RunInspection | undefined;
}): string {
   if (input.run === undefined) {
      return "Select a run to inspect it.";
   }

   const answer =
      input.run.result !== undefined
         ? JSON.stringify(input.run.result, null, 2).trim()
         : typeof input.run.summary === "string"
           ? input.run.summary.trim()
           : "";

   if (answer.length > 0) {
      return answer;
   }

   if (input.run.status === "running" && input.liveOutput.trim().length > 0) {
      return input.liveOutput.trimEnd();
   }

   return input.run.status === "running"
      ? "Run is still active. Switch to the logs tab for live output."
      : "This run did not record a structured result.";
}

export function trimLiveOutput(value: string, maxLength = 24 * 1024): string {
   if (value.length <= maxLength) {
      return value;
   }

   return value.slice(value.length - maxLength);
}
