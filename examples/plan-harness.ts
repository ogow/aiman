#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

import chalk from "chalk";

import { createAiman } from "../src/index.js";
import type { RunResult } from "../src/index.js";

export type HarnessRisk = "high" | "low" | "medium";
export type HarnessReviewMode = "auto" | "required" | "skip";
export type HarnessTaskStatus = "failed" | "passed" | "skipped";
export type HarnessFinalReviewMode = "always" | "skip";

export type HarnessCheck = {
   args: string[];
   command: string;
   name: string;
   timeoutMs?: number;
};

export type HarnessTask = {
   acceptance: string[];
   checks: HarnessCheck[];
   goal: string;
   id: string;
   review: HarnessReviewMode;
   risk: HarnessRisk;
   scope: string[];
   title: string;
};

export type HarnessPlan = {
   builderAgent: string;
   checks: HarnessCheck[];
   continueOnFailure: boolean;
   finalReview: HarnessFinalReviewMode;
   id: string;
   maxCheckRetries: number;
   reviewerAgent: string;
   tasks: HarnessTask[];
};

export type HarnessCheckResult = {
   args: string[];
   command: string;
   durationMs: number;
   exitCode: number | null;
   name: string;
   output: string;
   passed: boolean;
   timedOut: boolean;
};

export type HarnessTaskReport = {
   builderRunIds: string[];
   checkAttempts: HarnessCheckResult[][];
   changedFiles: string[];
   id: string;
   reviewRunIds: string[];
   reviewStatus?: "blocking" | "clear" | "skipped" | "unclear";
   status: HarnessTaskStatus;
   summary: string;
   title: string;
};

export type HarnessReport = {
   endedAt: string;
   finalReviewRunId?: string;
   finalReviewStatus?: "blocking" | "clear" | "skipped" | "unclear";
   planId: string;
   reportPath: string;
   startedAt: string;
   status: "failed" | "passed";
   tasks: HarnessTaskReport[];
};

type NormalizedRecord = Record<string, unknown>;

const DEFAULT_MAX_CHECK_RETRIES = 1;
const DEFAULT_CHECK_TIMEOUT_MS = 120_000;
const MAX_PROMPT_SECTION_CHARS = 12_000;

function usage(): never {
   console.log(
      "Usage: bun run examples/plan-harness.ts <plan.json> [project-root]"
   );
   process.exit(1);
}

