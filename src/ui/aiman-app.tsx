import { useEffect, useReducer, useRef } from "react";
import { readdir } from "node:fs/promises";

import { Alert, Select, Spinner, StatusMessage, TextInput } from "@inkjs/ui";
import { Box, Text, useApp, useInput } from "ink";

import { UserError } from "../lib/errors.js";
import { getProjectPaths } from "../lib/paths.js";
import { loadProfileDefinition, listProfiles } from "../lib/profiles.js";
import { loadProjectContext } from "../lib/project-context.js";
import { readRunOutput } from "../lib/run-output.js";
import {
   listRuns,
   readRunDetails,
   readRunLog,
   runAgent,
   stopRun
} from "../lib/runs.js";
import { resolveSkillsForRun, listSkills } from "../lib/skills.js";
import type {
   ProjectContext,
   ResolvedSkill,
   RunInspection,
   RunListFilter,
   RunMode,
   RunResult,
   ScopedProfileDefinition
} from "../lib/types.js";
import {
   AppHeader,
   AppLayout,
   AppStatusLine,
   Breadcrumbs,
   StatusBadge,
   StyledLinesPane
} from "./components.js";
import { useTerminalSize } from "./hooks.js";
import { runInkScreen } from "./render-screen.js";
import {
   centerText,
   clamp,
   padText,
   renderMarkdownLines,
   renderSeparator,
   truncateText,
   type StyledLine,
   type StyledLineTone
} from "./text.js";
import { AimanThemeProvider } from "./theme.js";

type ViewName =
   | "agents"
   | "answer"
   | "details"
   | "history"
   | "home"
   | "logs"
   | "prompt"
   | "run"
   | "skills";

type AppFocus = "content" | "history" | "nav" | "profile" | "skills" | "task";

type AppState = {
   activeSkills: ResolvedSkill[];
   currentRun: RunInspection | undefined;
   currentView: ViewName;
   focus: AppFocus;
   footerNotice: {
      style?: StyledLineTone;
      text: string;
   } | undefined;
   historyIndex: number;
   historyRuns: RunInspection[];
   historySelectNonce: number;
   liveLogs: string;
   manualSkillNames: string[];
   profiles: ScopedProfileDefinition[];
   profileSelectNonce: number;
   projectContext: ProjectContext | undefined;
   projectFiles: string[];
   promptText: string;
   totalAgents: number;
   totalSkills: number;
   hasAgentsMd: boolean;
   runFilter: RunListFilter;
   runId: string | undefined;
   runResult: RunResult | undefined;
   runStopping: boolean;
   running: boolean;
   scrollOffset: number;
   selectedProfileIndex: number;
   selectedSkillIndex: number;
   skillSelectNonce: number;
   suggestedSkills: ResolvedSkill[];
   task: string;
   taskInputNonce: number;
   terminalHeight: number;
   terminalWidth: number;
   viewHistory: ViewName[];
};

const maxLogBytes = 64 * 1024;
const recentHistoryLimit = 30;
const refreshIntervalMs = 1000;
const viewOrder: ViewName[] = [
   "home",
   "agents",
   "history",
   "run",
   "details",
   "answer",
   "logs",
   "prompt"
];

function trimLogBuffer(value: string): string {
   if (Buffer.byteLength(value, "utf8") <= maxLogBytes) {
      return value;
   }

   let trimmed = value;

   while (Buffer.byteLength(trimmed, "utf8") > maxLogBytes) {
      const firstNewline = trimmed.indexOf("\n");
      trimmed =
         firstNewline === -1
            ? trimmed.slice(Math.floor(trimmed.length / 2))
            : trimmed.slice(firstNewline + 1);
   }

   return trimmed;
}

function summarizeMode(mode: RunMode | undefined): string {
   return mode === "yolo" ? "yolo" : "safe";
}

function createInitialState(): AppState {
   return {
      activeSkills: [],
      currentRun: undefined,
      currentView: "home",
      focus: "nav",
      footerNotice: undefined,
      historyIndex: 0,
      historyRuns: [],
      historySelectNonce: 0,
      liveLogs: "",
      manualSkillNames: [],
      profiles: [],
      profileSelectNonce: 0,
      projectContext: undefined,
      projectFiles: [],
      promptText: "",
      totalAgents: 0,
      totalSkills: 0,
      hasAgentsMd: false,
      runFilter: "all",
      runId: undefined,
      runResult: undefined,
      runStopping: false,
      running: false,
      scrollOffset: 0,
      selectedProfileIndex: 0,
      selectedSkillIndex: 0,
      skillSelectNonce: 0,
      suggestedSkills: [],
      task: "",
      taskInputNonce: 0,
      terminalHeight: process.stdout.rows ?? 24,
      terminalWidth: process.stdout.columns ?? 80,
      viewHistory: []
   };
}

function setNotice(
   state: AppState,
   text: string,
   style: StyledLineTone | undefined = "dim"
): void {
   state.footerNotice =
      style === undefined
         ? { text }
         : {
              style,
              text
           };
}

function getCurrentProfile(state: AppState): ScopedProfileDefinition | undefined {
   return state.profiles[state.selectedProfileIndex];
}

function getSelectedHistoryRun(state: AppState): RunInspection | undefined {
   return getVisibleHistoryRuns(state)[state.historyIndex];
}

function getVisibleHistoryRuns(state: AppState): RunInspection[] {
   switch (state.runFilter) {
      case "active":
         return state.historyRuns.filter((run) => run.active);
      case "historic":
         return state.historyRuns.filter((run) => !run.active);
      case "all":
         return state.historyRuns;
   }
}

