import * as readline from "node:readline";

import type { ArgumentsCamelCase, Argv } from "yargs";

import { UserError } from "../lib/errors.js";
import { readRunOutput } from "../lib/run-output.js";
import { formatDuration } from "../lib/pretty.js";
import { listRuns, readRunDetails } from "../lib/runs.js";
import type { RunInspection, RunListFilter } from "../lib/types.js";

type StyledLine = {
   style?: "accent" | "dim" | "error" | "selected" | "success" | "warning";
   text: string;
};

type TopState = {
   currentRun: RunInspection | undefined;
   filter: RunListFilter;
   outputText: string;
   rows: RunInspection[];
   selectedRunId: string | undefined;
   showInspect: boolean;
   terminalHeight: number;
   terminalWidth: number;
};

type TopArguments = {
   filter?: RunListFilter;
};

type RunAgeSource = {
   durationMs?: number;
   endedAt?: string;
   startedAt: string;
};

const refreshIntervalMs = 500;
const recentLogLines = 20;
const recentRunLimit = 20;
const alternateScreenOn = "\u001b[?1049h\u001b[?25l";
const alternateScreenOff = "\u001b[?25h\u001b[?1049l";
const clearScreen = "\u001b[H\u001b[J";
const ansi = {
   accent: "\u001b[38;5;45m",
   bold: "\u001b[1m",
   dim: "\u001b[2m",
   error: "\u001b[38;5;203m",
   reset: "\u001b[0m",
   selected: "\u001b[7m",
   success: "\u001b[38;5;78m",
   warning: "\u001b[38;5;221m"
} as const;

export const command = "top";
export const describe = "Open the session dashboard";

export function builder(yargs: Argv): Argv {
   return yargs.option("filter", {
      choices: ["active", "historic", "all"] as const,
      default: "active",
      describe: "Choose the initial run filter",
      type: "string"
   });
}

export function getNextRunFilter(filter: RunListFilter): RunListFilter {
   switch (filter) {
      case "active":
         return "historic";
      case "historic":
         return "all";
      case "all":
         return "active";
   }
}

export function getTopFilterSummary(filter: RunListFilter): string {
   switch (filter) {
      case "active":
         return "active only";
      case "historic":
         return "historic only";
      case "all":
         return "all runs";
   }
}

export function getTopRunsPaneTitle(filter: RunListFilter): string {
   switch (filter) {
      case "active":
         return "Runs (active)";
      case "historic":
         return "Runs (historic)";
      case "all":
         return "Runs (all)";
   }
}

export function getTopEmptyStateHint(filter: RunListFilter): string {
   switch (filter) {
      case "active":
         return "Press f for historic and all runs.";
      case "historic":
         return "Press f for all runs or back to active.";
      case "all":
         return "Create or run an agent to populate the dashboard.";
   }
}

function clamp(value: number, min: number, max: number): number {
   return Math.max(min, Math.min(max, value));
}

function truncate(value: string, width: number): string {
   if (width <= 0) {
      return "";
   }

   if (value.length <= width) {
      return value;
   }

   if (width === 1) {
      return value[0] ?? "";
   }

   return `${value.slice(0, width - 1)}…`;
}

function pad(value: string, width: number): string {
   return truncate(value, width).padEnd(width);
}

function applyStyle(line: StyledLine, width: number): string {
   const padded = pad(line.text, width);

   switch (line.style) {
      case "accent":
         return `${ansi.accent}${ansi.bold}${padded}${ansi.reset}`;
      case "dim":
         return `${ansi.dim}${padded}${ansi.reset}`;
      case "error":
         return `${ansi.error}${padded}${ansi.reset}`;
      case "selected":
         return `${ansi.selected}${padded}${ansi.reset}`;
      case "success":
         return `${ansi.success}${padded}${ansi.reset}`;
      case "warning":
         return `${ansi.warning}${padded}${ansi.reset}`;
      default:
         return padded;
   }
}