function isRecord(value: unknown): value is NormalizedRecord {
   return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
   value: unknown,
   label: string,
   fallback?: string
): string {
   if (value === undefined && fallback !== undefined) {
      return fallback;
   }

   if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${label} must be a non-empty string.`);
   }

   return value.trim();
}

function optionalStringArray(value: unknown, label: string): string[] {
   if (value === undefined) {
      return [];
   }

   if (
      !Array.isArray(value) ||
      value.some((entry) => typeof entry !== "string")
   ) {
      throw new Error(`${label} must be an array of strings.`);
   }

   return value
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
}

function normalizeRisk(value: unknown, label: string): HarnessRisk {
   if (value === undefined) {
      return "low";
   }

   if (value === "high" || value === "low" || value === "medium") {
      return value;
   }

   throw new Error(`${label} must be "low", "medium", or "high".`);
}

function normalizeReviewMode(value: unknown, label: string): HarnessReviewMode {
   if (value === undefined) {
      return "auto";
   }

   if (value === "auto" || value === "required" || value === "skip") {
      return value;
   }

   throw new Error(`${label} must be "auto", "required", or "skip".`);
}

function normalizeFinalReview(value: unknown): HarnessFinalReviewMode {
   if (value === undefined) {
      return "always";
   }

   if (value === "always" || value === "skip") {
      return value;
   }

   throw new Error('finalReview must be "always" or "skip".');
}

function normalizeCheck(value: unknown, label: string): HarnessCheck {
   if (!isRecord(value)) {
      throw new Error(`${label} must be an object.`);
   }

   const command = requireString(value.command, `${label}.command`);
   const args = optionalStringArray(value.args, `${label}.args`);
   const name = requireString(value.name, `${label}.name`, command);

   if (
      value.timeoutMs !== undefined &&
      (typeof value.timeoutMs !== "number" ||
         !Number.isFinite(value.timeoutMs) ||
         value.timeoutMs < 1)
   ) {
      throw new Error(`${label}.timeoutMs must be a positive number.`);
   }

   return {
      args,
      command,
      name,
      ...(typeof value.timeoutMs === "number"
         ? { timeoutMs: value.timeoutMs }
         : {})
   };
}

function normalizeChecks(value: unknown, label: string): HarnessCheck[] {
   if (value === undefined) {
      return [];
   }

   if (!Array.isArray(value)) {
      throw new Error(`${label} must be an array.`);
   }

   return value.map((entry, index) =>
      normalizeCheck(entry, `${label}[${index}]`)
   );
}

function normalizeMaxCheckRetries(value: unknown): number {
   if (value === undefined) {
      return DEFAULT_MAX_CHECK_RETRIES;
   }

   if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 3
   ) {
      throw new Error("maxCheckRetries must be an integer between 0 and 3.");
   }

   return value;
}

export function parseHarnessPlan(rawText: string): HarnessPlan {
   const parsed = JSON.parse(rawText) as unknown;

   if (!isRecord(parsed)) {
      throw new Error("Harness plan must be a JSON object.");
   }

   const tasksValue = parsed.tasks;

   if (!Array.isArray(tasksValue) || tasksValue.length === 0) {
      throw new Error("Harness plan must include at least one task.");
   }

   return {
      builderAgent: requireString(parsed.builderAgent, "builderAgent", "build"),
      checks: normalizeChecks(parsed.checks, "checks"),
      continueOnFailure:
         typeof parsed.continueOnFailure === "boolean"
            ? parsed.continueOnFailure
            : false,
      finalReview: normalizeFinalReview(parsed.finalReview),
      id: requireString(parsed.id, "id", "plan"),
      maxCheckRetries: normalizeMaxCheckRetries(parsed.maxCheckRetries),
      reviewerAgent: requireString(
         parsed.reviewerAgent,
         "reviewerAgent",
         "reviewer"
      ),
      tasks: tasksValue.map((entry, index) => {
         if (!isRecord(entry)) {
            throw new Error(`tasks[${index}] must be an object.`);
         }

         const title = requireString(
            entry.title,
            `tasks[${index}].title`,
            `Task ${index + 1}`
         );

         return {
            acceptance: optionalStringArray(
               entry.acceptance,
               `tasks[${index}].acceptance`
            ),
            checks: normalizeChecks(entry.checks, `tasks[${index}].checks`),
            goal: requireString(entry.goal, `tasks[${index}].goal`),
            id: requireString(
               entry.id,
               `tasks[${index}].id`,
               `task-${index + 1}`
            ),
            review: normalizeReviewMode(entry.review, `tasks[${index}].review`),
            risk: normalizeRisk(entry.risk, `tasks[${index}].risk`),
            scope: optionalStringArray(entry.scope, `tasks[${index}].scope`),
            title
         };
      })
   };
}

export function shouldReviewTask(input: {
   checksHadFailure: boolean;
   task: HarnessTask;
}): boolean {
   if (input.task.review === "required") {
      return true;
   }

   if (input.task.review === "skip") {
      return false;
   }

   return input.task.risk !== "low" || input.checksHadFailure;
}

export function classifyReview(text: string): "blocking" | "clear" | "unclear" {
   const firstLine = text.trim().split("\n")[0]?.trim().toLowerCase() ?? "";

   if (/^blocking:\s*(none|no)\b/.test(firstLine)) {
      return "clear";
   }

   if (/^blocking:\s*(yes|true)\b/.test(firstLine)) {
      return "blocking";
   }

   return "unclear";
}

function truncate(value: string, maxChars = MAX_PROMPT_SECTION_CHARS): string {
   if (value.length <= maxChars) {
      return value;
   }

   return `${value.slice(0, maxChars)}\n\n[truncated ${value.length - maxChars} chars]`;
}

function renderList(values: string[]): string {
   if (values.length === 0) {
      return "- none";
   }

   return values.map((value) => `- ${value}`).join("\n");
}

function renderRunText(result: RunResult): string {
   return (
      result.finalText ??
      result.summary ??
      (result.structuredResult === undefined
         ? ""
         : JSON.stringify(result.structuredResult, null, 2))
   );
}

function renderCheckSummary(checks: HarnessCheckResult[]): string {
   if (checks.length === 0) {
      return "No checks configured.";
   }

   return checks
      .map((check) => {
         const status = check.passed ? "PASS" : "FAIL";
         return `${status} ${check.name}: ${check.command} ${check.args.join(" ")}`;
      })
      .join("\n");
}

function renderCheckFailures(checks: HarnessCheckResult[]): string {
   return checks
      .filter((check) => !check.passed)
      .map(
         (check) =>
            `## ${check.name}\ncommand: ${check.command} ${check.args.join(" ")}\nexitCode: ${check.exitCode ?? "null"}\ntimedOut: ${String(check.timedOut)}\n\n${truncate(check.output)}`
      )
      .join("\n\n");
}