function cycleRunFilter(filter: RunListFilter): RunListFilter {
   switch (filter) {
      case "active":
         return "historic";
      case "historic":
         return "all";
      case "all":
         return "active";
   }
}

function getRunFilterLabel(filter: RunListFilter): string {
   switch (filter) {
      case "active":
         return "active";
      case "historic":
         return "historic";
      case "all":
         return "all";
   }
}

function clampHistorySelection(state: AppState): void {
   state.historyIndex = clamp(
      state.historyIndex,
      0,
      Math.max(0, getVisibleHistoryRuns(state).length - 1)
   );
}

function getViewLabel(view: ViewName): string {
   switch (view) {
      case "home":
         return "start";
      case "agents":
         return "agents";
      case "history":
         return "runs";
      case "run":
         return "live";
      case "details":
         return "inspect";
      case "answer":
         return "output";
      case "logs":
         return "logs";
      case "prompt":
         return "prompt";
      case "skills":
         return "skills";
   }
}

export function getGlobalViewHotkey(input: string): {
   focus?: AppFocus;
   view: ViewName;
} | undefined {
   switch (input) {
      case "g":
         return { view: "home" };
      case "a":
         return {
            focus: "profile",
            view: "agents"
         };
      case "t":
         return {
            focus: "task",
            view: "agents"
         };
      case "r":
         return { view: "history" };
      default:
         return undefined;
   }
}

export function buildHomeHeroLines(input: {
   contentHeight: number;
   hasAgentsMd: boolean;
   projectTitle: string;
   totalAgents: number;
   totalSkills: number;
   width: number;
}): StyledLine[] {
   const contextSummary = input.hasAgentsMd ? "AGENTS.md loaded" : "AGENTS.md missing";
   return [
      {
         style: "dim" as const,
         text: centerText("agent workbench for focused local runs", input.width)
      },
      { text: "" },
      {
         style: "dim" as const,
         text: centerText(`PROJECT  ${input.projectTitle}`, input.width)
      },
      {
         style: "dim" as const,
         text: centerText(
            `AGENTS   ${input.totalAgents}   SKILLS   ${input.totalSkills}`,
            input.width
         )
      },
      {
         style: "dim" as const,
         text: centerText(`CONTEXT  ${contextSummary}`, input.width)
      }
   ];
}

function getFocusOrder(state: AppState): AppFocus[] {
   switch (state.currentView) {
      case "home":
         return ["nav", "content"];
      case "agents":
         return ["nav", "profile", "task", "content"];
      case "skills":
         return ["nav", "skills", "content"];
      case "history":
         return ["nav", "history", "content"];
      default:
         return ["nav", "content"];
   }
}

function getDefaultFocus(state: AppState): AppFocus {
   switch (state.currentView) {
      case "home":
         return "content";
      case "agents":
         return state.profiles.length > 0 ? "profile" : "content";
      case "skills":
         return state.suggestedSkills.length > 0 ? "skills" : "content";
      case "history":
         return getVisibleHistoryRuns(state).length > 0 ? "history" : "content";
      default:
         return "content";
   }
}

function cycleFocus(state: AppState, direction: 1 | -1): void {
   const focusOrder = getFocusOrder(state);
   const currentIndex = focusOrder.indexOf(state.focus);
   const fallbackIndex = currentIndex >= 0 ? currentIndex : 0;
   const nextIndex =
      (fallbackIndex + direction + focusOrder.length) % focusOrder.length;
   state.focus = focusOrder[nextIndex] ?? "nav";
}

function setCurrentView(
   state: AppState,
   view: ViewName,
   keepNavFocus = false,
   pushHistory = true
): void {
   if (pushHistory && state.currentView !== view) {
      state.viewHistory = [...state.viewHistory, state.currentView];
   }

   state.currentView = view;
   state.scrollOffset = 0;
   state.focus = keepNavFocus ? "nav" : getDefaultFocus(state);
}

function goBack(state: AppState): boolean {
   const previousView = state.viewHistory[state.viewHistory.length - 1];

   if (previousView === undefined) {
      return false;
   }

   state.viewHistory = state.viewHistory.slice(0, -1);
   setCurrentView(state, previousView, false, false);
   return true;
}

async function refreshProfileCatalog(state: AppState): Promise<void> {
   const previousIndex = state.selectedProfileIndex;
   state.profiles = await listProfiles(getProjectPaths());
   state.selectedProfileIndex = clamp(
      state.selectedProfileIndex,
      0,
      Math.max(0, state.profiles.length - 1)
   );

   if (state.selectedProfileIndex !== previousIndex) {
      state.profileSelectNonce += 1;
   }
}

async function refreshHistory(state: AppState): Promise<void> {
   const previousIndex = state.historyIndex;
   state.historyRuns = await listRuns({
      filter: "all",
      limit: recentHistoryLimit
   });
   clampHistorySelection(state);

   if (state.historyIndex !== previousIndex) {
      state.historySelectNonce += 1;
   }
}

