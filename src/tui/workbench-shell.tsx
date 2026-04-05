import type { ReactNode } from "react";

import type {
  ProjectContext,
  RunInspection,
  ScopedProfileDefinition
} from "../lib/types.js";
import type { AppNotice, FocusRegion, Workspace } from "./workbench-model.js";
import { getRunCounts } from "./workbench-model.js";

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
    ["q", "quit"]
  ];

  const pageShortcuts: Record<Workspace, string[][]> = {
    start: [],
    agents: [],
    tasks: [["^L", "launch"]],
    runs: [
      ["^R", "refresh"],
      ["^S", "stop"],
      ["/", "search"]
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
      <box flexDirection="column" flexShrink={0}>
        <box alignItems="flex-start" flexDirection="row" gap={2} height={4}>
          <box
            height={4}
            marginLeft={1}
            onMouseDown={() => input.onNavigate?.("start")}
            width={12}
          >
            <text fg="#f8d477">{` ▗▟█▙▖\n▗▟█▀█▙▖\n▟█▀  ▀█▙\n▝▀    ▀▘`}</text>
          </box>

          <box
            columnGap={2}
            flexDirection="row"
            flexWrap="wrap"
            height={4}
            width={35}
          >
            {shortcuts.map(([shortcutKey, label]) => (
              <box
                flexDirection="row"
                key={String(shortcutKey)}
                marginRight={1}
                onMouseDown={() => {
                  if (shortcutKey === "s") input.onNavigate?.("start");
                  if (shortcutKey === "a") input.onNavigate?.("agents");
                  if (shortcutKey === "t") input.onNavigate?.("tasks");
                  if (shortcutKey === "r") input.onNavigate?.("runs");
                }}
              >
                <text fg="#10b981">{String(shortcutKey)}</text>
                <text fg="#9fb3c8">{` ${label}`}</text>
              </box>
            ))}
          </box>
        </box>

        <box alignItems="center" flexDirection="row" gap={2} height={3}>
          <box
            border
            borderColor="#385170"
            borderStyle="single"
            height={3}
            justifyContent="center"
            marginLeft={1}
            paddingX={1}
            width={12}
          >
            <text fg="#f8d477">{String(pageTitle).toUpperCase()}</text>
          </box>
          <box flexDirection="row" gap={2}>
            <text fg={counts.running > 0 ? "#10b981" : "#385170"}>
              {`[●] ${counts.running}`}
            </text>
            <text fg={counts.failed > 0 ? "#ef4444" : "#385170"}>
              {`[✖] ${counts.failed}`}
            </text>
            <text fg="#385170">{`· ${input.projectTitle}`}</text>
          </box>
        </box>
      </box>

      {input.notice && (
        <box
          backgroundColor={noticeColors.background}
          marginTop={1}
          paddingX={1}
        >
          <text fg={noticeColors.foreground}>{input.notice.text}</text>
        </box>
      )}

      <box flexGrow={1} paddingTop={1}>
        {input.children}
      </box>
    </box>
  );
}