function buildBorder(title: string, width: number): string {
   const innerWidth = Math.max(0, width - 2);
   const plainTitle = truncate(` ${title} `, innerWidth);
   const fillerWidth = Math.max(0, innerWidth - plainTitle.length);

   return `┌${plainTitle}${"─".repeat(fillerWidth)}┐`;
}

function renderBox(input: {
   content: StyledLine[];
   height: number;
   title: string;
   width: number;
}): string[] {
   const innerWidth = Math.max(0, input.width - 2);
   const contentHeight = Math.max(0, input.height - 2);
   const clipped = input.content.slice(0, contentHeight);
   const paddedContent = [
      ...clipped,
      ...Array.from(
         { length: Math.max(0, contentHeight - clipped.length) },
         () => ({
            text: ""
         })
      )
   ];

   return [
      buildBorder(input.title, input.width),
      ...paddedContent.map((line) => `│${applyStyle(line, innerWidth)}│`),
      `└${"─".repeat(innerWidth)}┘`
   ];
}

function mergeColumns(left: string[], right: string[]): string[] {
   const rowCount = Math.max(left.length, right.length);
   const rows: string[] = [];

   for (let index = 0; index < rowCount; index += 1) {
      rows.push(`${left[index] ?? ""} ${right[index] ?? ""}`.trimEnd());
   }

   return rows;
}

function wrapLine(value: string, width: number): string[] {
   if (width <= 0) {
      return [""];
   }

   if (value.length === 0) {
      return [""];
   }

   const lines: string[] = [];
   let remaining = value;

   while (remaining.length > width) {
      const slice = remaining.slice(0, width + 1);
      const splitIndex = slice.lastIndexOf(" ");
      const breakIndex =
         splitIndex > Math.floor(width / 2) ? splitIndex : width;

      lines.push(remaining.slice(0, breakIndex).trimEnd());
      remaining = remaining.slice(breakIndex).trimStart();
   }

   lines.push(remaining);
   return lines;
}

function wrapText(text: string, width: number): StyledLine[] {
   return text.split("\n").flatMap((line) =>
      wrapLine(line, width).map((wrapped) => ({
         text: wrapped
      }))
   );
}

export function getTopRunAge(run: RunAgeSource, nowMs = Date.now()): string {
   const durationMs =
      typeof run.durationMs === "number"
         ? run.durationMs
         : typeof run.endedAt === "string"
           ? Date.parse(run.endedAt) - Date.parse(run.startedAt)
           : nowMs - Date.parse(run.startedAt);

   if (!Number.isFinite(durationMs) || durationMs < 0) {
      return "now";
   }

   return formatDuration(durationMs);
}

function formatStatus(run: RunInspection): string {
   return run.active ? `${run.status}*` : run.status;
}

function getSelectedIndex(state: TopState): number {
   return state.rows.findIndex((run) => run.runId === state.selectedRunId);
}

function moveSelection(state: TopState, delta: number): void {
   if (state.rows.length === 0) {
      state.selectedRunId = undefined;
      return;
   }

   const selectedIndex = getSelectedIndex(state);
   const nextIndex = clamp(
      (selectedIndex >= 0 ? selectedIndex : 0) + delta,
      0,
      state.rows.length - 1
   );

   state.selectedRunId = state.rows[nextIndex]?.runId;
}

function syncSelectedRun(state: TopState): void {
   const selectedRunStillExists =
      typeof state.selectedRunId === "string" &&
      state.rows.some((run) => run.runId === state.selectedRunId);

   if (!selectedRunStillExists) {
      state.selectedRunId = state.rows[0]?.runId;
   }
}

