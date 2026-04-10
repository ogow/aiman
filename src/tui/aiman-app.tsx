import { startTransition, useEffect, useRef, useState } from "react";

import {
  CliRenderEvents,
  createCliRenderer,
  type CliRenderer
} from "@opentui/core";
import {
  createRoot,
  useKeyboard,
  useRenderer,
  useTerminalDimensions
} from "@opentui/react";

import { UserError } from "../lib/errors.js";
import { getProjectPaths, type ProjectPaths } from "../lib/paths.js";
import { loadAimanConfig } from "../lib/config.js";
import { listAgents } from "../lib/agents.js";
import { loadProjectContext } from "../lib/project-context.js";
import { readRunOutput } from "../lib/run-output.js";
import { listRuns, readRunLog, runAgent, stopRun } from "../lib/runs.js";
import type {
  ProjectContext,
  RunInspection,
  RunResult,
  ScopedProfileDefinition
} from "../lib/types.js";
import type {
  AppNotice,
  FocusRegion,
  RunDetailTab,
  Workspace
} from "./workbench-model.js";
import {
  buildAnswerContent,
  buildProfileSummary,
  buildRunSummary,
  detailTabOptions,
  getProjectTitle,
  getSelectedRun,
  runStatusAnimationFrameCount,
  startFocusOrder,
  agentsFocusOrder,
  tasksFocusOrder,
  runsFocusOrder,
  sortRunsForWorkbench,
  trimLiveOutput
} from "./workbench-model.js";
import { renderOutputSections, renderRunActivity } from "./run-activity.js";
import { WorkbenchShell } from "./workbench-shell.js";
import {
  AgentsWorkspace,
  RunsWorkspace,
  StartWorkspace,
  TasksWorkspace
} from "./workbench-workspaces.js";

type RunAgentInput = Parameters<typeof runAgent>[0];
type RunStream = "stderr" | "stdout";
type LiveRunOutput = {
  runId?: string;
  stderr: string;
  stdout: string;
};

export type WorkbenchServices = {
  listProfiles: (
    projectPaths: ProjectPaths
  ) => Promise<ScopedProfileDefinition[]>;
  listRuns: () => Promise<RunInspection[]>;
  loadProjectContext: (
    projectRoot: string
  ) => Promise<ProjectContext | undefined>;
  readRunLog: typeof readRunLog;
  readRunOutput: typeof readRunOutput;
  runAgent: (input: RunAgentInput) => Promise<RunResult>;
  stopRun: typeof stopRun;
};

export type AimanWorkbenchProps = {
  projectPaths: ProjectPaths;
  services?: Partial<WorkbenchServices>;
};

export type OpenAimanAppOptions = {
  projectPaths?: ProjectPaths;
  services?: Partial<WorkbenchServices>;
};

const refreshIntervalMs = 1000;
const runAnimationIntervalMs = 250;
const detailLogLines = 160;