async function refreshSkillSelection(state: AppState): Promise<void> {
   const profile = getCurrentProfile(state);

   if (profile === undefined) {
      state.activeSkills = [];
      state.suggestedSkills = [];
      state.manualSkillNames = [];
      state.selectedSkillIndex = 0;
      state.skillSelectNonce += 1;
      return;
   }

   const reloadedProfile = await loadProfileDefinition(
      getProjectPaths(),
      profile.id,
      profile.isBuiltIn === true ? undefined : profile.scope
   );
   const selection = await resolveSkillsForRun(getProjectPaths(), {
      profile: reloadedProfile,
      selectedSkillNames: state.manualSkillNames,
      task: state.task
   });

   const previousIndex = state.selectedSkillIndex;
   state.activeSkills = selection.active;
   state.suggestedSkills = selection.suggested;
   state.manualSkillNames = state.manualSkillNames.filter((name) =>
      selection.active.some((skill) => skill.name === name)
   );
   state.selectedSkillIndex = clamp(
      state.selectedSkillIndex,
      0,
      Math.max(0, state.suggestedSkills.length - 1)
   );

   if (state.selectedSkillIndex !== previousIndex) {
      state.skillSelectNonce += 1;
   }
}

async function refreshCurrentRun(state: AppState): Promise<void> {
   if (typeof state.runId !== "string") {
      state.currentRun = undefined;
      state.runResult = undefined;
      state.promptText = "";
      return;
   }

   state.currentRun = await readRunDetails(state.runId);

   if (state.currentRun.status !== "running") {
      state.runResult = {
         ...(typeof state.currentRun.profile === "string"
            ? { profile: state.currentRun.profile }
            : {}),
         ...(typeof state.currentRun.profilePath === "string"
            ? { profilePath: state.currentRun.profilePath }
            : {}),
         ...(typeof state.currentRun.profileScope === "string"
            ? { profileScope: state.currentRun.profileScope }
            : {}),
         finalText:
            "finalText" in state.currentRun ? state.currentRun.finalText : "",
         launchMode: state.currentRun.launchMode,
         mode: state.currentRun.mode,
         projectRoot: state.currentRun.projectRoot,
         provider: state.currentRun.provider,
         runId: state.currentRun.runId,
         status: state.currentRun.status,
         ...(typeof state.currentRun.errorMessage === "string"
            ? { errorMessage: state.currentRun.errorMessage }
            : {})
      };
   }

   try {
      state.promptText = await readRunLog(state.runId, "prompt");
   } catch {
      state.promptText = "";
   }

   try {
      state.liveLogs = trimLogBuffer(await readRunOutput(state.runId, "all", 200));
   } catch {
      state.liveLogs = "";
   }
}

function moveSelectableIndex(
   state: AppState,
   delta: number,
   focus: "history" | "profile" | "skills"
): void {
   if (focus === "profile") {
      const nextIndex = clamp(
         state.selectedProfileIndex + delta,
         0,
         Math.max(0, state.profiles.length - 1)
      );

      if (nextIndex !== state.selectedProfileIndex) {
         state.selectedProfileIndex = nextIndex;
         state.profileSelectNonce += 1;
      }

      return;
   }

   if (focus === "history") {
      const visibleRuns = getVisibleHistoryRuns(state);
      const nextIndex = clamp(
         state.historyIndex + delta,
         0,
         Math.max(0, visibleRuns.length - 1)
      );

      if (nextIndex !== state.historyIndex) {
         state.historyIndex = nextIndex;
         state.historySelectNonce += 1;
      }

      return;
   }

   const nextIndex = clamp(
      state.selectedSkillIndex + delta,
      0,
      Math.max(0, state.suggestedSkills.length - 1)
   );

   if (nextIndex !== state.selectedSkillIndex) {
      state.selectedSkillIndex = nextIndex;
      state.skillSelectNonce += 1;
   }
}

function getRunShortLabel(run: RunInspection): string {
   return run.profile ?? run.agent ?? run.runId.replace(/^\d{8}T\d{6}Z-/, "");
}

function buildProfileTableLines(input: {
   profiles: ScopedProfileDefinition[];
   selectedIndex: number;
   width: number;
}): StyledLine[] {
   const nameWidth = Math.max(10, Math.floor(input.width * 0.28));
   const modeWidth = 6;
   const providerWidth = 8;
   const scopeWidth = 7;
   const descWidth = Math.max(
      10,
      input.width - nameWidth - modeWidth - providerWidth - scopeWidth - 7
   );

   const lines: StyledLine[] = [
      {
         style: "accent",
         text: truncateText(
            `${padText("AGENT", nameWidth)} ${padText("MODE", modeWidth)} ${padText("PROVIDER", providerWidth)} ${padText("SCOPE", scopeWidth)} ${padText("PURPOSE", descWidth)}`,
            input.width
         )
      },
      { style: "dim", text: renderSeparator(input.width) }
   ];

   if (input.profiles.length === 0) {
      lines.push({
         style: "dim",
         text: "No agents are available yet."
      });
      return lines;
   }

   lines.push(
      ...input.profiles.map((profile, index) => ({
         ...(index === input.selectedIndex ? { style: "selected" as const } : {}),
         text: truncateText(
            `${padText(profile.name, nameWidth)} ${padText(summarizeMode(profile.mode), modeWidth)} ${padText(profile.provider, providerWidth)} ${padText(profile.scope, scopeWidth)} ${padText(profile.description, descWidth)}`,
            input.width
         )
      }))
   );

   return lines;
}