function buildRunsPane(
   state: TopState,
   innerWidth: number,
   innerHeight: number
): StyledLine[] {
   const nameWidth = Math.max(8, innerWidth - 17);
   const selectedIndex = getSelectedIndex(state);
   const visibleRows = Math.max(0, innerHeight - 2);
   const startIndex =
      selectedIndex < 0
         ? 0
         : clamp(
              selectedIndex - Math.floor(visibleRows / 2),
              0,
              Math.max(0, state.rows.length - visibleRows)
           );
   const visibleRowsData = state.rows.slice(
      startIndex,
      startIndex + visibleRows
   );

   if (state.rows.length === 0) {
      return [
         {
            style: "dim",
            text: "No runs found."
         },
         {
            style: "dim",
            text: getTopEmptyStateHint(state.filter)
         }
      ];
   }

   const lines: StyledLine[] = [
      {
         style: "accent",
         text: `${pad("Agent", nameWidth)}  ${pad("State", 8)}  ${pad("Age", 5)}`
      },
      {
         style: "dim",
         text: `${pad("", nameWidth)}  ${pad("", 8)}  ${pad("", 5)}`.replaceAll(
            " ",
            "·"
         )
      }
   ];

   for (const run of visibleRowsData) {
      const marker = run.runId === state.selectedRunId ? "›" : " ";
      const active = run.active ? "●" : "○";
      const name = `${marker} ${active} ${truncate(`${run.agent} / ${run.provider}`, Math.max(0, nameWidth - 4))}`;
      const age = getTopRunAge(run);
      const text = `${pad(name, nameWidth)}  ${pad(formatStatus(run), 8)}  ${pad(age, 5)}`;

      lines.push(
         run.runId === state.selectedRunId
            ? {
                 style: "selected",
                 text
              }
            : {
                 text
              }
      );
   }

   if (startIndex > 0) {
      lines[2] = {
         style: "dim",
         text: pad(
            `↑ ${startIndex} earlier run${startIndex === 1 ? "" : "s"}`,
            innerWidth
         )
      };
   }

   const hiddenBelow =
      state.rows.length - (startIndex + visibleRowsData.length);
   if (hiddenBelow > 0) {
      lines.push({
         style: "dim",
         text: `↓ ${hiddenBelow} more run${hiddenBelow === 1 ? "" : "s"}`
      });
   }

   return lines;
}

function pushWrappedSection(
   lines: StyledLine[],
   title: string,
   value: string | undefined,
   width: number
): void {
   if (typeof value !== "string" || value.length === 0) {
      return;
   }

   if (lines.length > 0) {
      lines.push({ text: "" });
   }

   lines.push({
      style: "accent",
      text: title
   });
   lines.push(...wrapText(value, width));
}

function buildSummaryLines(run: RunInspection): string[] {
   return [
      `Run ID: ${run.runId}`,
      `Agent: ${run.agent} (${run.agentScope})`,
      `Provider: ${run.provider}`,
      `Status: ${formatStatus(run)}`,
      `Launch: ${run.launchMode} / ${run.mode}`,
      `Cwd: ${run.cwd}`,
      `Started: ${run.startedAt}`,
      ...("endedAt" in run && typeof run.endedAt === "string"
         ? [`Ended: ${run.endedAt}`]
         : []),
      ...("durationMs" in run && typeof run.durationMs === "number"
         ? [`Duration: ${formatDuration(run.durationMs)}`]
         : []),
      ...("pid" in run && typeof run.pid === "number"
         ? [`PID: ${run.pid}`]
         : [])
   ];
}