export function buildTaskPrompt(input: {
   checkFailures?: HarnessCheckResult[];
   reviewFeedback?: string;
   task: HarnessTask;
}): string {
   return `<task>
${input.task.title}
</task>

<goal>
${input.task.goal}
</goal>

<scope>
${renderList(input.task.scope)}
</scope>

<acceptance>
${renderList(input.task.acceptance)}
</acceptance>

<instructions>
- Implement exactly this task and keep changes scoped to the stated goal.
- Inspect the relevant files before editing.
- Run or explain the relevant verification when practical.
- If blocked by missing evidence, credentials, or an unsafe tradeoff, stop and explain the blocker.
</instructions>${
      input.checkFailures === undefined || input.checkFailures.length === 0
         ? ""
         : `

<verification_failures>
${renderCheckFailures(input.checkFailures)}
</verification_failures>`
   }${
      input.reviewFeedback === undefined || input.reviewFeedback.length === 0
         ? ""
         : `

<review_feedback>
${truncate(input.reviewFeedback)}
</review_feedback>`
   }`;
}

function buildReviewPrompt(input: {
   checkResults: HarnessCheckResult[];
   changedFiles: string[];
   gitSummary: string;
   task: HarnessTask;
}): string {
   return `<role>
You are the reviewer for a completed harness task.
</role>

<task>
${input.task.title}
</task>

<goal>
${input.task.goal}
</goal>

<scope>
${renderList(input.task.scope)}
</scope>

<acceptance>
${renderList(input.task.acceptance)}
</acceptance>

<checks>
${renderCheckSummary(input.checkResults)}
</checks>

<changed_files>
${renderList(input.changedFiles)}
</changed_files>

<git_summary>
${truncate(input.gitSummary)}
</git_summary>

<instructions>
- Review the actual diff in the working tree.
- Look for bugs, regressions, missing tests, and behavior that violates the task.
- Do not request broad refactors.
- Start the answer with exactly "BLOCKING: none" or "BLOCKING: yes".
- If blocking findings exist, include concrete file/line guidance and the smallest acceptable fix.
</instructions>`;
}

function buildFinalReviewPrompt(input: {
   gitSummary: string;
   plan: HarnessPlan;
   reports: HarnessTaskReport[];
}): string {
   const taskSummaries = input.reports
      .map(
         (report) =>
            `- ${report.id}: ${report.status}; checks=${report.checkAttempts.flat().filter((check) => !check.passed).length === 0 ? "passed" : "failed"}; review=${report.reviewStatus ?? "not-run"}`
      )
      .join("\n");

   return `<role>
You are the final integration reviewer for a completed harness plan.
</role>

<plan>
${input.plan.id}
</plan>

<task_results>
${taskSummaries}
</task_results>

<git_summary>
${truncate(input.gitSummary)}
</git_summary>

<instructions>
- Review the accumulated working-tree diff.
- Check whether the tasks work together and whether verification is adequate.
- Start the answer with exactly "BLOCKING: none" or "BLOCKING: yes".
- If blocking findings exist, include concrete file/line guidance and the smallest acceptable fix.
</instructions>`;
}

async function runCommand(input: {
   args: string[];
   command: string;
   cwd: string;
   timeoutMs?: number;
}): Promise<{
   durationMs: number;
   exitCode: number | null;
   output: string;
   timedOut: boolean;
}> {
   const startedAt = Date.now();
   const process = Bun.spawn([input.command, ...input.args], {
      cwd: input.cwd,
      stderr: "pipe",
      stdout: "pipe"
   });
   let timedOut = false;
   const timer = setTimeout(() => {
      timedOut = true;
      process.kill();
   }, input.timeoutMs ?? DEFAULT_CHECK_TIMEOUT_MS);

   try {
      const [exitCode, stdout, stderr] = await Promise.all([
         process.exited,
         new Response(process.stdout).text(),
         new Response(process.stderr).text()
      ]);

      return {
         durationMs: Date.now() - startedAt,
         exitCode,
         output: [stdout.trimEnd(), stderr.trimEnd()]
            .filter((content) => content.length > 0)
            .join("\n\n"),
         timedOut
      };
   } finally {
      clearTimeout(timer);
   }
}

