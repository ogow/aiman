import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import type { TextareaRenderable } from "@opentui/core";
import type {
  ProjectContext,
  RunInspection,
  ScopedProfileDefinition
} from "../lib/types.js";
import type {
  AppNotice,
  FocusRegion,
  RunDetailTab,
  Workspace
} from "./workbench-model.js";
import {
  buildProfileOptions,
  buildRunOptions,
  getRunCounts
} from "./workbench-model.js";

type LayoutSize = number | `${number}%` | "auto";

function getPanelBorderColor(input: {
  activeRegion: FocusRegion;
  region: FocusRegion;
}): string {
  return input.activeRegion === input.region ? "#f59e0b" : "#385170";
}

function getNoticeColors(tone: AppNotice["tone"] | undefined): {
  background: string;
  foreground: string;
} {
  switch (tone) {
    case "error":
      return { background: "#4c1d1d", foreground: "#fecaca" };
    case "success":
      return { background: "#163d2f", foreground: "#bbf7d0" };
    default:
      return { background: "#1f2d3d", foreground: "#cbd5f5" };
  }
}

function Panel(input: {
  children: ReactNode;
  flexGrow?: number;
  focusRegion: FocusRegion;
  height?: LayoutSize;
  region: FocusRegion;
  setFocusRegion?: (region: FocusRegion) => void;
  title: string;
  width?: LayoutSize;
}) {
  return (
    <box
      border
      borderColor={getPanelBorderColor({
        activeRegion: input.focusRegion,
        region: input.region
      })}
      borderStyle="rounded"
      flexDirection="column"
      padding={1}
      title={input.title}
      onMouseDown={() => input.setFocusRegion?.(input.region)}
      {...(typeof input.flexGrow === "number"
        ? { flexGrow: input.flexGrow }
        : {})}
      {...(input.height !== undefined ? { height: input.height } : {})}
      {...(input.width !== undefined ? { width: input.width } : {})}
    >
      {input.children}
    </box>
  );
}

function TabsRow(input: {
  activeRegion: FocusRegion;
  items: Array<{ label: string; value: string }>;
  region: FocusRegion;
  selectedValue: string;
  onSelect?: (value: any) => void;
}) {
  return (
    <box flexDirection="row" gap={1}>
      {input.items.map((item) => {
        const selected = item.value === input.selectedValue;
        return (
          <box
            backgroundColor={selected ? "#f8d477" : "#132034"}
            key={item.value}
            paddingX={1}
            onMouseDown={() => input.onSelect?.(item.value)}
          >
            <text fg={selected ? "#0b1320" : "#dbe7f5"}>
              {item.label}
              {input.activeRegion === input.region && selected ? " *" : ""}
            </text>
          </box>
        );
      })}
    </box>
  );
}