function buildDetailPane(state: TopState, innerWidth: number): StyledLine[] {
   if (state.currentRun === undefined) {
      return [
         {
            style: "dim",
            text: "No run selected."
         }
      ];
   }

   const lines: StyledLine[] = [];

   lines.push({
      style: "accent",
      text: state.showInspect ? "Inspect Summary" : "Run Summary"
   });
   lines.push(...buildSummaryLines(state.currentRun).map((text) => ({ text })));

   if (typeof state.currentRun.warning === "string") {
      pushWrappedSection(
         lines,
         "Warning",
         state.currentRun.warning,
         innerWidth
      );
      lines[lines.length - 1]!.style = "warning";
   }

   if (
      "errorMessage" in state.currentRun &&
      typeof state.currentRun.errorMessage === "string"
   ) {
      pushWrappedSection(
         lines,
         "Error",
         state.currentRun.errorMessage,
         innerWidth
      );
      lines[lines.length - 1]!.style = "error";
   }

   if (
      "finalText" in state.currentRun &&
      typeof state.currentRun.finalText === "string" &&
      state.currentRun.finalText.length > 0
   ) {
      pushWrappedSection(
         lines,
         "Final Answer",
         state.currentRun.finalText,
         innerWidth
      );
   }

   if (state.showInspect) {
      pushWrappedSection(
         lines,
         "Files",
         [
            `Run: ${state.currentRun.paths.runFile}`,
            `Prompt: ${state.currentRun.paths.promptFile}`,
            `Stdout: ${state.currentRun.paths.stdoutLog ?? "none"}`,
            `Stderr: ${state.currentRun.paths.stderrLog ?? "none"}`,
            `Artifacts: ${state.currentRun.paths.artifactsDir}`
         ].join("\n"),
         innerWidth
      );

      const artifactCount = state.currentRun.document.artifacts.length;
      pushWrappedSection(
         lines,
         "Artifacts",
         artifactCount === 0
            ? "No artifacts recorded."
            : `${artifactCount} artifact${artifactCount === 1 ? "" : "s"} recorded.`,
         innerWidth
      );
   }

   pushWrappedSection(
      lines,
      "Commands",
      state.showInspect
         ? [
              `aiman sesh show ${state.currentRun.runId}`,
              `aiman sesh logs ${state.currentRun.runId} -f`,
              `aiman sesh inspect ${state.currentRun.runId} --stream run`,
              `aiman sesh inspect ${state.currentRun.runId} --stream prompt`
           ].join("\n")
         : [
              `aiman sesh logs ${state.currentRun.runId} -f`,
              `aiman sesh inspect ${state.currentRun.runId}`
           ].join("\n"),
      innerWidth
   );

   return lines.flatMap((line) => {
      if (line.text.length === 0) {
         return [line];
      }

      const wrapped = wrapLine(line.text, innerWidth).map((text) =>
         line.style === undefined
            ? {
                 text
              }
            : {
                 style: line.style,
                 text
              }
      );
      return wrapped;
   });
}

function buildOutputPane(outputText: string, innerWidth: number): StyledLine[] {
   if (outputText.length === 0) {
      return [
         {
            style: "dim",
            text: "No output yet."
         }
      ];
   }

   return wrapText(outputText, innerWidth);
}

function renderDashboard(state: TopState): string {
   const width = Math.max(80, state.terminalWidth);
   const height = Math.max(24, state.terminalHeight);
   const headerText = `aiman sesh top  ${getTopFilterSummary(state.filter)}  ${
      state.showInspect ? "inspect view" : "status view"
   }  ${state.rows.length} listed`;
   const controlsText =
      "j/k or arrows move  enter toggles detail  f cycles filter  r refresh  q quit";
   const bodyHeight = Math.max(10, height - 3);
   const leftWidth = clamp(Math.floor(width * 0.42), 34, 52);
   const rightWidth = Math.max(30, width - leftWidth - 1);
   const detailHeight = clamp(Math.floor(bodyHeight * 0.58), 8, bodyHeight - 6);
   const outputHeight = bodyHeight - detailHeight;
   const leftPane = renderBox({
      content: buildRunsPane(state, leftWidth - 2, bodyHeight - 2),
      height: bodyHeight,
      title: getTopRunsPaneTitle(state.filter),
      width: leftWidth
   });
   const detailPane = renderBox({
      content: buildDetailPane(state, rightWidth - 2),
      height: detailHeight,
      title: state.showInspect ? "Inspect" : "Status",
      width: rightWidth
   });
   const outputPane = renderBox({
      content: buildOutputPane(state.outputText, rightWidth - 2),
      height: outputHeight,
      title: "Output",
      width: rightWidth
   });
   const rightPane = [...detailPane, ...outputPane];

   return [
      `${ansi.accent}${ansi.bold}${truncate(headerText, width)}${ansi.reset}`,
      `${ansi.dim}${truncate(controlsText, width)}${ansi.reset}`,
      ...mergeColumns(leftPane, rightPane)
   ].join("\n");
}