function buildRunsTableLines(input: {
   rows: RunInspection[];
   selectedIndex: number;
   width: number;
}): StyledLine[] {
   const profileWidth = Math.max(10, Math.floor(input.width * 0.26));
   const statusWidth = 10;
   const modeWidth = 6;
   const startedWidth = 16;
   const runWidth = Math.max(
      10,
      input.width - profileWidth - statusWidth - modeWidth - startedWidth - 6
   );
   const rows = input.rows;
   const lines: StyledLine[] = [
      {
         style: "accent",
         text: truncateText(
            `${padText("AGENT", profileWidth)} ${padText("STATUS", statusWidth)} ${padText("MODE", modeWidth)} ${padText("STARTED", startedWidth)} ${padText("RUN", runWidth)}`,
            input.width
         )
      },
      { style: "dim", text: renderSeparator(input.width) }
   ];

   if (rows.length === 0) {
      lines.push({
         style: "dim",
         text: "No runs match the current filter."
      });
      return lines;
   }

   lines.push(
      ...rows.map((run, index) => ({
         ...(index === input.selectedIndex ? { style: "selected" as const } : {}),
         text: truncateText(
            `${padText(getRunShortLabel(run), profileWidth)} ${padText(run.active ? "running" : run.status, statusWidth)} ${padText(summarizeMode(run.mode), modeWidth)} ${padText(run.startedAt.slice(0, 16), startedWidth)} ${padText(run.runId, runWidth)}`,
            input.width
         )
      }))
   );

   return lines;
}

function buildPromptLines(text: string, width: number): StyledLine[] {
   if (text.trim().length === 0) {
      return [
         {
            style: "dim",
            text: "No prompt was recorded for the selected run."
         }
      ];
   }

   return text.split("\n").map((line) => ({
      text: truncateText(line, width)
   }));
}

function buildAnswerLines(state: AppState, width: number): StyledLine[] {
   const currentRunFinalText =
      state.currentRun !== undefined &&
      "finalText" in state.currentRun &&
      typeof state.currentRun.finalText === "string"
         ? state.currentRun.finalText
         : "";
   const answer =
      state.runResult?.finalText ?? currentRunFinalText;

   if (answer.trim().length === 0) {
      return [
         {
            style: "dim",
            text: state.running
               ? "Final answer will appear here when the run finishes."
               : "No final answer is recorded for this run."
         }
      ];
   }

   return renderMarkdownLines(answer, width);
}

function buildLogsLines(state: AppState, width: number): StyledLine[] {
   if (state.liveLogs.trim().length === 0) {
      return [
         {
            style: "dim",
            text: state.running
               ? "Waiting for stdout and stderr..."
               : "No stdout or stderr was recorded."
         }
      ];
   }

   return state.liveLogs.split("\n").map((line) => ({
      text: truncateText(line, width)
   }));
}