export function WorkbenchShell(input: {
  children: ReactNode;
  focusRegion: FocusRegion;
  launching: boolean;
  notice: AppNotice | undefined;
  profiles: ScopedProfileDefinition[];
  projectContext: ProjectContext | undefined;
  projectTitle: string;
  refreshingRuns: boolean;
  runs: RunInspection[];
  selectedWorkspace: Workspace;
  stoppingRunId: string | undefined;
  onNavigate?: (workspace: Workspace) => void;
}) {
  const counts = getRunCounts(input.runs);
  const noticeColors = getNoticeColors(input.notice?.tone);

  const pageTitle =
    input.selectedWorkspace === "start"
      ? "Start"
      : input.selectedWorkspace === "agents"
        ? "Agents"
        : input.selectedWorkspace === "tasks"
          ? "Tasks"
          : "Runs";

  const commonShortcuts = [
    ["s", "start"],
    ["a", "agents"],
    ["t", "tasks"],
    ["r", "runs"],
    ["tab", "cycle"],
    ["q", "quit"]
  ];

  const pageShortcuts: Record<Workspace, string[][]> = {
    start: [],
    agents: [],
    tasks: [["^L", "launch"]],
    runs: [
      ["^R", "refresh"],
      ["^S", "stop"],
      ["^U", "reuse"]
    ]
  };

  const shortcuts = [
    ...commonShortcuts,
    ...pageShortcuts[input.selectedWorkspace]
  ];

  return (
    <box
      backgroundColor="#0b1320"
      flexDirection="column"
      height="100%"
      padding={1}
      width="100%"
    >
      {/* Header Section */}
      <box flexDirection="column" height={10} paddingX={1}>
        <box flexDirection="row" gap={3}>
          {/* Logo Box */}
          <box
            border
            borderStyle="single"
            borderColor="#385170"
            width={18}
            height={7}
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            onMouseDown={() => input.onNavigate?.("start")}
          >
            <text fg="#f8d477">{`  ▗▟█▙▖\n ▗▟█▀█▙▖\n ▟█▀  ▀█▙\n ▝▀    ▀▘\n aiman`}</text>
          </box>

          {/* Shortcuts Flow */}
          <box width={35} flexDirection="row" flexWrap="wrap" columnGap={2}>
            {shortcuts.map(([k, label]) => (
              <box
                flexDirection="row"
                key={k!}
                marginRight={1}
                onMouseDown={() => {
                  if (k === "s") input.onNavigate?.("start");
                  if (k === "a") input.onNavigate?.("agents");
                  if (k === "t") input.onNavigate?.("tasks");
                  if (k === "r") input.onNavigate?.("runs");
                }}
              >
                <text fg="#10b981">{String(k)}</text>
                <text fg="#9fb3c8">{` ${label}`}</text>
              </box>
            ))}
          </box>
        </box>

        {/* Page & Status Row */}
        <box flexDirection="row" gap={2} alignItems="center">
          <box border borderStyle="single" borderColor="#385170" paddingX={1}>
            <text fg="#f8d477">{String(pageTitle)}</text>
          </box>
          <box flexDirection="row">
            <text
              fg={counts.running > 0 ? "#10b981" : "#385170"}
            >{`[●] ${counts.running}  `}</text>
            <text
              fg={counts.failed > 0 ? "#ef4444" : "#385170"}
            >{`[✖] ${counts.failed}  `}</text>
            <text fg="#385170">{`· ${input.projectTitle}`}</text>
          </box>
        </box>
      </box>

      {/* Notice Banner */}
      {input.notice && (
        <box
          backgroundColor={noticeColors.background}
          paddingX={1}
          marginTop={1}
        >
          <text fg={noticeColors.foreground}>{input.notice.text}</text>
        </box>
      )}

      {/* Main Content */}
      <box flexGrow={1} paddingTop={1}>
        {input.children}
      </box>
    </box>
  );
}

export function StartWorkspace(input: {
  focusRegion: FocusRegion;
  projectTitle: string;
  setFocusRegion: (region: FocusRegion) => void;
}) {
  return (
    <box
      flexDirection="column"
      flexGrow={1}
      alignItems="center"
      justifyContent="center"
    >
      <box
        border
        borderColor="#f8d477"
        borderStyle="rounded"
        paddingX={4}
        paddingY={2}
        flexDirection="column"
        alignItems="center"
        onMouseDown={() => input.setFocusRegion("startPane")}
      >
        <text fg="#f8d477">Welcome to the Aiman Operator Workbench</text>
        <box paddingTop={1}>
          <text fg="#dbe7f5">{`Project: ${input.projectTitle}`}</text>
        </box>
        <box paddingTop={2}>
          <text fg="#9fb3c8">Press [a] to view Agents.</text>
          <text fg="#9fb3c8">Press [t] to launch Tasks.</text>
          <text fg="#9fb3c8">Press [r] to manage Runs.</text>
        </box>
      </box>
    </box>
  );
}

