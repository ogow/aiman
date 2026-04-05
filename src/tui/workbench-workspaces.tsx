import { useEffect, useRef, type ReactNode } from "react";

import type { RunInspection, ScopedProfileDefinition } from "../lib/types.js";
import type { FocusRegion, RunDetailTab } from "./workbench-model.js";
import {
  buildProfileOptions,
  formatCompactTimestamp,
  formatRunDuration,
  getProjectTitle,
  getRunShortLabel,
  getRunStatusColor,
  getRunStatusLabel
} from "./workbench-model.js";

type LayoutSize = number | `${number}%` | "auto";

function Panel(input: {
  children: ReactNode;
  flexGrow?: number;
  height?: LayoutSize;
  onMouseDown?: () => void;
  width?: LayoutSize;
}) {
  return (
    <box
      flexDirection="column"
      {...(input.onMouseDown !== undefined
        ? { onMouseDown: input.onMouseDown }
        : {})}
      {...(typeof input.flexGrow === "number"
        ? { flexGrow: input.flexGrow }
        : {})}
      {...(input.height !== undefined ? { height: input.height } : {})}
      {...(input.width !== undefined ? { width: input.width } : {})}
    >
      <box flexGrow={1}>{input.children}</box>
    </box>
  );
}

function TabsRow(input: {
  activeRegion: FocusRegion;
  items: Array<{ label: string; value: string }>;
  region: FocusRegion;
  selectedValue: string;
  onSelect?: (value: string) => void;
}) {
  return (
    <box flexDirection="row" gap={1} marginBottom={1}>
      {input.items.map((item) => {
        const selected = item.value === input.selectedValue;
        return (
          <box
            backgroundColor={selected ? "#f8d477" : "#132034"}
            key={item.value}
            onMouseDown={() => input.onSelect?.(item.value)}
            paddingX={1}
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

function WorkbenchList<T>(input: {
  focusRegion: FocusRegion;
  items: Array<{ description?: string; name: string; value: T }>;
  onIndexChange: (index: number) => void;
  onSelect?: (index: number) => void;
  region: FocusRegion;
  selectedIndex: number;
}) {
  const scrollRef = useRef<any>(null);

  useEffect(() => {
    if (input.focusRegion === input.region) {
      scrollRef.current?.scrollChildIntoView(
        `${input.region}-item-${input.selectedIndex}`
      );
    }
  }, [input.focusRegion, input.region, input.selectedIndex]);

  return (
    <scrollbox
      flexGrow={1}
      focused={input.focusRegion === input.region}
      ref={scrollRef}
    >
      {input.items.length > 0 ? (
        input.items.map((item, index) => {
          const selected = index === input.selectedIndex;
          const itemId = `${input.region}-item-${index}`;
          return (
            <box
              backgroundColor={selected ? "#f8d477" : "transparent"}
              flexDirection="column"
              id={itemId}
              key={itemId}
              onMouseDown={() => {
                if (selected && input.onSelect) {
                  input.onSelect(index);
                } else {
                  input.onIndexChange(index);
                }
              }}
              paddingX={1}
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

type RunsTableColumn = {
  color?: (run: RunInspection) => string;
  key: "duration" | "profile" | "project" | "runId" | "started" | "status";
  title: string;
  width: number;
};

function truncateCell(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  if (value.length <= width) {
    return value.padEnd(width, " ");
  }

  if (width <= 3) {
    return value.slice(0, width);
  }

  return `${value.slice(0, width - 3)}...`;
}

function getRunsTableColumns(tableWidth: number): RunsTableColumn[] {
  if (tableWidth >= 96) {
    const fixedWidth = 12 + 16 + 14 + 14 + 8;
    const runIdWidth = Math.max(14, tableWidth - fixedWidth - 10);

    return [
      { color: getRunStatusColor, key: "status", title: "STATUS", width: 12 },
      { key: "profile", title: "AGENT", width: 16 },
      { key: "project", title: "PROJECT", width: 14 },
      { key: "started", title: "STARTED", width: 14 },
      { key: "duration", title: "TIME", width: 8 },
      { key: "runId", title: "RUN ID", width: runIdWidth }
    ];
  }

  const fixedWidth = 12 + 18 + 14 + 8;
  const runIdWidth = Math.max(12, tableWidth - fixedWidth - 8);

  return [
    { color: getRunStatusColor, key: "status", title: "STATUS", width: 12 },
    { key: "profile", title: "AGENT", width: 18 },
    { key: "started", title: "STARTED", width: 14 },
    { key: "duration", title: "TIME", width: 8 },
    { key: "runId", title: "RUN ID", width: runIdWidth }
  ];
}

function RunsTable(input: {
  animationFrame: number;
  focusRegion: FocusRegion;
  listWidth: number;
  onIndexChange: (index: number) => void;
  onSelect?: (index: number) => void;
  region: FocusRegion;
  runs: RunInspection[];
  selectedIndex: number;
}) {
  const scrollRef = useRef<any>(null);
  const tableWidth = Math.max(72, input.listWidth - 4);
  const columns = getRunsTableColumns(tableWidth);

  useEffect(() => {
    if (input.focusRegion === input.region) {
      scrollRef.current?.scrollChildIntoView(
        `${input.region}-item-${input.selectedIndex}`
      );
    }
  }, [input.focusRegion, input.region, input.selectedIndex]);

  return (
    <box flexDirection="column" flexGrow={1}>
      <box paddingX={1}>
        <box flexDirection="row" paddingX={2}>
          {columns.map((column, index) => (
            <box
              key={column.key}
              marginLeft={index === 0 ? 0 : 2}
              width={column.width}
            >
              <text fg="#8aa0b8">{column.title}</text>
            </box>
          ))}
        </box>
      </box>
      <scrollbox
        flexGrow={1}
        focused={input.focusRegion === input.region}
        ref={scrollRef}
      >
        {input.runs.length > 0 ? (
          input.runs.map((run, index) => {
            const selected = index === input.selectedIndex;
            const itemId = `${input.region}-item-${index}`;

            const values: Record<RunsTableColumn["key"], string> = {
              duration: formatRunDuration(run),
              profile: getRunShortLabel(run),
              project: getProjectTitle(run.projectRoot),
              runId: run.runId,
              started: formatCompactTimestamp(run.startedAt),
              status: getRunStatusLabel(run, input.animationFrame)
            };

            return (
              <box
                backgroundColor={selected ? "#132034" : "transparent"}
                flexDirection="row"
                id={itemId}
                key={itemId}
                onMouseDown={() => {
                  if (selected && input.onSelect) {
                    input.onSelect(index);
                  } else {
                    input.onIndexChange(index);
                  }
                }}
                paddingX={1}
              >
                <text fg={selected ? "#f8d477" : "#6b7c93"}>
                  {selected ? "▶" : " "}
                </text>
                <box flexDirection="row" paddingLeft={1}>
                  {columns.map((column, colIndex) => {
                    const color = column.color
                      ? column.color(run)
                      : selected
                        ? "#dbe7f5"
                        : "#6b7c93";
                    return (
                      <box
                        key={column.key}
                        marginLeft={colIndex === 0 ? 0 : 2}
                        width={column.width}
                      >
                        <text fg={color}>
                          {selected ? (
                            <strong>
                              {truncateCell(values[column.key], column.width)}
                            </strong>
                          ) : (
                            truncateCell(values[column.key], column.width)
                          )}
                        </text>
                      </box>
                    );
                  })}
                </box>
              </box>
            );
          })
        ) : (
          <text fg="#8aa0b8" paddingX={1}>
            No runs recorded yet.
          </text>
        )}
      </scrollbox>
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
      alignItems="center"
      flexDirection="column"
      flexGrow={1}
      justifyContent="center"
    >
      <box
        alignItems="center"
        flexDirection="column"
        onMouseDown={() => input.setFocusRegion("startPane")}
        paddingX={4}
        paddingY={2}
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

export function AgentsWorkspace(input: {
  focusRegion: FocusRegion;
  profileSummary: string;
  profiles: ScopedProfileDefinition[];
  selectedProfileIndex: number;
  setFocusRegion: (region: FocusRegion) => void;
  updateProfileIndex: (index: number) => void;
  onSelectProfile: () => void;
}) {
  const profileOptions = buildProfileOptions(input.profiles);
  const showDetailPane = input.focusRegion === "detailPane";

  return (
    <box flexDirection="row" flexGrow={1} gap={1} width="100%">
      {!showDetailPane ? (
        <Panel
          onMouseDown={() => input.setFocusRegion("profileList")}
          width="100%"
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
      ) : (
        <Panel
          flexGrow={1}
          onMouseDown={() => input.setFocusRegion("detailPane")}
        >
          <scrollbox flexGrow={1} focused={input.focusRegion === "detailPane"}>
            <text fg="#dbe7f5" selectable>
              {input.profileSummary}
            </text>
          </scrollbox>
        </Panel>
      )}
    </box>
  );
}

export function TasksWorkspace(input: {
  focusRegion: FocusRegion;
  profiles: ScopedProfileDefinition[];
  selectedProfileIndex: number;
  setFocusRegion: (region: FocusRegion) => void;
  taskDraft: string;
  updateProfileIndex: (index: number) => void;
}) {
  const profileOptions = buildProfileOptions(input.profiles);
  const showTaskEditor = input.focusRegion === "taskEditor";
  const taskBody =
    input.taskDraft.length > 0
      ? `${input.taskDraft}█`
      : "Describe the work to run with the selected agent.";

  return (
    <box flexDirection="row" flexGrow={1} gap={1} width="100%">
      {!showTaskEditor ? (
        <Panel
          onMouseDown={() => input.setFocusRegion("profileList")}
          width="100%"
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
      ) : (
        <Panel
          flexGrow={1}
          onMouseDown={() => input.setFocusRegion("taskEditor")}
        >
          <scrollbox flexGrow={1} focused={input.focusRegion === "taskEditor"}>
            <text
              fg={input.taskDraft.length > 0 ? "#dbe7f5" : "#6b7c93"}
              selectable
            >
              {taskBody}
            </text>
          </scrollbox>
        </Panel>
      )}
    </box>
  );
}

function FilterInput(input: {
  focusRegion: FocusRegion;
  onFilterChange: (value: string) => void;
  runFilterText: string;
  setFocusRegion: (region: FocusRegion) => void;
}) {
  const isFocused = input.focusRegion === "runFilter";
  const showFilter = isFocused || input.runFilterText.length > 0;

  if (!showFilter) {
    return null;
  }

  return (
    <box
      backgroundColor={isFocused ? "#132034" : "transparent"}
      border
      borderColor={isFocused ? "#10b981" : "#385170"}
      borderStyle="single"
      flexDirection="row"
      height={3}
      marginBottom={1}
      onMouseDown={() => input.setFocusRegion("runFilter")}
      paddingX={1}
    >
      <text fg={isFocused ? "#10b981" : "#8aa0b8"}>Search: </text>
      <text fg="#dbe7f5">{input.runFilterText}</text>
      {isFocused && <text fg="#10b981">█</text>}
      {!isFocused && input.runFilterText.length > 0 && (
        <box marginLeft={2}>
          <text fg="#6b7c93" opacity={0.6}>
            (press / to edit, Esc to clear)
          </text>
        </box>
      )}
    </box>
  );
}

export function RunsWorkspace(input: {
  animationFrame: number;
  detailBody: string;
  detailLoading: boolean;
  detailTab: RunDetailTab;
  focusRegion: FocusRegion;
  listWidth: number;
  onFilterChange: (value: string) => void;
  runFilterText: string;
  runs: RunInspection[];
  selectedRunId: string | undefined;
  setDetailTab: (tab: RunDetailTab) => void;
  setFocusRegion: (region: FocusRegion) => void;
  setSelectedRunId: (runId: string | undefined) => void;
}) {
  const selectedRunIndex = Math.max(
    0,
    input.runs.findIndex((run) => run.runId === input.selectedRunId)
  );
  const showDetailPane =
    input.focusRegion === "detailTabs" || input.focusRegion === "detailPane";

  return (
    <box flexDirection="row" flexGrow={1} gap={1} width="100%">
      {!showDetailPane ? (
        <Panel onMouseDown={() => input.setFocusRegion("runList")} width="100%">
          <FilterInput
            focusRegion={input.focusRegion}
            onFilterChange={input.onFilterChange}
            runFilterText={input.runFilterText}
            setFocusRegion={input.setFocusRegion}
          />
          <RunsTable
            animationFrame={input.animationFrame}
            focusRegion={input.focusRegion}
            listWidth={input.listWidth}
            onIndexChange={(index) => {
              const run = input.runs[index];
              input.setSelectedRunId(run?.runId);
            }}
            onSelect={() => input.setFocusRegion("detailTabs")}
            region="runList"
            runs={input.runs}
            selectedIndex={selectedRunIndex}
          />
        </Panel>
      ) : (
        <box flexDirection="column" flexGrow={1} gap={1}>
          <Panel onMouseDown={() => input.setFocusRegion("detailTabs")}>
            <TabsRow
              activeRegion={input.focusRegion}
              items={[
                { label: "Summary", value: "summary" },
                { label: "Answer", value: "answer" },
                { label: "Logs", value: "logs" },
                { label: "Prompt", value: "prompt" }
              ]}
              onSelect={(value) => {
                if (
                  value === "summary" ||
                  value === "answer" ||
                  value === "logs" ||
                  value === "prompt"
                ) {
                  input.setFocusRegion("detailTabs");
                  input.setDetailTab(value);
                }
              }}
              region="detailTabs"
              selectedValue={input.detailTab}
            />
          </Panel>
          <Panel
            flexGrow={1}
            onMouseDown={() => input.setFocusRegion("detailPane")}
          >
            <scrollbox
              flexGrow={1}
              focused={input.focusRegion === "detailPane"}
            >
              <text fg="#dbe7f5" selectable>
                {input.detailLoading ? "Loading detail…" : input.detailBody}
              </text>
            </scrollbox>
          </Panel>
        </box>
      )}
    </box>
  );
}