function buildDetailsLines(state: AppState, width: number): StyledLine[] {
   const run = state.currentRun;

   if (run === undefined) {
      return [
         {
            style: "dim",
            text: "Select or start a run to inspect details."
         }
      ];
   }

   const lines: StyledLine[] = [
      {
         style: "accent",
         text: "SUMMARY"
      },
      { text: `Run ID: ${run.runId}` },
      { text: `Profile: ${run.profile ?? run.agent ?? "unknown"}` },
      { text: `Provider: ${run.provider}` },
      { text: `Status: ${run.status}${run.active ? "*" : ""}` },
      { text: `Launch: ${run.launchMode} / ${run.mode}` },
      { text: `Started: ${run.startedAt}` },
      { text: `Cwd: ${run.cwd}` }
   ];

   if ("endedAt" in run && typeof run.endedAt === "string") {
      lines.push({ text: `Ended: ${run.endedAt}` });
   }

   if ("durationMs" in run && typeof run.durationMs === "number") {
      lines.push({ text: `Duration: ${run.durationMs}ms` });
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

   return lines;
}

function buildRunMetadataLines(state: AppState, width: number): StyledLine[] {
   if (state.currentRun === undefined) {
      return [
         {
            style: "dim",
            text: "No active or selected run."
         }
      ];
   }

   return [
      {
         style: "accent",
         text: "RUN METADATA"
      },
      { text: `Run ID:   ${state.currentRun.runId}` },
      { text: `Provider: ${state.currentRun.provider}` },
      {
         text: `Status:   ${state.currentRun.status}${state.currentRun.active ? "*" : ""}`
      },
      { text: `Started:  ${state.currentRun.startedAt}` },
      {
         text: truncateText(`Task:     ${state.currentRun.launch.task ?? ""}`, width)
      }
   ];
}

function getPaneDimensions(state: AppState): {
   contentHeight: number;
   isWide: boolean;
   mainWidth: number;
   railWidth: number;
} {
   const mainWidth = Math.max(40, state.terminalWidth - 4);

   return {
      contentHeight: Math.max(8, state.terminalHeight - 14),
      isWide: false,
      mainWidth,
      railWidth: 0
   };
}

function renderHeader(
   _state: AppState,
   hotkeys: { key: string; label: string }[]
): React.JSX.Element {
   return (
      <AppHeader
         hotkeys={hotkeys}
         version="v0.1.0"
      />
   );
}

function renderBreadcrumbs(state: AppState): React.JSX.Element {
   const profile = getCurrentProfile(state);
   const currentViewLabel = getViewLabel(state.currentView);
   const items = ["aiman"];

   if (state.currentView === "history") {
      items.push("runs");
      items.push(getRunFilterLabel(state.runFilter));
   } else if (state.currentView === "run") {
      items.push("runs");
      if (state.runId) items.push(state.runId);
   } else if (state.currentView === "details") {
      items.push("runs");
      if (state.runId) items.push(state.runId);
      items.push("details");
   } else {
      items.push(currentViewLabel);
   }

   return <Breadcrumbs items={items} />;
}

function renderHomePanel(
   state: AppState,
   contentHeight: number,
   width: number
): React.JSX.Element {
   return (
      <Box flexDirection="column" paddingX={1} height={contentHeight}>
         <StyledLinesPane
            height={contentHeight}
            isFocused={state.focus === "content"}
            lines={buildHomeHeroLines({
               contentHeight,
               hasAgentsMd: state.hasAgentsMd,
               projectTitle: state.projectContext?.title ?? "unknown",
               totalAgents: state.totalAgents,
               totalSkills: state.totalSkills,
               width
            })}
            noBorder={true}
            width={width}
         />
      </Box>
   );
}

function renderAgentsPanel(
   state: AppState,
   contentHeight: number,
   width: number,
   launchRun: () => void,
   refreshSuggestions: () => void
): React.JSX.Element {
   const profile = getCurrentProfile(state);
   const tableHeight = Math.max(6, contentHeight - 8);

   return (
      <Box flexDirection="column" gap={2} height={contentHeight}>
         <StyledLinesPane
            height={tableHeight}
            isFocused={state.focus === "profile"}
            lines={buildProfileTableLines({
               profiles: state.profiles,
               selectedIndex: state.selectedProfileIndex,
               width: width
            })}
            noBorder
            title="Agents"
            width={width}
         />
         {profile !== undefined ? (
            <StatusMessage variant="info">
               {profile.description}
            </StatusMessage>
         ) : (
            <StatusMessage variant="warning">
               No agents are available yet.
            </StatusMessage>
         )}
         <TextInput
            defaultValue={state.task}
            isDisabled={profile === undefined || state.focus !== "task"}
            key={`task-${state.taskInputNonce}`}
            onChange={(value) => {
               state.task = value;
               refreshSuggestions();
            }}
            onSubmit={() => {
               launchRun();
            }}
            placeholder={
               profile === undefined
                  ? "Choose an agent first..."
                  : `Describe what you want ${profile.name} to do...`
            }
         />
      </Box>
   );
}

function renderSkillsPanel(
   state: AppState,
   contentHeight: number,
   width: number
): React.JSX.Element {
   const selectedSkill = state.suggestedSkills[state.selectedSkillIndex];
   const visibleOptionCount = Math.max(3, Math.min(6, contentHeight - 8));

   return (
      <Box flexDirection="column" gap={2} height={contentHeight}>
         {state.suggestedSkills.length === 0 ? (
            <StatusMessage variant="info">
               No suggested skills match the selected profile and task yet.
            </StatusMessage>
         ) : (
            <Select
               isDisabled={state.focus !== "skills"}
               key={`skills-${state.skillSelectNonce}-${state.selectedSkillIndex}`}
               onChange={() => {}}
               options={state.suggestedSkills.map((skill) => ({
                  label: `${state.manualSkillNames.includes(skill.name) ? "[x]" : "[ ]"} ${skill.name}  ${skill.scope}`,
                  value: skill.name
               }))}
               visibleOptionCount={visibleOptionCount}
               {...(typeof selectedSkill?.name === "string"
                  ? { defaultValue: selectedSkill.name }
                  : {})}
            />
         )}
         {selectedSkill !== undefined ? (
            <Alert title={selectedSkill.name} variant="info">
               {selectedSkill.description}
            </Alert>
         ) : undefined}
         <Box flexDirection="column" gap={1}>
            <Text bold color="cyan">
               Active skills
            </Text>
            <Box gap={1}>
               {state.activeSkills.length === 0 ? (
                  <Text dimColor>None</Text>
               ) : (
                  state.activeSkills.map((skill) => (
                     <StatusBadge key={skill.name} label={skill.name} tone="success" />
                  ))
               )}
            </Box>
         </Box>
         <StyledLinesPane
            height={Math.max(4, contentHeight - visibleOptionCount - 8)}
            isFocused={state.focus === "content"}
            lines={[
               {
                  style: "dim",
                  text: "Use Enter or Space to toggle the highlighted skill."
               }
            ]}
            noBorder
            width={width}
         />
      </Box>
   );
}

function renderHistoryPanel(
   state: AppState,
   contentHeight: number,
   width: number
): React.JSX.Element {
   const selectedRun = getSelectedHistoryRun(state);
   const visibleRuns = getVisibleHistoryRuns(state);
   const statusVariant =
      state.runFilter === "active"
         ? "warning"
         : state.runFilter === "historic"
           ? "info"
           : "success";

   return (
      <Box flexDirection="column" gap={2} height={contentHeight}>
         {state.historyRuns.length === 0 ? (
            <StatusMessage variant="info">No runs found yet.</StatusMessage>
         ) : (
            <StatusMessage variant={statusVariant}>
               Runs filter: {getRunFilterLabel(state.runFilter)}
            </StatusMessage>
         )}
         <StyledLinesPane
            height={Math.max(6, contentHeight - 6)}
            isFocused={state.focus === "history"}
            lines={buildRunsTableLines({
               rows: visibleRuns,
               selectedIndex: state.historyIndex,
               width: width
            })}
            noBorder
            title="Runs"
            width={width}
         />
         {selectedRun !== undefined ? (
            <Text dimColor>
               Enter opens {selectedRun.runId}. e reuses its task.
            </Text>
         ) : (
            <Text dimColor>Press f to switch active, historic, and all.</Text>
         )}
      </Box>
   );
}

function renderRunPanel(
   state: AppState,
   contentHeight: number,
   width: number
): React.JSX.Element {
   const statusVariant =
      state.runResult?.status === "error"
         ? "error"
         : state.runStopping
           ? "warning"
           : state.running
             ? "info"
             : "success";

   return (
      <Box flexDirection="column" gap={2} height={contentHeight}>
         {state.running ? <Spinner label="Running profile" /> : undefined}
         <StatusMessage variant={statusVariant}>
            {state.running
               ? `Run in progress${typeof state.runId === "string" ? ` (${state.runId})` : ""}.`
               : state.runResult !== undefined
                 ? `Run ${state.runResult.status}: ${state.runResult.runId}`
                 : "No active run."}
         </StatusMessage>
         <StyledLinesPane
            height={Math.max(4, Math.floor(contentHeight * 0.5))}
            isFocused={state.focus === "content"}
            lines={buildLogsLines(state, width)}
            noBorder
            title="Recent Output"
            width={width}
         />
         <StyledLinesPane
            height={Math.max(
               4,
               contentHeight - Math.max(4, Math.floor(contentHeight * 0.5)) - 4
            )}
            isFocused={state.focus === "content"}
            lines={buildRunMetadataLines(state, width)}
            noBorder
            title="State"
            width={width}
         />
      </Box>
   );
}

function renderScrollableContent(
   state: AppState,
   lines: StyledLine[],
   title: string
): React.JSX.Element {
   const { contentHeight, mainWidth } = getPaneDimensions(state);

   return (
      <StyledLinesPane
         height={contentHeight}
         isFocused={state.focus === "content"}
         lines={lines}
         noBorder
         offset={state.scrollOffset}
         title={title}
         width={mainWidth}
      />
   );
}

function MainApp(): React.JSX.Element {
   const { exit } = useApp();
   const [, forceRender] = useReducer((value) => value + 1, 0);
   const stateRef = useRef(createInitialState());
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

   const refreshSuggestions = () => {
      void refreshSkillSelection(stateRef.current).then(rerender);
   };

   const refresh = async () => {
      if (refreshInFlightRef.current) {
         refreshQueuedRef.current = true;
         return;
      }

      refreshInFlightRef.current = true;

      try {
         const currentState = stateRef.current;
         const projectRoot = getProjectPaths().projectRoot;
         currentState.projectContext = await loadProjectContext(projectRoot);
         try {
            const files = await readdir(projectRoot);
            currentState.projectFiles = files;
            currentState.hasAgentsMd = files.some(f => f.toLowerCase() === "agents.md");
         } catch {
            currentState.projectFiles = [];
            currentState.hasAgentsMd = false;
         }
         await refreshProfileCatalog(currentState);
         currentState.totalAgents = currentState.profiles.length;
         const skills = await listSkills(getProjectPaths());
         currentState.totalSkills = skills.length;
         await refreshHistory(currentState);
         await refreshSkillSelection(currentState);

         if (typeof currentState.runId === "string") {
            await refreshCurrentRun(currentState);
         }
      } catch (error) {
         setNotice(
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

   const startRun = () => {
      const currentState = stateRef.current;
      const profile = getCurrentProfile(currentState);

      if (profile === undefined) {
         setNotice(currentState, "No profile selected.", "warning");
         rerender();
         return;
      }

      if (currentState.task.trim().length === 0) {
         setNotice(currentState, "Task is required before launch.", "warning");
         rerender();
         return;
      }

      if (currentState.running) {
         setCurrentView(currentState, "run");
         rerender();
         return;
      }

      currentState.running = true;
      currentState.runStopping = false;
      currentState.liveLogs = "";
      currentState.runId = undefined;
      currentState.currentRun = undefined;
      currentState.runResult = undefined;
      currentState.promptText = "";
      setCurrentView(currentState, "run");
      setNotice(currentState, `Starting ${profile.name}...`, "warning");
      rerender();

      void runAgent({
         cwd: getProjectPaths().projectRoot,
         onRunOutput: (chunk) => {
            const activeState = stateRef.current;
            activeState.liveLogs = trimLogBuffer(
               `${activeState.liveLogs}${chunk.stream === "stderr" ? "[stderr] " : ""}${chunk.text}`
            );
            rerender();
         },
         onRunStarted: async (started) => {
            const activeState = stateRef.current;
            activeState.runId = started.runId;
            await refreshCurrentRun(activeState);
            setNotice(
               activeState,
               `Running ${started.profile} (${started.runId}).`,
               "success"
            );
            rerender();
         },
         profileName: profile.id,
         ...(profile.isBuiltIn === true ? {} : { profileScope: profile.scope }),
         selectedSkillNames: currentState.manualSkillNames,
         task: currentState.task
      })
         .then(async (result) => {
            const activeState = stateRef.current;
            activeState.running = false;
            activeState.runStopping = false;
            activeState.runResult = result;
            activeState.runId = result.runId;
            await refreshCurrentRun(activeState);
            await refreshHistory(activeState);
            setCurrentView(
               activeState,
               result.status === "success" ? "answer" : "run"
            );
            setNotice(
               activeState,
               result.status === "success"
                  ? `Run finished: ${result.runId}`
                  : `Run failed: ${result.runId}`,
               result.status === "success" ? "success" : "error"
            );
            rerender();
         })
         .catch((error) => {
            const activeState = stateRef.current;
            activeState.running = false;
            activeState.runStopping = false;
            setNotice(
               activeState,
               error instanceof Error ? error.message : String(error),
               "error"
            );
            rerender();
         });
   };

   const stopActiveRun = async () => {
      const currentState = stateRef.current;
      if (!currentState.running || typeof currentState.runId !== "string") {
         setNotice(currentState, "No active run to stop.", "warning");
         rerender();
         return;
      }

      currentState.runStopping = true;
      setNotice(currentState, `Stopping ${currentState.runId}...`, "warning");
      rerender();

      try {
         await stopRun(currentState.runId);
         setNotice(
            currentState,
            `Stop requested for ${currentState.runId}.`,
            "warning"
         );
      } catch (error) {
         setNotice(
            currentState,
            error instanceof Error ? error.message : String(error),
            "error"
         );
      }

      rerender();
   };

   const openHistorySelection = async () => {
      const currentState = stateRef.current;
      const run = getSelectedHistoryRun(currentState);

      if (run === undefined) {
         setNotice(currentState, "No history item selected.", "warning");
         rerender();
         return;
      }

      currentState.runId = run.runId;
      await refreshCurrentRun(currentState);
      setCurrentView(currentState, "details");
      setNotice(currentState, `Opened ${run.runId}.`, "success");
      rerender();
   };

   const reuseSelectedHistoryRun = async () => {
      const currentState = stateRef.current;
      const run = getSelectedHistoryRun(currentState);

      if (run === undefined) {
         setNotice(currentState, "No history item selected.", "warning");
         rerender();
         return;
      }

      if (typeof run.launch.task !== "string" || run.launch.task.trim().length === 0) {
         setNotice(
            currentState,
            "This run does not include a reusable task.",
            "warning"
         );
         rerender();
         return;
      }

      const matchingProfileIndex = currentState.profiles.findIndex(
         (profile) =>
            profile.name === (run.profile ?? run.agent) &&
            (profile.isBuiltIn === true ||
               profile.scope === (run.profileScope ?? run.agentScope))
      );

      if (matchingProfileIndex >= 0) {
         currentState.selectedProfileIndex = matchingProfileIndex;
         currentState.profileSelectNonce += 1;
      }

      currentState.task = run.launch.task;
      currentState.taskInputNonce += 1;
      currentState.runId = run.runId;
      currentState.currentRun = run;
      setCurrentView(currentState, "agents");
      currentState.focus =
         matchingProfileIndex >= 0 ? "task" : getDefaultFocus(currentState);
      await refreshSkillSelection(currentState);
      setNotice(currentState, `Loaded task from ${run.runId}.`, "success");
      rerender();
   };

   const toggleSelectedSkill = async () => {
      const currentState = stateRef.current;
      const skill = currentState.suggestedSkills[currentState.selectedSkillIndex];

      if (skill === undefined) {
         return;
      }

      if (currentState.manualSkillNames.includes(skill.name)) {
         currentState.manualSkillNames = currentState.manualSkillNames.filter(
            (name) => name !== skill.name
         );
      } else {
         currentState.manualSkillNames = [
            ...currentState.manualSkillNames,
            skill.name
         ];
      }

      await refreshSkillSelection(currentState);
      rerender();
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

   useInput((input, key) => {
      const currentState = stateRef.current;

      if (key.ctrl && input === "c") {
         if (currentState.running) {
            void stopActiveRun();
            return;
         }

         exit();
         return;
      }

      if (key.tab) {
         cycleFocus(currentState, key.shift ? -1 : 1);
         rerender();
         return;
      }

      if (currentState.focus !== "task") {
         const globalView = getGlobalViewHotkey(input);
         if (globalView !== undefined) {
            setCurrentView(currentState, globalView.view);
            if (
               globalView.focus === "profile" &&
               currentState.profiles.length > 0
            ) {
               currentState.focus = "profile";
            } else if (
               globalView.focus === "task" &&
               getCurrentProfile(currentState) !== undefined
            ) {
               currentState.focus = "task";
            }
            rerender();
            return;
         }

         if (input === "i" && currentState.currentRun !== undefined) {
            setCurrentView(currentState, "details");
            rerender();
            return;
         }

         if (input === "o" && currentState.currentRun !== undefined) {
            setCurrentView(currentState, "answer");
            rerender();
            return;
         }

         if (input === "l" && currentState.currentRun !== undefined) {
            setCurrentView(currentState, "logs");
            rerender();
            return;
         }

         if (input === "p" && currentState.currentRun !== undefined) {
            setCurrentView(currentState, "prompt");
            rerender();
            return;
         }
      }

      if (key.escape) {
         if (goBack(currentState)) {
            rerender();
            return;
         }

         if (currentState.focus !== "nav") {
            currentState.focus = "nav";
            rerender();
            return;
         }

         if (currentState.currentView !== "home") {
            setCurrentView(currentState, "home", true, false);
            rerender();
            return;
         }
      }

      if (currentState.focus !== "task" && input === "q") {
         if (currentState.running) {
            setNotice(
               currentState,
               "A run is still active. Stop it before quitting the app.",
               "warning"
            );
            rerender();
            return;
         }

         exit();
         return;
      }

      if (input === "s" && currentState.focus !== "task") {
         void stopActiveRun();
         return;
      }

      if (
         input === "f" &&
         currentState.focus !== "task" &&
         currentState.currentView === "history"
      ) {
         currentState.runFilter = cycleRunFilter(currentState.runFilter);
         clampHistorySelection(currentState);
         rerender();
         return;
      }

      if (currentState.focus === "nav") {
         const currentIndex = viewOrder.indexOf(currentState.currentView);

         if (key.leftArrow) {
            const nextIndex = clamp(currentIndex - 1, 0, viewOrder.length - 1);
            setCurrentView(currentState, viewOrder[nextIndex] ?? "home", true);
            rerender();
            return;
         }

         if (key.rightArrow) {
            const nextIndex = clamp(currentIndex + 1, 0, viewOrder.length - 1);
            setCurrentView(currentState, viewOrder[nextIndex] ?? "details", true);
            rerender();
            return;
         }

         if (key.return) {
            currentState.focus = getDefaultFocus(currentState);
            rerender();
         }

         return;
      }

      if (
         currentState.focus === "profile" ||
         currentState.focus === "history" ||
         currentState.focus === "skills"
      ) {
         if (input === "j") {
            moveSelectableIndex(currentState, 1, currentState.focus);
            if (currentState.focus === "profile") {
               refreshSuggestions();
            }
            rerender();
            return;
         }

         if (input === "k") {
            moveSelectableIndex(currentState, -1, currentState.focus);
            if (currentState.focus === "profile") {
               refreshSuggestions();
            }
            rerender();
            return;
         }

        if (currentState.focus === "profile" && key.return) {
            currentState.focus = "task";
            rerender();
            return;
         }

         if (currentState.focus === "history" && key.return) {
            void openHistorySelection();
            return;
         }

         if (currentState.focus === "history" && input === "e") {
            void reuseSelectedHistoryRun();
            return;
         }

         if (currentState.focus === "skills" && (key.return || input === " ")) {
            void toggleSelectedSkill();
            return;
         }

         return;
      }

      if (currentState.focus === "content") {
         const delta =
            key.downArrow || input === "j"
               ? 1
               : key.upArrow || input === "k"
                 ? -1
                 : key.pageDown || input === " "
                   ? Math.max(1, currentState.terminalHeight - 12)
                   : key.pageUp
                     ? -Math.max(1, currentState.terminalHeight - 12)
                     : 0;

         if (delta !== 0) {
            currentState.scrollOffset = Math.max(
               0,
               currentState.scrollOffset + delta
            );
            rerender();
         }
      }
   });

   const dimensions = getPaneDimensions(state);

   const globalHotkeys = [
      { key: "g", label: "home" },
      { key: "a", label: "agents" },
      { key: "t", label: "task" },
      { key: "r", label: "runs" },
      { key: "q", label: "exit" },
      { key: "esc", label: "back" }
   ];

   const viewHotkeys =
      state.currentView === "home"
         ? []
         : state.currentView === "agents"
           ? [
                { key: "j/k", label: "move" },
                { key: "enter", label: "task input" },
                { key: "tab", label: "toggle focus" }
             ]
         : state.currentView === "history"
           ? [
                { key: "j/k", label: "move" },
                { key: "f", label: "filter" },
                { key: "e", label: "reuse text" },
                { key: "enter", label: "inspect run" }
             ]
         : state.currentView === "details"
           ? [
                { key: "j/k", label: "scroll" },
                { key: "o", label: "answer" },
                { key: "l", label: "logs" },
                { key: "p", label: "prompt" }
             ]
         : state.currentView === "answer"
           ? [
                { key: "j/k", label: "scroll" },
                { key: "i", label: "details" },
                { key: "l", label: "logs" },
                { key: "p", label: "prompt" }
             ]
         : state.currentView === "logs"
           ? [
                { key: "j/k", label: "scroll" },
                { key: "i", label: "details" },
                { key: "o", label: "answer" },
                { key: "p", label: "prompt" }
             ]
         : state.currentView === "prompt"
           ? [
                { key: "j/k", label: "scroll" },
                { key: "i", label: "details" },
                { key: "o", label: "answer" },
                { key: "l", label: "logs" }
             ]
         : state.currentView === "run"
           ? [
                { key: "s", label: "stop" },
                { key: "i", label: "details" },
                { key: "l", label: "logs" },
                { key: "o", label: "answer" }
             ]
         : [];

   const hotkeys = [...globalHotkeys, ...viewHotkeys];

   let primaryPane: React.JSX.Element;

   switch (state.currentView) {
      case "home":
         primaryPane = renderHomePanel(
            state,
            dimensions.contentHeight,
            dimensions.mainWidth
         );
         break;
      case "agents":
         primaryPane = renderAgentsPanel(
            state,
            dimensions.contentHeight,
            dimensions.mainWidth,
            () => {
               startRun();
            },
            refreshSuggestions
         );
         break;
      case "skills":
         primaryPane = renderSkillsPanel(
            state,
            dimensions.contentHeight,
            dimensions.mainWidth
         );
         break;
      case "history":
         primaryPane = renderHistoryPanel(
            state,
            dimensions.contentHeight,
            dimensions.mainWidth
         );
         break;
      case "run":
         primaryPane = renderRunPanel(
            state,
            dimensions.contentHeight,
            dimensions.mainWidth
         );
         break;
      case "answer":
         primaryPane = renderScrollableContent(
            state,
            buildAnswerLines(state, dimensions.mainWidth),
            "Final Answer"
         );
         break;
      case "logs":
         primaryPane = renderScrollableContent(
            state,
            buildLogsLines(state, dimensions.mainWidth),
            "Logs"
         );
         break;
      case "prompt":
         primaryPane = renderScrollableContent(
            state,
            buildPromptLines(state.promptText, dimensions.mainWidth),
            "Prompt"
         );
         break;
      case "details":
         primaryPane = renderScrollableContent(
            state,
            buildDetailsLines(state, dimensions.mainWidth),
            "Run Details"
         );
         break;
   }

   return (
      <AimanThemeProvider>
         <AppLayout
            footer={
               <AppStatusLine
                  message={state.footerNotice?.text}
                  tone={state.footerNotice?.style}
               />
            }
            header={renderHeader(state, hotkeys)}
         >
            <Box flexDirection="column" gap={1} flexGrow={1}>
               <Box width={dimensions.mainWidth}>{primaryPane}</Box>
            </Box>
         </AppLayout>
      </AimanThemeProvider>
   );
}

export async function openAimanApp(): Promise<void> {
   if (!process.stdout.isTTY || !process.stdin.isTTY) {
      throw new UserError("`aiman` requires an interactive TTY.");
   }

   await runInkScreen(<MainApp />);
}