function WorkbenchList<T>(input: {
  focusRegion: FocusRegion;
  items: Array<{ description?: string; name: string; value: T }>;
  region: FocusRegion;
  selectedIndex: number;
  onIndexChange: (index: number) => void;
  onSelect?: (index: number) => void;
}) {
  const scrollRef = useRef<any>(null);

  useEffect(() => {
    if (input.focusRegion === input.region) {
      scrollRef.current?.scrollChildIntoView(
        `${input.region}-item-${input.selectedIndex}`
      );
    }
  }, [input.selectedIndex, input.focusRegion, input.region]);

  return (
    <scrollbox
      ref={scrollRef}
      flexGrow={1}
      focused={input.focusRegion === input.region}
    >
      {input.items.length > 0 ? (
        input.items.map((item, i) => {
          const selected = i === input.selectedIndex;
          const itemId = `${input.region}-item-${i}`;
          return (
            <box
              id={itemId}
              key={itemId}
              backgroundColor={selected ? "#f8d477" : "transparent"}
              paddingX={1}
              flexDirection="column"
              onMouseDown={() => {
                input.onIndexChange(i);
              }}
              onDoubleClick={() => {
                input.onSelect?.(i);
              }}
            >
              <text fg={selected ? "#0b1320" : "#dbe7f5"}>
                {selected ? <strong>{item.name}</strong> : item.name}
              </text>
              {item.description && (
                <text fg={selected ? "#0b1320" : "#8aa0b8"} opacity={0.6}>
                  {item.description}
                </text>
              )}
            </box>
          );
        })
      ) : (
        <text fg="#8aa0b8" paddingX={1}>
          No items available.
        </text>
      )}
    </scrollbox>
  );
}

export function AgentsWorkspace(input: {
  focusRegion: FocusRegion;
  profileSummary: string;
  profiles: ScopedProfileDefinition[];
  selectedProfileIndex: number;
  stacked: boolean;
  updateProfileIndex: (index: number) => void;
  onSelectProfile: () => void;
  setFocusRegion: (region: FocusRegion) => void;
}) {
  const profileOptions = buildProfileOptions(input.profiles);

  return (
    <box
      flexDirection={input.stacked ? "column" : "row"}
      flexGrow={1}
      gap={1}
      width="100%"
    >
      <Panel
        focusRegion={input.focusRegion}
        region="profileList"
        setFocusRegion={input.setFocusRegion}
        title="Profiles"
        width={input.stacked ? "100%" : 32}
        {...(input.stacked ? { height: 12 } : {})}
      >
        <WorkbenchList
          focusRegion={input.focusRegion}
          items={profileOptions}
          onIndexChange={(index) => input.updateProfileIndex(index)}
          onSelect={() => input.onSelectProfile()}
          region="profileList"
          selectedIndex={input.selectedProfileIndex}
        />
      </Panel>
      <Panel
        flexGrow={1}
        focusRegion={input.focusRegion}
        region="detailPane"
        setFocusRegion={input.setFocusRegion}
        title="Profile Details"
      >
        <scrollbox focused={input.focusRegion === "detailPane"} flexGrow={1}>
          <text fg="#dbe7f5" selectable>
            {input.profileSummary}
          </text>
        </scrollbox>
      </Panel>
    </box>
  );
}

