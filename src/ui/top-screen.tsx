import { useEffect, useReducer, useRef } from "react";

import { Spinner, StatusMessage } from "@inkjs/ui";
import { Box, useApp, useInput } from "ink";

import { UserError } from "../lib/errors.js";
import { formatDuration } from "../lib/pretty.js";
import { readRunOutput } from "../lib/run-output.js";
import { listRuns, readRunDetails, stopRun } from "../lib/runs.js";
import type { RunInspection, RunListFilter } from "../lib/types.js";
import {
   AppHeader,
   AppLayout,
   AppStatusLine,
   Breadcrumbs,
   StyledLinesPane
} from "./components.js";
import { useTerminalSize } from "./hooks.js";
import { runInkScreen } from "./render-screen.js";
import {
   clamp,
   getScrollWindow,
   padText,
   renderMarkdownLines,
   renderSeparator,
   truncateText,
   type StyledLine,
   type StyledLineTone
} from "./text.js";
import { AimanThemeProvider } from "./theme.js";

type TopState = {
   activeRows: RunInspection[];
   currentRun: RunInspection | undefined;
   detailScrollOffset: number;
   filter: RunListFilter;
   historicRows: RunInspection[];
   notice: {
      style?: StyledLineTone;
      text: string;
   } | undefined;
   outputText: string;
   selectedRunId: string | undefined;
   terminalHeight: number;
   terminalWidth: number;
   view: "detail" | "list";
};

const recentLogLines = 30;
const maxActiveRows = 6;
const maxHistoricRows = 10;
const refreshIntervalMs = 1000;

function setTopNotice(
   state: TopState,
   text: string,
   style: StyledLineTone | undefined
): void {
   state.notice =
      style === undefined
         ? { text }
         : {
              style,
              text
           };
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
         return "active first";
      case "historic":
         return "historic first";
      case "all":
         return "balanced";
   }
}

export function getTopRunsPaneTitle(filter: RunListFilter): string {
   switch (filter) {
      case "active":
         return "Runs";
      case "historic":
         return "Runs";
      case "all":
         return "Runs";
   }
}

export function getTopEmptyStateHint(filter: RunListFilter): string {
   switch (filter) {
      case "active":
         return "Press f for historic and all runs.";
      case "historic":
         return "Press f for all runs or back to active.";
      case "all":
         return "Create or run a profile to populate the dashboard.";
   }
}

export function renderTopMarkdown(text: string, width: number): StyledLine[] {
   return renderMarkdownLines(text, width);
}

export const getTopDetailScrollWindow = getScrollWindow;

type ListedRun = {
   run: RunInspection;
   section: "active" | "historic";
};

