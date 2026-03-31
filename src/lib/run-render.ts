import { renderActivityBar } from "./activity.js";
import { formatRunRights } from "./provider-capabilities.js";
import {
   formatDuration,
   renderLabelValueBlock,
   renderSection,
   renderTable
} from "./pretty.js";
import type {
   MarkdownFrontmatter,
   ResolvedSkill,
   RunInspection
} from "./types.js";

function formatAge(startedAt: string): string {
   const durationMs = Date.now() - Date.parse(startedAt);

   if (!Number.isFinite(durationMs) || durationMs < 0) {
      return startedAt;
   }

   return `${formatDuration(durationMs)} ago`;
}

function stringifyFrontmatter(frontmatter?: MarkdownFrontmatter): string {
   if (!frontmatter) {
      return "";
   }

   return JSON.stringify(frontmatter, null, 2);
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

function formatSkillNames(skills: ResolvedSkill[]): string {
   return skills.map((skill) => skill.name).join(", ");
}

export function renderRunTable(runs: RunInspection[]): string {
   return renderTable(
      ["Run ID", "Agent", "Provider", "Launch", "Mode", "Age", "PID"],
      runs.map((run) => [
         run.runId,
         run.agent,
         run.provider,
         run.launchMode,
         run.mode,
         formatAge(run.startedAt),
         "pid" in run && typeof run.pid === "number" ? String(run.pid) : ""
      ])
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
      { label: "Agent", value: input.run.agent },
      { label: "Scope", value: input.run.agentScope },
      { label: "Provider", value: input.run.provider },
      { label: "Launch", value: input.run.launchMode },
      { label: "Mode", value: input.run.mode },
      {
         label: "Rights",
         value: formatRunRights(input.run.provider, input.run.mode)
      },
      { label: "Cwd", value: input.run.cwd },
      { label: "Started", value: input.run.startedAt },
      {
         label: "PID",
         value:
            "pid" in input.run && typeof input.run.pid === "number"
               ? String(input.run.pid)
               : ""
      },
      {
         label: "Ended",
         value:
            "endedAt" in input.run && typeof input.run.endedAt === "string"
               ? input.run.endedAt
               : ""
      },
      {
         label: "Duration",
         value:
            "durationMs" in input.run &&
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

   const overview = renderLabelValueBlock(overviewRows);
   const sections = [renderSection("Status", overview)];
   const warning = renderWarning(input.run);

   if (warning.length > 0) {
      sections.push(warning);
   }

   if (
      "finalText" in input.run &&
      typeof input.run.finalText === "string" &&
      input.run.finalText.length > 0
   ) {
      sections.push(renderSection("Final answer", input.run.finalText));
   }

   if (input.recentOutput.length > 0) {
      sections.push(renderSection("Recent output", input.recentOutput));
   }

   sections.push(
      renderSection(
         "Next steps",
         renderLabelValueBlock([
            { label: "Logs", value: `aiman sesh logs ${input.run.runId} -f` },
            { label: "Inspect", value: `aiman sesh inspect ${input.run.runId}` }
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
      { label: "Agent", value: run.agent },
      { label: "Scope", value: run.agentScope },
      { label: "Provider", value: run.provider },
      { label: "Launch", value: run.launchMode },
      { label: "Mode", value: run.mode },
      {
         label: "Rights",
         value: formatRunRights(run.provider, run.mode)
      },
      { label: "Cwd", value: run.cwd },
      { label: "Started", value: run.startedAt },
      {
         label: "PID",
         value:
            "pid" in run && typeof run.pid === "number" ? String(run.pid) : ""
      },
      {
         label: "Ended",
         value:
            "endedAt" in run && typeof run.endedAt === "string"
               ? run.endedAt
               : ""
      },
      {
         label: "Duration",
         value:
            "durationMs" in run && typeof run.durationMs === "number"
               ? formatDuration(run.durationMs)
               : ""
      },
      {
         label: "Error",
         value:
            "errorMessage" in run && typeof run.errorMessage === "string"
               ? run.errorMessage
               : ""
      }
   ];

   if (run.active && typeof activityFrameIndex === "number") {
      overviewRows.splice(2, 0, {
         label: "Activity",
         value: `[${renderActivityBar(activityFrameIndex)}]`
      });
   }

   const overview = renderLabelValueBlock(overviewRows);
   const sections = [renderSection("Run", overview)];
   const warning = renderWarning(run);

   if (warning.length > 0) {
      sections.push(warning);
   }

   if (
      "finalText" in run &&
      typeof run.finalText === "string" &&
      run.finalText.length > 0
   ) {
      sections.push(renderSection("Final answer", run.finalText));
   }

   sections.push(
      renderSection(
         "Launch",
         renderLabelValueBlock([
            { label: "Agent path", value: run.launch.agentPath },
            { label: "Agent digest", value: run.launch.agentDigest },
            { label: "Prompt digest", value: run.launch.promptDigest },
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
               value: formatRunRights(run.launch.provider, run.launch.mode)
            },
            { label: "Timeout", value: formatDuration(run.launch.timeoutMs) },
            {
               label: "Kill grace",
               value: formatDuration(run.launch.killGraceMs)
            },
            {
               label: `Skills (${run.launch.skills.length})`,
               value: formatSkillNames(run.launch.skills)
            }
         ])
      )
   );

   if (run.launch.skills.length > 0) {
      sections.push(
         renderSection(
            "Skills",
            renderTable(
               ["Name", "Scope", "Path"],
               run.launch.skills.map((skill) => [
                  skill.name,
                  skill.scope,
                  skill.path
               ])
            )
         )
      );
   }

   sections.push(
      renderSection(
         "Files",
         renderLabelValueBlock([
            { label: "Run", value: run.paths.runFile },
            { label: "Prompt", value: run.paths.promptFile },
            { label: "Stdout", value: run.paths.stdoutLog ?? "" },
            { label: "Stderr", value: run.paths.stderrLog ?? "" },
            { label: "Artifacts", value: run.paths.artifactsDir }
         ])
      )
   );

   if (run.document.artifacts.length > 0) {
      sections.push(
         renderSection(
            "Artifacts",
            renderTable(
               ["Kind", "Label", "Path", "Exists"],
               run.document.artifacts.map((artifact) => [
                  artifact.kind ?? "",
                  artifact.label ?? "",
                  artifact.path,
                  artifact.exists ? "yes" : "no"
               ])
            )
         )
      );
   }

   const frontmatter = stringifyFrontmatter(run.document.frontmatter);
   if (frontmatter.length > 0) {
      sections.push(renderSection("Document frontmatter", frontmatter));
   }

   sections.push(
      renderSection(
         "Next steps",
         renderLabelValueBlock([
            { label: "Show", value: `aiman sesh show ${run.runId}` },
            { label: "Logs", value: `aiman sesh logs ${run.runId} -f` },
            {
               label: "Run file",
               value: `aiman sesh inspect ${run.runId} --stream run`
            },
            {
               label: "Prompt",
               value: `aiman sesh inspect ${run.runId} --stream prompt`
            }
         ])
      )
   );

   return `${sections.join("\n\n")}\n`;
}