function updateTerminalSize(state: TopState): void {
   state.terminalWidth = process.stdout.columns ?? 80;
   state.terminalHeight = process.stdout.rows ?? 24;
}

async function refreshState(state: TopState): Promise<void> {
   state.rows = await listRuns({
      filter: state.filter,
      limit: recentRunLimit
   });
   syncSelectedRun(state);

   if (typeof state.selectedRunId !== "string") {
      state.currentRun = undefined;
      state.outputText = "";
      return;
   }

   const [run, recentOutput] = await Promise.all([
      readRunDetails(state.selectedRunId),
      readRunOutput(state.selectedRunId, "all", recentLogLines)
   ]);

   state.currentRun = run;
   state.outputText = recentOutput;
}

function writeScreen(content: string): void {
   process.stdout.write(`${clearScreen}${content}`);
}

async function runInteractiveDashboard(
   initialFilter: RunListFilter
): Promise<void> {
   const state: TopState = {
      currentRun: undefined,
      filter: initialFilter,
      outputText: "",
      rows: [],
      selectedRunId: undefined,
      showInspect: false,
      terminalHeight: process.stdout.rows ?? 24,
      terminalWidth: process.stdout.columns ?? 80
   };
   let closed = false;
   let interval: NodeJS.Timeout | undefined;
   let refreshInFlight = false;
   let refreshQueued = false;
   let closedResolver: (() => void) | undefined;

   const cleanup = () => {
      if (closed) {
         return;
      }

      closed = true;
      if (interval) {
         clearInterval(interval);
      }
      process.stdout.off("resize", handleResize);
      process.stdin.off("keypress", handleKeypress);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write(alternateScreenOff);
      closedResolver?.();
   };

   const refresh = async () => {
      if (closed) {
         return;
      }

      if (refreshInFlight) {
         refreshQueued = true;
         return;
      }

      refreshInFlight = true;

      try {
         updateTerminalSize(state);
         await refreshState(state);
         writeScreen(renderDashboard(state));
      } catch (error) {
         const message = error instanceof Error ? error.message : String(error);
         state.currentRun = undefined;
         state.outputText = "";
         writeScreen(
            renderDashboard({
               ...state,
               currentRun: undefined,
               outputText: "",
               rows: [],
               selectedRunId: undefined
            }) + `\n\n${ansi.error}${message}${ansi.reset}`
         );
      } finally {
         refreshInFlight = false;

         if (refreshQueued) {
            refreshQueued = false;
            void refresh();
         }
      }
   };

   const handleResize = () => {
      void refresh();
   };

   const handleKeypress = (value: string, key: readline.Key) => {
      if (key.ctrl === true && key.name === "c") {
         cleanup();
         return;
      }

      switch (key.name) {
         case "q":
            cleanup();
            return;
         case "up":
            moveSelection(state, -1);
            void refresh();
            return;
         case "down":
            moveSelection(state, 1);
            void refresh();
            return;
         case "return":
            state.showInspect = !state.showInspect;
            void refresh();
            return;
         case "r":
            void refresh();
            return;
         case "f":
            state.filter = getNextRunFilter(state.filter);
            void refresh();
            return;
         default:
            break;
      }

      if (value === "j") {
         moveSelection(state, 1);
         void refresh();
         return;
      }

      if (value === "k") {
         moveSelection(state, -1);
         void refresh();
      }
   };

   process.stdout.write(alternateScreenOn);
   readline.emitKeypressEvents(process.stdin);
   process.stdin.setRawMode(true);
   process.stdin.resume();
   process.stdout.on("resize", handleResize);
   process.stdin.on("keypress", handleKeypress);

   await refresh();

   interval = setInterval(() => {
      void refresh();
   }, refreshIntervalMs);

   await new Promise<void>((resolve) => {
      closedResolver = resolve;
   });
}

export async function handler(
   args: ArgumentsCamelCase<TopArguments>
): Promise<void> {
   if (!process.stdout.isTTY || !process.stdin.isTTY) {
      throw new UserError("`aiman sesh top` requires an interactive TTY.");
   }

   await runInteractiveDashboard(args.filter ?? "active");
}
