import { startTransition, useEffect, useRef, useState } from "react";

import {
  CliRenderEvents,
  createCliRenderer,
  type CliRenderer,
  type TextareaRenderable
} from "@opentui/core";
import {
  createRoot,
  useKeyboard,
  useRenderer,
  useTerminalDimensions
} from "@opentui/react";

import { UserError } from "../lib/errors.js";
import { getProjectPaths, type ProjectPaths } from "../lib/paths.js";
import { listProfiles } from "../lib/profiles.js";
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
  startFocusOrder,
  agentsFocusOrder,
  tasksFocusOrder,
  runsFocusOrder,
  sortRunsForWorkbench,
  trimLiveOutput
} from "./workbench-model.js";
import {
  StartWorkspace,
  AgentsWorkspace,
  TasksWorkspace,
  RunsWorkspace,
  WorkbenchShell
} from "./workbench-view.js";

type RunAgentInput = Parameters<typeof runAgent>[0];

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

const refreshIntervalMs = 1000;
const detailLogLines = 160;

const defaultServices: WorkbenchServices = {
  listProfiles,
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
  liveOutput: string;
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
      return buildAnswerContent({
        liveOutput: input.liveOutput,
        run: input.run
      });
    case "logs": {
      const output = await input.services.readRunOutput(
        input.run.runId,
        "all",
        detailLogLines
      );
      if (output.trim().length > 0) return output;
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
  setTaskEditorKey: (value: (current: number) => number) => void;
  value: string;
}): void {
  input.setTaskDraft(input.value);
  input.setTaskEditorKey((current) => current + 1);
}

export function AimanWorkbench(props: AimanWorkbenchProps) {
  const services: WorkbenchServices = { ...defaultServices, ...props.services };
  const renderer = useRenderer();
  const { width } = useTerminalDimensions();
  const taskEditorRef = useRef<TextareaRenderable | null>(null);
  const refreshRunsInFlightRef = useRef(false);
  const [workspace, setWorkspace] = useState<Workspace>("start");
  const [focusRegion, setFocusRegion] = useState<FocusRegion>("startPane");
  const [profiles, setProfiles] = useState<ScopedProfileDefinition[]>([]);
  const [projectContext, setProjectContext] = useState<
    ProjectContext | undefined
  >();
  const [selectedProfileIndex, setSelectedProfileIndex] = useState(0);
  const [taskDraft, setTaskDraft] = useState("");
  const [taskEditorKey, setTaskEditorKey] = useState(0);
  const [runs, setRuns] = useState<RunInspection[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [detailTab, setDetailTab] = useState<RunDetailTab>("summary");
  const [detailBody, setDetailBody] = useState("Loading runs…");
  const [detailLoading, setDetailLoading] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [refreshingRuns, setRefreshingRuns] = useState(false);
  const [stoppingRunId, setStoppingRunId] = useState<string | undefined>();
  const [notice, setNotice] = useState<AppNotice | undefined>();
  const [liveOutput, setLiveOutput] = useState("");
  const projectTitle = getProjectTitle(props.projectPaths.projectRoot);
  const selectedProfile = profiles[selectedProfileIndex];
  const selectedRun = getSelectedRun(runs, selectedRunId);

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
      setNotice({ text: "No profile is available to launch.", tone: "error" });
      return;
    }
    const task = taskDraft.trim();
    if (task.length === 0) {
      setNotice({
        text: "Enter a task before launching the selected profile.",
        tone: "error"
      });
      return;
    }
    setLaunching(true);
    setNotice({ text: `Launching ${selectedProfile.name}…`, tone: "info" });
    setLiveOutput("");

    try {
      const result = await services.runAgent({
        profileName: selectedProfile.name,
        profileScope: selectedProfile.scope,
        onRunOutput: ({ text }) => {
          setLiveOutput((currentValue) =>
            trimLiveOutput(`${currentValue}${text}`)
          );
        },
        onRunStarted: ({ profile, runId }) => {
          startTransition(() => {
            setSelectedRunId(runId);
            setDetailTab("logs");
            setWorkspace("runs");
            setFocusRegion("detailPane"); // Drill down to logs immediately
            setNotice({
              text: `Running ${profile} in the workbench…`,
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
        setTaskEditorValue({ setTaskDraft, setTaskEditorKey, value: "" });
      }

      startTransition(() => {
        setDetailTab(result.status === "success" ? "answer" : "logs");
        setSelectedRunId(result.runId);
        setWorkspace("runs");
        setFocusRegion("detailPane"); // Drill down to result/logs
      });
      await refreshRuns();
    } catch (error) {
      setNotice({ text: getErrorMessage(error), tone: "error" });
    } finally {
      setLaunching(false);
      setLiveOutput("");
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
  }, [detailTab, liveOutput, selectedRun?.runId, selectedRun?.status, runs]);

  useKeyboard((key) => {
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
        nextTab === "logs" ||
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
        const currentIndex = runs.findIndex((r) => r.runId === selectedRunId);
        const nextIndex = Math.max(0, currentIndex - 1);
        setSelectedRunId(runs[nextIndex]?.runId);
        return;
      }
    }

    if (
      (key.name === "down" || key.name === "j") &&
      focusRegion !== "taskEditor"
    ) {
      if (focusRegion === "profileList") {
        setSelectedProfileIndex((i) => Math.min(profiles.length - 1, i + 1));
        return;
      }
      if (focusRegion === "runList") {
        const currentIndex = runs.findIndex((r) => r.runId === selectedRunId);
        const nextIndex = Math.min(runs.length - 1, currentIndex + 1);
        setSelectedRunId(runs[nextIndex]?.runId);
        return;
      }
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
          taskEditorKey={taskEditorKey}
          taskEditorRef={taskEditorRef}
          updateProfileIndex={(index) => setSelectedProfileIndex(index)}
          updateTaskDraft={(value) => setTaskDraft(value)}
          setFocusRegion={(nextRegion) => setFocusRegion(nextRegion)}
        />
      ) : (
        <RunsWorkspace
          detailBody={detailBody}
          detailLoading={detailLoading}
          detailTab={detailTab}
          focusRegion={focusRegion}
          runs={runs}
          selectedRunId={selectedRunId}
          setDetailTab={(nextDetailTab) => setDetailTab(nextDetailTab)}
          setSelectedRunId={(runId) => setSelectedRunId(runId)}
          setFocusRegion={(nextRegion) => setFocusRegion(nextRegion)}
        />
      )}
    </WorkbenchShell>
  );
}

export async function openAimanApp(): Promise<void> {
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

  root.render(<AimanWorkbench projectPaths={getProjectPaths()} />);
  await waitForRendererDestroy(renderer);
}