function getTopRunAge(run: {
   durationMs?: number;
   endedAt?: string;
   startedAt: string;
}, nowMs = Date.now()): string {
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

function getTopRunLabel(runId: string): string {
   const suffixMatch = runId.match(/^\d{8}T\d{6}Z-(.+)$/);
   return suffixMatch?.[1] ?? runId;
}

function formatTopDetailTimestamp(value: string): string {
   const match = value.match(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/
   );

   if (match === null) {
      return value;
   }

   return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}Z`;
}

function syncSelectedRun(state: TopState): void {
   const visibleRuns = getVisibleRuns(state);
   const selectedRunStillExists =
      typeof state.selectedRunId === "string" &&
      visibleRuns.some(({ run }) => run.runId === state.selectedRunId);

   if (!selectedRunStillExists) {
      const preferredSection = state.filter === "historic" ? "historic" : "active";
      state.selectedRunId =
         visibleRuns.find(({ section }) => section === preferredSection)?.run.runId ??
         visibleRuns[0]?.run.runId;
   }
}

function getVisibleRuns(state: TopState): ListedRun[] {
   const activeIds = new Set(state.activeRows.map((run) => run.runId));
   const historicRows = state.historicRows.filter((run) => !activeIds.has(run.runId));

   return [
      ...state.activeRows.map((run) => ({
         run,
         section: "active" as const
      })),
      ...historicRows.map((run) => ({
         run,
         section: "historic" as const
      }))
   ];
}

async function refreshState(state: TopState): Promise<void> {
   const [activeRows, historicRows] = await Promise.all([
      listRuns({
         filter: "active",
         limit: maxActiveRows
      }),
      listRuns({
         filter: "historic",
         limit: maxHistoricRows
      })
   ]);

   state.activeRows = activeRows;
   state.historicRows = historicRows;
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

function buildDetailLines(state: TopState, width: number): StyledLine[] {
   const run = state.currentRun;

   if (run === undefined) {
      return [
         {
            style: "dim",
            text: "No run selected."
         }
      ];
   }

   const lines: StyledLine[] = [
      {
         style: "accent",
         text: `RUN DETAILS: ${getTopRunLabel(run.runId).toUpperCase()}`
      },
      { text: `Run ID: ${run.runId}` },
      { text: `Profile: ${run.profile ?? run.agent ?? "unknown"}` },
      { text: `Provider: ${run.provider}` },
      { text: `Status: ${run.status}${run.active ? "*" : ""}` },
      { text: `Launch: ${run.launchMode} / ${run.mode}` },
      { text: `Started: ${formatTopDetailTimestamp(run.startedAt)}` },
      { text: `Cwd: ${run.cwd}` }
   ];

   if ("endedAt" in run && typeof run.endedAt === "string") {
      lines.push({ text: `Ended: ${formatTopDetailTimestamp(run.endedAt)}` });
   }

   if ("durationMs" in run && typeof run.durationMs === "number") {
      lines.push({ text: `Duration: ${formatDuration(run.durationMs)}` });
   }

   if (typeof run.warning === "string") {
      lines.push({ text: "" });
      lines.push({
         style: "warning",
         text: "WARNING"
      });
      lines.push(...renderMarkdownLines(run.warning, width));
   }

   if ("errorMessage" in run && typeof run.errorMessage === "string") {
      lines.push({ text: "" });
      lines.push({
         style: "error",
         text: "ERROR"
      });
      lines.push(...renderMarkdownLines(run.errorMessage, width));
   }

   if (
      "finalText" in run &&
      typeof run.finalText === "string" &&
      run.finalText.length > 0
   ) {
      lines.push({ text: "" });
      lines.push({
         style: "accent",
         text: "FINAL ANSWER"
      });
      lines.push(...renderTopMarkdown(run.finalText, width));
   }

   lines.push({ text: "" });
   lines.push({
      style: "accent",
      text: "RECENT LOGS"
   });
   lines.push(
      ...(state.outputText.length > 0
         ? state.outputText.split("\n").map((line) => ({
              text: truncateText(line, width)
           }))
         : [
              {
                 style: "dim" as const,
                 text: run.active
                    ? "No recent stdout/stderr yet."
                    : "No stdout/stderr was recorded for this run."
              }
           ])
   );

   return lines;
}

function buildRunSectionLines(input: {
   emptyText: string;
   rows: RunInspection[];
   selectedRunId?: string;
   width: number;
}): StyledLine[] {
   if (input.rows.length === 0) {
      return [
         {
            style: "dim",
            text: truncateText(input.emptyText, input.width)
         }
      ];
   }

   const statusWidth = 9;
   const timeWidth = 5;
   const labelWidth = Math.max(8, input.width - statusWidth - timeWidth - 6);

   const lines: StyledLine[] = [
      {
         style: "accent",
         text: truncateText(
            `${padText("AGENT", labelWidth)} ${padText("STATUS", statusWidth)} ${padText("CLOCK", timeWidth)}`,
            input.width
         )
      },
      { style: "dim", text: renderSeparator(input.width) }
   ];

   for (const run of input.rows) {
      const label = getTopRunLabel(run.runId);
      const status = run.active ? "running" : run.status;
      lines.push({
         ...(run.runId === input.selectedRunId
            ? { style: "selected" as const }
            : {}),
         text: truncateText(
            `${run.active ? "●" : "○"} ${padText(label, labelWidth)} ${padText(status, statusWidth)} ${getTopRunAge(run)}`,
            input.width
         )
      });
   }

   return lines;
}

function createInitialState(initialFilter: RunListFilter): TopState {
   return {
      activeRows: [],
      currentRun: undefined,
      detailScrollOffset: 0,
      filter: initialFilter,
      historicRows: [],
      notice: undefined,
      outputText: "",
      selectedRunId: undefined,
      terminalHeight: process.stdout.rows ?? 24,
      terminalWidth: process.stdout.columns ?? 80,
      view: "list"
   };
}

function getTopLayout(state: {
   terminalHeight: number;
   terminalWidth: number;
}): {
   activePaneHeight: number;
   contentHeight: number;
   detailWidth: number;
   historicPaneHeight: number;
   isWide: boolean;
   listWidth: number;
} {
   const isWide = state.terminalWidth >= 100;
   const contentHeight = Math.max(8, state.terminalHeight - 14);
   const listWidth = isWide
      ? Math.max(30, Math.floor(state.terminalWidth * 0.38))
      : Math.max(40, state.terminalWidth - 4);
   const detailWidth = isWide
      ? Math.max(36, state.terminalWidth - listWidth - 6)
      : listWidth;

   const activePaneHeight = Math.max(4, Math.floor((contentHeight - 2) * 0.4));
   const historicPaneHeight = Math.max(4, contentHeight - activePaneHeight - 2);

   return {
      activePaneHeight,
      contentHeight,
      detailWidth,
      historicPaneHeight,
      isWide,
      listWidth
   };
}

function TopDashboard(input: {
   initialFilter: RunListFilter;
}): React.JSX.Element {
   const { exit } = useApp();
   const [, forceRender] = useReducer((value) => value + 1, 0);
   const stateRef = useRef(createInitialState(input.initialFilter));
   const mountedRef = useRef(true);
   const refreshInFlightRef = useRef(false);
   const refreshQueuedRef = useRef(false);
   const refreshRef = useRef<() => Promise<void>>(async () => {});
   const { height, width } = useTerminalSize();
   const state = stateRef.current;
   state.terminalHeight = height;
   state.terminalWidth = width;

   const rerender = () => {
      if (mountedRef.current) {
         forceRender();
      }
   };

   const refresh = async () => {
      if (refreshInFlightRef.current) {
         refreshQueuedRef.current = true;
         return;
      }

      refreshInFlightRef.current = true;

      try {
         await refreshState(stateRef.current);
      } catch (error) {
         setTopNotice(
            stateRef.current,
            error instanceof Error ? error.message : String(error),
            "error"
         );
      } finally {
         rerender();
         refreshInFlightRef.current = false;

         if (refreshQueuedRef.current) {
            refreshQueuedRef.current = false;
            void refreshRef.current();
         }
      }
   };
   refreshRef.current = refresh;

   const stopSelectedRun = async () => {
      const currentState = stateRef.current;
      if (typeof currentState.selectedRunId !== "string") {
         setTopNotice(currentState, "No run selected.", "warning");
         rerender();
         return;
      }

      const visibleRuns = getVisibleRuns(currentState);
      const selectedRun = visibleRuns.find(
         ({ run }) => run.runId === currentState.selectedRunId
      )?.run;

      if (selectedRun?.active !== true) {
         setTopNotice(
            currentState,
            `Run "${currentState.selectedRunId}" is not active.`,
            "warning"
         );
         rerender();
         return;
      }

      setTopNotice(
         currentState,
         `Stopping ${getTopRunLabel(currentState.selectedRunId)}...`,
         "warning"
      );
      rerender();

      try {
         const stoppedRun = await stopRun(currentState.selectedRunId);
         setTopNotice(
            currentState,
            stoppedRun.status === "cancelled" ? "Stopped run." : "Stop requested.",
            stoppedRun.status === "cancelled" ? "success" : "warning"
         );
      } catch (error) {
         setTopNotice(
            currentState,
            error instanceof Error ? error.message : String(error),
            "error"
         );
      }

      await refreshRef.current();
   };

   useEffect(() => {
      void refreshRef.current();
      const interval = setInterval(() => {
         void refreshRef.current();
      }, refreshIntervalMs);

      return () => {
         mountedRef.current = false;
         clearInterval(interval);
      };
   }, []);

   useInput((inputValue, key) => {
      const currentState = stateRef.current;

      if (key.ctrl && inputValue === "c") {
         exit();
         return;
      }

      if (inputValue === "q") {
         exit();
         return;
      }

      if (inputValue === "r") {
         void refreshRef.current();
         return;
      }

      if (inputValue === "f") {
         currentState.filter = getNextRunFilter(currentState.filter);
         currentState.detailScrollOffset = 0;
         void refreshRef.current();
         return;
      }

      if (inputValue === "s") {
         void stopSelectedRun();
         return;
      }

      if (key.return) {
         currentState.view =
            currentState.view === "list" ? "detail" : "list";
         currentState.detailScrollOffset = 0;
         rerender();
         return;
      }

      if (key.escape) {
         currentState.view = "list";
         currentState.detailScrollOffset = 0;
         rerender();
         return;
      }

      if (currentState.view === "list") {
         if (inputValue === "j" || inputValue === "k") {
            const visibleRuns = getVisibleRuns(currentState);
            const selectedIndex = visibleRuns.findIndex(
               ({ run }) => run.runId === currentState.selectedRunId
            );
            const nextIndex = clamp(
               (selectedIndex >= 0 ? selectedIndex : 0) +
                  (inputValue === "j" ? 1 : -1),
               0,
               Math.max(0, visibleRuns.length - 1)
            );
            currentState.selectedRunId = visibleRuns[nextIndex]?.run.runId;
            void refreshRef.current();
         }

         return;
      }

      const layout = getTopLayout(currentState);
      const detailLines = buildDetailLines(currentState, layout.detailWidth);
      const viewportHeight = Math.max(4, layout.contentHeight - 4);
      const delta =
         key.downArrow || inputValue === "j"
            ? 1
            : key.upArrow || inputValue === "k"
              ? -1
              : key.pageDown || inputValue === " "
                ? viewportHeight - 1
                : key.pageUp
                  ? -(viewportHeight - 1)
                  : key.home
                    ? -Number.MAX_SAFE_INTEGER
                    : key.end
                      ? Number.MAX_SAFE_INTEGER
                      : 0;

      if (delta !== 0) {
         const viewport = getTopDetailScrollWindow(
            detailLines.length,
            viewportHeight,
            key.home
               ? 0
               : key.end
                 ? Number.MAX_SAFE_INTEGER
                 : currentState.detailScrollOffset + delta
         );
         currentState.detailScrollOffset = viewport.offset;
         rerender();
      }
   });

   const {
      activePaneHeight,
      contentHeight,
      detailWidth,
      historicPaneHeight,
      isWide,
      listWidth
   } = getTopLayout(state);
   const detailLines = buildDetailLines(state, detailWidth);
   const selectedRun = state.currentRun;

   const hotkeys = [
      { key: "j/k", label: "move" },
      { key: "enter", label: "inspect" },
      { key: "f", label: "filter" },
      { key: "s", label: "stop" },
      { key: "r", label: "refresh" },
      { key: "q", label: "quit" },
      { key: "ctrl+c", label: "exit" }
   ];

   const breadcrumbs = (
      <Breadcrumbs
         items={[
            "aiman",
            "runs",
            getTopFilterSummary(state.filter),
            state.view === "detail" ? "detail" : "list"
         ]}
      />
   );

   return (
      <AimanThemeProvider>
         <AppLayout
            footer={
               <AppStatusLine
                  message={state.notice?.text}
                  tone={state.notice?.style}
               />
            }
            header={
               <AppHeader
                  hotkeys={hotkeys}
                  version="v0.1.0"
               />
            }
         >
            <Box flexDirection={isWide ? "row" : "column"} gap={2} flexGrow={1}>
               {state.activeRows.length === 0 && state.historicRows.length === 0 ? (
                  <Box width={listWidth}>
                     <StatusMessage variant="info">
                        {getTopEmptyStateHint(state.filter)}
                     </StatusMessage>
                  </Box>
               ) : (
                  <Box flexDirection="column" gap={1} width={listWidth}>
                     {state.currentRun?.active === true ? (
                        <Spinner label="Watching selected run" />
                     ) : undefined}
                     <StyledLinesPane
                        height={activePaneHeight}
                        isFocused={state.view === "list"}
                        lines={buildRunSectionLines({
                           emptyText: "No active runs.",
                           rows: state.activeRows,
                           ...(typeof state.selectedRunId === "string"
                              ? { selectedRunId: state.selectedRunId }
                              : {}),
                           width: listWidth
                        })}
                        noBorder
                        title="Active"
                        width={listWidth}
                     />
                     <StyledLinesPane
                        height={historicPaneHeight}
                        isFocused={state.view === "list"}
                        lines={buildRunSectionLines({
                           emptyText: "No finished runs yet.",
                           rows: state.historicRows,
                           ...(typeof state.selectedRunId === "string"
                              ? { selectedRunId: state.selectedRunId }
                              : {}),
                           width: listWidth
                        })}
                        noBorder
                        title="Recent"
                        width={listWidth}
                     />
                  </Box>
               )}
               {isWide || state.view === "detail" ? (
                  <Box width={detailWidth}>
                     <StyledLinesPane
                        height={contentHeight}
                        isFocused={state.view === "detail"}
                        lines={detailLines}
                        noBorder
                        offset={state.detailScrollOffset}
                        title="Inspect"
                        width={detailWidth}
                     />
                  </Box>
               ) : selectedRun !== undefined ? (
                  <Box width={detailWidth}>
                     <StyledLinesPane
                        height={Math.max(6, contentHeight - 6)}
                        isFocused={false}
                        lines={[
                           {
                              style: "accent",
                              text: "SELECTED RUN"
                           },
                           {
                              text: truncateText(selectedRun.runId, detailWidth)
                           },
                           {
                              text: `${selectedRun.profile ?? selectedRun.agent ?? "unknown"}  ${selectedRun.provider}`
                           },
                           {
                              style: "dim",
                              text: "Press Enter to inspect the selected run."
                           }
                        ]}
                        noBorder
                        width={detailWidth}
                     />
                  </Box>
               ) : undefined}
            </Box>
         </AppLayout>
      </AimanThemeProvider>
   );
}

export async function openTopDashboard(
   initialFilter: RunListFilter
): Promise<void> {
   if (!process.stdout.isTTY || !process.stdin.isTTY) {
      throw new UserError("`aiman sesh top` requires an interactive TTY.");
   }

   await runInkScreen(<TopDashboard initialFilter={initialFilter} />);
}