async function runChecks(input: {
   checks: HarnessCheck[];
   cwd: string;
}): Promise<HarnessCheckResult[]> {
   const results: HarnessCheckResult[] = [];

   for (const check of input.checks) {
      const result = await runCommand({
         args: check.args,
         command: check.command,
         cwd: input.cwd,
         ...(check.timeoutMs === undefined
            ? {}
            : { timeoutMs: check.timeoutMs })
      });

      results.push({
         args: check.args,
         command: check.command,
         durationMs: result.durationMs,
         exitCode: result.exitCode,
         name: check.name,
         output: result.output,
         passed: result.exitCode === 0 && !result.timedOut,
         timedOut: result.timedOut
      });
   }

   return results;
}

async function readGitSummary(cwd: string): Promise<{
   changedFiles: string[];
   summary: string;
}> {
   const status = await runCommand({
      args: ["status", "--short"],
      command: "git",
      cwd,
      timeoutMs: 30_000
   });
   const stat = await runCommand({
      args: ["diff", "--stat"],
      command: "git",
      cwd,
      timeoutMs: 30_000
   });
   const changedFiles = status.output
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter((line) => line.length > 0);

   return {
      changedFiles,
      summary: [status.output, stat.output]
         .filter((content) => content.trim().length > 0)
         .join("\n\n")
   };
}

function allChecksPassed(checks: HarnessCheckResult[]): boolean {
   return checks.every((check) => check.passed);
}

async function persistReport(input: {
   cwd: string;
   report: Omit<HarnessReport, "reportPath">;
}): Promise<HarnessReport> {
   const reportDir = path.join(input.cwd, ".aiman", "harness-runs");
   await mkdir(reportDir, { recursive: true });

   const safePlanId = input.report.planId.replace(/[^a-zA-Z0-9._-]+/g, "-");
   const timestamp = input.report.startedAt.replace(/[:.]/g, "-");
   const reportPath = path.join(reportDir, `${timestamp}-${safePlanId}.json`);
   const report = {
      ...input.report,
      reportPath
   };

   await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
   return report;
}