const defaultServices: WorkbenchServices = {
  async listProfiles(projectPaths) {
    await loadAimanConfig(projectPaths);
    return listAgents(projectPaths);
  },
  async listRuns() {
    return listRuns({ filter: "all" });
  },
  loadProjectContext,
  readRunLog,
  readRunOutput,
  runAgent,
  stopRun
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createEmptyLiveRunOutput(runId?: string): LiveRunOutput {
  return {
    ...(runId !== undefined ? { runId } : {}),
    stderr: "",
    stdout: ""
  };
}

function appendLiveRunOutput(input: {
  currentValue: LiveRunOutput;
  runId: string;
  stream: RunStream;
  text: string;
}): LiveRunOutput {
  const baseValue =
    input.currentValue.runId === input.runId
      ? input.currentValue
      : createEmptyLiveRunOutput(input.runId);
  const nextValue = `${baseValue[input.stream]}${input.text}`;

  return {
    ...baseValue,
    runId: input.runId,
    [input.stream]: trimLiveOutput(nextValue)
  };
}

async function loadRunStreamOutput(input: {
  liveOutput: LiveRunOutput;
  run: RunInspection;
  services: WorkbenchServices;
}): Promise<{ stderr: string; stdout: string }> {
  if (
    input.liveOutput.runId === input.run.runId &&
    (input.liveOutput.stdout.length > 0 || input.liveOutput.stderr.length > 0)
  ) {
    return {
      stderr: input.liveOutput.stderr,
      stdout: input.liveOutput.stdout
    };
  }

  const [stdout, stderr] = await Promise.all([
    input.services.readRunOutput(input.run.runId, "stdout", detailLogLines),
    input.services.readRunOutput(input.run.runId, "stderr", detailLogLines)
  ]);

  return { stderr, stdout };
}

function getDefaultFocusRegion(workspace: Workspace): FocusRegion {
  switch (workspace) {
    case "start":
      return "startPane";
    case "agents":
      return "profileList";
    case "tasks":
      return "profileList";
    case "runs":
      return "runList";
  }
}

function getFocusOrder(workspace: Workspace): FocusRegion[] {
  switch (workspace) {
    case "start":
      return startFocusOrder;
    case "agents":
      return agentsFocusOrder;
    case "tasks":
      return tasksFocusOrder;
    case "runs":
      return runsFocusOrder;
  }
}

async function waitForRendererDestroy(renderer: CliRenderer): Promise<void> {
  if (renderer.isDestroyed) {
    return;
  }
  await new Promise<void>((resolve) => {
    renderer.once(CliRenderEvents.DESTROY, () => {
      resolve();
    });
  });
}

async function loadDetailBody(input: {
  detailTab: RunDetailTab;
  liveOutput: LiveRunOutput;
  run: RunInspection | undefined;
  services: WorkbenchServices;
}): Promise<string> {
  if (input.run === undefined) {
    return "Select a run to inspect it.";
  }
  switch (input.detailTab) {
    case "summary":
      return buildRunSummary(input.run);
    case "answer":
      return buildAnswerContent(input.run);
    case "activity": {
      const output = await loadRunStreamOutput({
        liveOutput: input.liveOutput,
        run: input.run,
        services: input.services
      });
      const activity = renderRunActivity({
        provider: input.run.provider,
        status: input.run.status,
        stderr: output.stderr,
        stdout: output.stdout
      });
      if (activity.trim().length > 0) return activity;
      return input.run.status === "running"
        ? "Run is active but has not emitted any activity yet."
        : "No provider activity was recorded for this run.";
    }
    case "raw": {
      const output = await loadRunStreamOutput({
        liveOutput: input.liveOutput,
        run: input.run,
        services: input.services
      });
      const renderedOutput = renderOutputSections(output);
      if (renderedOutput.trim().length > 0) return renderedOutput;
      return input.run.status === "running"
        ? "Run is active but has not written any logs yet."
        : "No stdout or stderr logs were recorded for this run.";
    }
    case "prompt":
      return input.services.readRunLog(input.run.runId, "prompt");
  }
}

function resolveNextRunId(
  currentRunId: string | undefined,
  runs: RunInspection[]
): string | undefined {
  if (runs.length === 0) return undefined;
  if (typeof currentRunId === "string") {
    const stillExists = runs.some((run) => run.runId === currentRunId);
    if (stillExists) return currentRunId;
  }
  return runs[0]?.runId;
}

function setTaskEditorValue(input: {
  setTaskDraft: (value: string) => void;
  value: string;
}): void {
  input.setTaskDraft(input.value);
}

function isPrintableTaskKey(input: {
  ctrl: boolean;
  hyper?: boolean;
  meta: boolean;
  name: string;
  option: boolean;
  sequence: string;
  super?: boolean;
}): boolean {
  if (
    input.ctrl ||
    input.meta ||
    input.option ||
    input.super === true ||
    input.hyper === true
  ) {
    return false;
  }

  if (
    input.sequence.length === 0 &&
    input.name !== "space" &&
    input.name.length !== 1
  ) {
    return false;
  }

  const candidate =
    input.sequence.length > 0
      ? input.sequence
      : input.name === "space"
        ? " "
        : input.name;

  return ![...candidate].some((character) => {
    const codePoint = character.codePointAt(0);

    return (
      typeof codePoint === "number" && (codePoint <= 0x1f || codePoint === 0x7f)
    );
  });
}

function getTaskKeyText(input: { name: string; sequence: string }): string {
  if (input.sequence.length > 0) {
    return input.sequence;
  }

  if (input.name === "space") {
    return " ";
  }

  return input.name.length === 1 ? input.name : "";
}

export function AimanWorkbench(props: AimanWorkbenchProps) {
  const services: WorkbenchServices = { ...defaultServices, ...props.services };
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const refreshRunsInFlightRef = useRef(false);
  const [workspace, setWorkspace] = useState<Workspace>("start");
  const [focusRegion, setFocusRegion] = useState<FocusRegion>("startPane");
  const [profiles, setProfiles] = useState<ScopedProfileDefinition[]>([]);
  const [projectContext, setProjectContext] = useState<
    ProjectContext | undefined
  >();
  const [selectedProfileIndex, setSelectedProfileIndex] = useState(0);
  const [taskDraft, setTaskDraft] = useState("");
  const [runs, setRuns] = useState<RunInspection[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [runFilterText, setRunFilterText] = useState("");
  const [detailTab, setDetailTab] = useState<RunDetailTab>("summary");
  const [detailBody, setDetailBody] = useState("Loading runs…");
  const [detailLoading, setDetailLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [refreshingRuns, setRefreshingRuns] = useState(false);
  const [stoppingRunId, setStoppingRunId] = useState<string | undefined>();
  const [notice, setNotice] = useState<AppNotice | undefined>();
  const [liveOutput, setLiveOutput] = useState<LiveRunOutput>(
    createEmptyLiveRunOutput()
  );
  const [runAnimationFrame, setRunAnimationFrame] = useState(0);
  const projectTitle = getProjectTitle(props.projectPaths.projectRoot);
  const selectedProfile = profiles[selectedProfileIndex];

  const filteredRuns = runs.filter((run) => {
    if (runFilterText.length === 0) return true;
    const search = runFilterText.toLowerCase();
    return (
      run.runId.toLowerCase().includes(search) ||
      run.agent.toLowerCase().includes(search) ||
      (run.projectRoot ?? "").toLowerCase().includes(search) ||
      run.status.toLowerCase().includes(search) ||
      run.provider.toLowerCase().includes(search)
    );
  });

  const selectedRun = getSelectedRun(filteredRuns, selectedRunId);

  const setWorkspaceState = (
    nextWorkspace: Workspace,
    nextFocus?: FocusRegion
  ) => {
    startTransition(() => {
      setWorkspace(nextWorkspace);
      setFocusRegion(nextFocus ?? getDefaultFocusRegion(nextWorkspace));
    });
  };

  const cycleFocus = (direction: 1 | -1) => {
    const order = getFocusOrder(workspace);
    const currentIndex = order.indexOf(focusRegion);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;

    // In our drill-down model, index 0 is always the "List View" (top level).
    // Indices 1+ are the "Detail/Sub View" (drilled-in level).
    const isAtTopLevel = safeIndex === 0;

    if (isAtTopLevel) {
      // Tab does nothing at the top level list. Use Enter to drill down.
      return;
    }

    // We are in a sub-view (index 1+). Tab should only cycle between other sub-view regions.
    let nextIndex = (safeIndex + direction + order.length) % order.length;

    // If Tab tries to go back to the top-level list (index 0), skip it and wrap around the sub-views.
    if (nextIndex === 0) {
      nextIndex = direction === 1 ? 1 : order.length - 1;
    }

    const nextRegion = order[nextIndex];
    if (typeof nextRegion === "string") {
      setFocusRegion(nextRegion);
    }
  };

  const refreshProfilesAndContext = async () => {
    try {
      const [nextProfiles, nextContext] = await Promise.all([
        services.listProfiles(props.projectPaths),
        services.loadProjectContext(props.projectPaths.projectRoot)
      ]);
      startTransition(() => {
        setProfiles(nextProfiles);
        setProjectContext(nextContext);
        setSelectedProfileIndex((currentIndex) =>
          Math.min(currentIndex, Math.max(0, nextProfiles.length - 1))
        );
      });
    } catch (error) {
      setNotice({ text: getErrorMessage(error), tone: "error" });
    }
  };

  const refreshRuns = async (silent = false) => {
    if (refreshRunsInFlightRef.current) return;
    refreshRunsInFlightRef.current = true;
    if (!silent) setRefreshingRuns(true);
    try {
      const nextRuns = sortRunsForWorkbench(await services.listRuns());
      startTransition(() => {
        setRuns(nextRuns);
        setSelectedRunId((currentRunId) =>
          resolveNextRunId(currentRunId, nextRuns)
        );
      });
    } catch (error) {
      if (!silent) setNotice({ text: getErrorMessage(error), tone: "error" });
    } finally {
      refreshRunsInFlightRef.current = false;
      if (!silent) setRefreshingRuns(false);
    }
  };

  const launchSelectedProfile = async () => {
    if (selectedProfile === undefined) {
      setNotice({ text: "No agent is available to launch.", tone: "error" });
      return;
    }
    const task = taskDraft.trim();
    if (task.length === 0) {
      setNotice({
        text: "Enter a task before launching the selected agent.",
        tone: "error"
      });
      return;
    }
    setLaunching(true);
    setNotice({ text: `Launching ${selectedProfile.name}…`, tone: "info" });
    setLiveOutput(createEmptyLiveRunOutput());
    let liveRunId: string | undefined;

    try {
      const result = await services.runAgent({
        profileName: selectedProfile.name,
        profileScope: selectedProfile.scope,
        onRunOutput: ({ stream, text }) => {
          const currentRunId = liveRunId;
          if (typeof currentRunId !== "string") {
            return;
          }

          setLiveOutput((currentValue) =>
            appendLiveRunOutput({
              currentValue,
              runId: currentRunId,
              stream,
              text
            })
          );
        },
        onRunStarted: ({ agent, runId }) => {
          liveRunId = runId;
          startTransition(() => {
            setLiveOutput(createEmptyLiveRunOutput(runId));
            setSelectedRunId(runId);
            setDetailTab("activity");
            setWorkspace("runs");
            setFocusRegion("detailPane");
            setNotice({
              text: `Running ${agent} in the workbench…`,
              tone: "info"
            });
          });
        },
        task
      });

      setNotice({
        text:
          result.status === "success"
            ? `Run ${result.runId} finished successfully.`
            : `Run ${result.runId} finished with ${result.status}.`,
        tone: result.status === "success" ? "success" : "error"
      });

      if (result.status === "success") {
        setTaskEditorValue({ setTaskDraft, value: "" });
      }

      startTransition(() => {
        setDetailTab(result.status === "success" ? "answer" : "activity");
        setSelectedRunId(result.runId);
        setWorkspace("runs");
        setFocusRegion("detailPane");
      });
      await refreshRuns();
    } catch (error) {
      setNotice({ text: getErrorMessage(error), tone: "error" });
    } finally {
      setLaunching(false);
      setLiveOutput(createEmptyLiveRunOutput());
    }
  };

  const stopSelectedRun = async () => {
    if (selectedRun === undefined) {
      setNotice({
        text: "Select a run before requesting stop.",
        tone: "error"
      });
      return;
    }
    if (selectedRun.active !== true || selectedRun.status !== "running") {
      setNotice({ text: "The selected run is not active.", tone: "error" });
      return;
    }
    setStoppingRunId(selectedRun.runId);
    setNotice({
      text: `Requesting stop for ${selectedRun.runId}…`,
      tone: "info"
    });

    try {
      await services.stopRun(selectedRun.runId);
      setNotice({
        text: `Stop requested for ${selectedRun.runId}.`,
        tone: "success"
      });
      await refreshRuns();
    } catch (error) {
      setNotice({ text: getErrorMessage(error), tone: "error" });
    } finally {
      setStoppingRunId(undefined);
    }
  };

  useEffect(() => {
    void Promise.all([refreshProfilesAndContext(), refreshRuns()]);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshRuns(true);
    }, refreshIntervalMs);
    return () => {
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!runs.some((run) => run.active)) {
      setRunAnimationFrame(0);
      return;
    }

    const interval = setInterval(() => {
      setRunAnimationFrame(
        (currentFrame) => (currentFrame + 1) % runStatusAnimationFrameCount
      );
    }, runAnimationIntervalMs);

    return () => {
      clearInterval(interval);
    };
  }, [runs]);

  useEffect(() => {
    setSelectedRunId((currentRunId) => resolveNextRunId(currentRunId, runs));
  }, [runs]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setDetailLoading(true);
      try {
        const nextBody = await loadDetailBody({
          detailTab,
          liveOutput,
          run: selectedRun,
          services
        });
        if (!cancelled) setDetailBody(nextBody);
      } catch (error) {
        if (!cancelled) setDetailBody(getErrorMessage(error));
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    detailTab,
    liveOutput.runId,
    liveOutput.stderr,
    liveOutput.stdout,
    selectedRun?.runId,
    selectedRun?.status,
    runs
  ]);

  useKeyboard((key) => {
    if (workspace === "runs" && focusRegion === "runFilter") {
      if (key.name === "backspace") {
        setRunFilterText((v) => v.slice(0, -1));
        return;
      }
      if (
        key.name === "escape" ||
        key.name === "enter" ||
        key.name === "return"
      ) {
        setFocusRegion("runList");
        return;
      }
      if (
        isPrintableTaskKey({
          ctrl: key.ctrl,
          meta: key.meta,
          name: key.name,
          option: key.option,
          sequence: key.sequence,
          ...(key.hyper !== undefined ? { hyper: key.hyper } : {}),
          ...(key.super !== undefined ? { super: key.super } : {})
        })
      ) {
        const char = getTaskKeyText({ name: key.name, sequence: key.sequence });
        setRunFilterText((v) => v + char);
        return;
      }
    }

    if (workspace === "tasks" && focusRegion === "taskEditor") {
      if (key.name === "backspace") {
        setTaskDraft((currentValue) => currentValue.slice(0, -1));
        return;
      }

      if (
        (key.name === "enter" || key.name === "return") &&
        !key.ctrl &&
        !key.meta
      ) {
        setTaskDraft((currentValue) => `${currentValue}\n`);
        return;
      }

      if (
        isPrintableTaskKey({
          ctrl: key.ctrl,
          meta: key.meta,
          name: key.name,
          option: key.option,
          sequence: key.sequence,
          ...(key.hyper !== undefined ? { hyper: key.hyper } : {}),
          ...(key.super !== undefined ? { super: key.super } : {})
        })
      ) {
        const nextText = getTaskKeyText({
          name: key.name,
          sequence: key.sequence
        });
        setTaskDraft((currentValue) => `${currentValue}${nextText}`);
        return;
      }
    }

    if (key.ctrl && key.name === "c") {
      renderer.destroy();
      return;
    }

    if (key.name === "q" && focusRegion !== "taskEditor") {
      renderer.destroy();
      return;
    }

    if (key.name === "tab") {
      cycleFocus(key.shift ? -1 : 1);
      return;
    }

    if (
      focusRegion === "detailTabs" &&
      (key.name === "left" || key.name === "right")
    ) {
      const currentIndex = detailTabOptions.findIndex(
        (option) => option.value === detailTab
      );
      const nextIndex =
        key.name === "left"
          ? (currentIndex + detailTabOptions.length - 1) %
            detailTabOptions.length
          : (currentIndex + 1) % detailTabOptions.length;
      const nextTab = detailTabOptions[nextIndex]?.value;
      if (
        nextTab === "summary" ||
        nextTab === "answer" ||
        nextTab === "activity" ||
        nextTab === "raw" ||
        nextTab === "prompt"
      ) {
        setDetailTab(nextTab);
      }
      return;
    }

    if (key.ctrl && key.name === "r") {
      void refreshRuns();
      return;
    }
    if (key.ctrl && key.name === "l") {
      if (workspace === "tasks") {
        void launchSelectedProfile();
      }
      return;
    }
    if (key.ctrl && key.name === "s") {
      void stopSelectedRun();
      return;
    }

    if (
      (key.name === "up" || key.name === "k") &&
      focusRegion !== "taskEditor"
    ) {
      if (focusRegion === "profileList") {
        setSelectedProfileIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (focusRegion === "runList") {
        const currentIndex = filteredRuns.findIndex(
          (r) => r.runId === selectedRunId
        );
        const nextIndex = Math.max(0, currentIndex - 1);
        setSelectedRunId(filteredRuns[nextIndex]?.runId);
        return;
      }
    }

    if (
      (key.name === "down" || key.name === "j") &&
      focusRegion !== "taskEditor" &&
      focusRegion !== "runFilter"
    ) {
      if (focusRegion === "profileList") {
        setSelectedProfileIndex((i) => Math.min(profiles.length - 1, i + 1));
        return;
      }
      if (focusRegion === "runList") {
        const currentIndex = filteredRuns.findIndex(
          (r) => r.runId === selectedRunId
        );
        const nextIndex = Math.min(filteredRuns.length - 1, currentIndex + 1);
        setSelectedRunId(filteredRuns[nextIndex]?.runId);
        return;
      }
    }

    if (
      workspace === "runs" &&
      focusRegion === "runList" &&
      (key.name === "/" || key.name === "f")
    ) {
      setFocusRegion("runFilter");
      return;
    }

    const isEnter = key.name === "enter" || key.name === "return";

    if (isEnter) {
      if (workspace === "start") {
        setWorkspaceState("agents");
        return;
      }
      if (focusRegion === "profileList") {
        if (workspace === "agents") {
          setFocusRegion("detailPane");
        } else if (workspace === "tasks") {
          setFocusRegion("taskEditor");
        }
        return;
      }
      if (focusRegion === "runList") {
        setFocusRegion("detailTabs");
        return;
      }
      if (focusRegion === "detailTabs") {
        setFocusRegion("detailPane");
        return;
      }
    }

    if (key.name === "escape") {
      setNotice(undefined);

      if (focusRegion === "runFilter") {
        setFocusRegion("runList");
        return;
      }
      if (
        workspace === "runs" &&
        focusRegion === "runList" &&
        runFilterText.length > 0
      ) {
        setRunFilterText("");
        return;
      }
      if (focusRegion === "taskEditor") {
        setFocusRegion("profileList");
        return;
      }
      if (workspace === "runs" && focusRegion === "detailPane") {
        setFocusRegion("detailTabs");
        return;
      }
      if (workspace === "runs" && focusRegion === "detailTabs") {
        setFocusRegion("runList");
        return;
      }
      if (workspace === "agents" && focusRegion === "detailPane") {
        setFocusRegion("profileList");
        return;
      }

      // If we are already at the top-level list of a workspace, go back to Start
      if (focusRegion === "profileList" || focusRegion === "runList") {
        setWorkspaceState("start");
        return;
      }

      return;
    }

    if (key.name === "s" && focusRegion !== "taskEditor") {
      setWorkspaceState("start");
      return;
    }
    if (key.name === "a" && focusRegion !== "taskEditor") {
      setWorkspaceState("agents");
      return;
    }
    if (key.name === "t" && focusRegion !== "taskEditor") {
      setWorkspaceState("tasks");
      return;
    }
    if (key.name === "r" && focusRegion !== "taskEditor") {
      setWorkspaceState("runs");
      return;
    }
  });

  return (
    <WorkbenchShell
      focusRegion={focusRegion}
      launching={launching}
      notice={notice}
      profiles={profiles}
      projectContext={projectContext}
      projectTitle={projectTitle}
      refreshingRuns={refreshingRuns}
      runs={runs}
      selectedWorkspace={workspace}
      stoppingRunId={stoppingRunId}
      onNavigate={(nextWorkspace) => setWorkspaceState(nextWorkspace)}
    >
      {workspace === "start" ? (
        <StartWorkspace
          focusRegion={focusRegion}
          projectTitle={projectTitle}
          setFocusRegion={(nextRegion) => setFocusRegion(nextRegion)}
        />
      ) : workspace === "agents" ? (
        <AgentsWorkspace
          focusRegion={focusRegion}
          profileSummary={buildProfileSummary({
            profile: selectedProfile,
            projectContext,
            projectTitle
          })}
          profiles={profiles}
          selectedProfileIndex={selectedProfileIndex}
          updateProfileIndex={(index) => setSelectedProfileIndex(index)}
          onSelectProfile={() => setFocusRegion("detailPane")}
          setFocusRegion={(nextRegion) => setFocusRegion(nextRegion)}
        />
      ) : workspace === "tasks" ? (
        <TasksWorkspace
          focusRegion={focusRegion}
          profiles={profiles}
          selectedProfileIndex={selectedProfileIndex}
          taskDraft={taskDraft}
          updateProfileIndex={(index) => setSelectedProfileIndex(index)}
          setFocusRegion={(nextRegion) => setFocusRegion(nextRegion)}
        />
      ) : (
        <RunsWorkspace
          animationFrame={runAnimationFrame}
          detailBody={detailBody}
          detailLoading={detailLoading}
          detailTab={detailTab}
          focusRegion={focusRegion}
          listWidth={Math.max(72, width - 4)}
          onFilterChange={(nextFilter) => setRunFilterText(nextFilter)}
          runFilterText={runFilterText}
          runs={filteredRuns}
          selectedRunId={selectedRunId}
          setDetailTab={(nextDetailTab) => setDetailTab(nextDetailTab)}
          setSelectedRunId={(runId) => setSelectedRunId(runId)}
          setFocusRegion={(nextRegion) => setFocusRegion(nextRegion)}
        />
      )}
    </WorkbenchShell>
  );
}

export async function openAimanApp(
  options: OpenAimanAppOptions = {}
): Promise<void> {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new UserError("`aiman` requires an interactive TTY.");
  }

  const renderer = await createCliRenderer({
    backgroundColor: "#0b1320",
    consoleMode: "disabled",
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    targetFps: 20,
    useMouse: true
  });
  const root = createRoot(renderer);

  root.render(
    <AimanWorkbench
      projectPaths={options.projectPaths ?? getProjectPaths()}
      {...(options.services !== undefined
        ? { services: options.services }
        : {})}
    />
  );
  await waitForRendererDestroy(renderer);
}