export function TasksWorkspace(input: {
  focusRegion: FocusRegion;
  profiles: ScopedProfileDefinition[];
  selectedProfileIndex: number;
  stacked: boolean;
  taskDraft: string;
  taskEditorKey: number;
  taskEditorRef: RefObject<TextareaRenderable | null>;
  updateProfileIndex: (index: number) => void;
  updateTaskDraft: (value: string) => void;
  setFocusRegion: (region: FocusRegion) => void;
}) {
  const profileOptions = buildProfileOptions(input.profiles);

  return (
    <box
      flexDirection={input.stacked ? "column" : "row"}
      flexGrow={1}
      gap={1}
      width="100%"
    >
      <Panel
        focusRegion={input.focusRegion}
        region="profileList"
        setFocusRegion={input.setFocusRegion}
        title="Select Agent"
        width={input.stacked ? "100%" : 32}
        {...(input.stacked ? { height: 12 } : {})}
      >
        <WorkbenchList
          focusRegion={input.focusRegion}
          items={profileOptions}
          onIndexChange={(index) => input.updateProfileIndex(index)}
          onSelect={() => input.setFocusRegion("taskEditor")}
          region="profileList"
          selectedIndex={input.selectedProfileIndex}
        />
      </Panel>
      <Panel
        flexGrow={1}
        focusRegion={input.focusRegion}
        region="taskEditor"
        setFocusRegion={input.setFocusRegion}
        title="Task Description"
      >
        <textarea
          backgroundColor="#101b2c"
          cursorColor="#f8d477"
          focused={input.focusRegion === "taskEditor"}
          focusedBackgroundColor="#132034"
          focusedTextColor="#f5f7fa"
          height="100%"
          initialValue={input.taskDraft}
          key={`task-editor-${input.taskEditorKey}`}
          onContentChange={() => {
            input.updateTaskDraft(input.taskEditorRef.current?.plainText ?? "");
          }}
          placeholder="Describe the work to run with the selected profile."
          placeholderColor="#6b7c93"
          ref={input.taskEditorRef}
          tabIndicator={2}
          textColor="#dbe7f5"
          wrapMode="word"
        />
      </Panel>
    </box>
  );
}

export function RunsWorkspace(input: {
  detailBody: string;
  detailLoading: boolean;
  detailTab: RunDetailTab;
  focusRegion: FocusRegion;
  runs: RunInspection[];
  selectedRunId: string | undefined;
  setDetailTab: (tab: RunDetailTab) => void;
  setSelectedRunId: (runId: string | undefined) => void;
  stacked: boolean;
  setFocusRegion: (region: FocusRegion) => void;
}) {
  const runOptions = buildRunOptions(input.runs);
  const selectedRunIndex = Math.max(
    0,
    input.runs.findIndex((run) => run.runId === input.selectedRunId)
  );

  return (
    <box
      flexDirection={input.stacked ? "column" : "row"}
      flexGrow={1}
      gap={1}
      width="100%"
    >
      <Panel
        focusRegion={input.focusRegion}
        region="runList"
        setFocusRegion={input.setFocusRegion}
        title="Runs"
        width={input.stacked ? "100%" : 40}
        {...(input.stacked ? { height: 14 } : {})}
      >
        <WorkbenchList
          focusRegion={input.focusRegion}
          items={runOptions}
          onIndexChange={(index) => {
            const opt = runOptions[index];
            input.setSelectedRunId(
              typeof opt?.value === "string" ? opt.value : undefined
            );
          }}
          onSelect={() => input.setFocusRegion("detailTabs")}
          region="runList"
          selectedIndex={selectedRunIndex}
        />
      </Panel>
      <box flexDirection="column" flexGrow={1} gap={1}>
        <Panel
          focusRegion={input.focusRegion}
          region="detailTabs"
          setFocusRegion={input.setFocusRegion}
          title="Inspect"
        >
          <TabsRow
            activeRegion={input.focusRegion}
            items={[
              { label: "Summary", value: "summary" },
              { label: "Answer", value: "answer" },
              { label: "Logs", value: "logs" },
              { label: "Prompt", value: "prompt" }
            ]}
            region="detailTabs"
            selectedValue={input.detailTab}
            onSelect={(value) => {
              input.setFocusRegion("detailTabs");
              input.setDetailTab(value);
            }}
          />
        </Panel>
        <Panel
          flexGrow={1}
          focusRegion={input.focusRegion}
          region="detailPane"
          setFocusRegion={input.setFocusRegion}
          title="Detail"
        >
          <scrollbox focused={input.focusRegion === "detailPane"} flexGrow={1}>
            <text fg="#dbe7f5" selectable>
              {input.detailLoading ? "Loading detail…" : input.detailBody}
            </text>
          </scrollbox>
        </Panel>
      </box>
    </box>
  );
}