export async function runHarnessPlan(input: {
   plan: HarnessPlan;
   projectRoot?: string;
}): Promise<HarnessReport> {
   const aiman = await createAiman(
      input.projectRoot === undefined ? {} : { projectRoot: input.projectRoot }
   );
   const cwd = aiman.projectPaths.projectRoot;
   const startedAt = new Date().toISOString();
   const taskReports: HarnessTaskReport[] = [];
   let planFailed = false;

   for (const task of input.plan.tasks) {
      if (planFailed && !input.plan.continueOnFailure) {
         taskReports.push({
            builderRunIds: [],
            changedFiles: [],
            checkAttempts: [],
            id: task.id,
            reviewRunIds: [],
            reviewStatus: "skipped",
            status: "skipped",
            summary: "Skipped because an earlier task failed.",
            title: task.title
         });
         continue;
      }

      console.log(chalk.blue(`\nTask ${task.id}: ${task.title}`));

      const builderRunIds: string[] = [];
      const reviewRunIds: string[] = [];
      const checkAttempts: HarnessCheckResult[][] = [];
      let builderResult = await aiman.runs.run(input.plan.builderAgent, {
         task: buildTaskPrompt({ task })
      });
      builderRunIds.push(builderResult.runId);

      if (builderResult.status !== "success") {
         planFailed = true;
         taskReports.push({
            builderRunIds,
            changedFiles: [],
            checkAttempts,
            id: task.id,
            reviewRunIds,
            status: "failed",
            summary: `Builder run ${builderResult.runId} ended with ${builderResult.status}.`,
            title: task.title
         });
         continue;
      }

      const checks = [...input.plan.checks, ...task.checks];
      let latestChecks = await runChecks({ checks, cwd });
      let checksHadFailure = !allChecksPassed(latestChecks);
      checkAttempts.push(latestChecks);

      for (
         let retry = 0;
         !allChecksPassed(latestChecks) && retry < input.plan.maxCheckRetries;
         retry += 1
      ) {
         builderResult = await aiman.runs.run(input.plan.builderAgent, {
            task: buildTaskPrompt({
               checkFailures: latestChecks.filter((check) => !check.passed),
               task
            })
         });
         builderRunIds.push(builderResult.runId);

         if (builderResult.status !== "success") {
            break;
         }

         latestChecks = await runChecks({ checks, cwd });
         checkAttempts.push(latestChecks);
      }

      const gitState = await readGitSummary(cwd);

      if (
         builderResult.status !== "success" ||
         !allChecksPassed(latestChecks)
      ) {
         planFailed = true;
         taskReports.push({
            builderRunIds,
            changedFiles: gitState.changedFiles,
            checkAttempts,
            id: task.id,
            reviewRunIds,
            status: "failed",
            summary: "Builder or deterministic checks failed.",
            title: task.title
         });
         continue;
      }

      let reviewStatus: HarnessTaskReport["reviewStatus"] = "skipped";

      if (shouldReviewTask({ checksHadFailure, task })) {
         const reviewResult = await aiman.runs.run(input.plan.reviewerAgent, {
            task: buildReviewPrompt({
               changedFiles: gitState.changedFiles,
               checkResults: latestChecks,
               gitSummary: gitState.summary,
               task
            })
         });
         reviewRunIds.push(reviewResult.runId);
         reviewStatus = classifyReview(renderRunText(reviewResult));

         if (reviewResult.status !== "success" || reviewStatus === "unclear") {
            planFailed = true;
            taskReports.push({
               builderRunIds,
               changedFiles: gitState.changedFiles,
               checkAttempts,
               id: task.id,
               reviewRunIds,
               reviewStatus,
               status: "failed",
               summary:
                  "Reviewer failed or did not return a parseable blocking status.",
               title: task.title
            });
            continue;
         }

         if (reviewStatus === "blocking") {
            builderResult = await aiman.runs.run(input.plan.builderAgent, {
               task: buildTaskPrompt({
                  reviewFeedback: renderRunText(reviewResult),
                  task
               })
            });
            builderRunIds.push(builderResult.runId);

            latestChecks = await runChecks({ checks, cwd });
            checkAttempts.push(latestChecks);
            checksHadFailure =
               checksHadFailure || !allChecksPassed(latestChecks);

            if (
               builderResult.status !== "success" ||
               !allChecksPassed(latestChecks)
            ) {
               planFailed = true;
               taskReports.push({
                  builderRunIds,
                  changedFiles: (await readGitSummary(cwd)).changedFiles,
                  checkAttempts,
                  id: task.id,
                  reviewRunIds,
                  reviewStatus,
                  status: "failed",
                  summary: "Builder did not clear blocking review findings.",
                  title: task.title
               });
               continue;
            }
         }
      }

      taskReports.push({
         builderRunIds,
         changedFiles: (await readGitSummary(cwd)).changedFiles,
         checkAttempts,
         id: task.id,
         reviewRunIds,
         reviewStatus,
         status: "passed",
         summary: checksHadFailure
            ? "Passed after retry or review repair."
            : "Passed on the first verification path.",
         title: task.title
      });
      console.log(chalk.green(`PASS ${task.id}`));
   }

   let finalReviewRunId: string | undefined;
   let finalReviewStatus: HarnessReport["finalReviewStatus"] = "skipped";

   if (!planFailed && input.plan.finalReview === "always") {
      const gitState = await readGitSummary(cwd);
      const reviewResult = await aiman.runs.run(input.plan.reviewerAgent, {
         task: buildFinalReviewPrompt({
            gitSummary: gitState.summary,
            plan: input.plan,
            reports: taskReports
         })
      });
      finalReviewRunId = reviewResult.runId;
      finalReviewStatus = classifyReview(renderRunText(reviewResult));

      if (reviewResult.status !== "success" || finalReviewStatus !== "clear") {
         planFailed = true;
      }
   }

   const report = await persistReport({
      cwd,
      report: {
         ...(finalReviewRunId === undefined ? {} : { finalReviewRunId }),
         finalReviewStatus,
         endedAt: new Date().toISOString(),
         planId: input.plan.id,
         startedAt,
         status: planFailed ? "failed" : "passed",
         tasks: taskReports
      }
   });

   return report;
}

async function main() {
   const [planPath, projectRoot] = process.argv.slice(2);

   if (typeof planPath !== "string" || planPath.length === 0) {
      usage();
   }

   const plan = parseHarnessPlan(await readFile(planPath, "utf8"));
   const report = await runHarnessPlan({
      plan,
      ...(typeof projectRoot === "string" && projectRoot.length > 0
         ? { projectRoot }
         : {})
   });

   console.log(
      `\n${report.status === "passed" ? chalk.green("PASS") : chalk.red("FAIL")} ${report.planId}`
   );
   console.log(chalk.dim(`Report: ${report.reportPath}`));

   if (report.status !== "passed") {
      process.exit(1);
   }
}

if (import.meta.main) {
   await main();
}
