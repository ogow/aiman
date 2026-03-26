#!/usr/bin/env node

import { RunStore } from "./lib/run-store.js";
import { serializeError, toAppError } from "./lib/errors.js";
import { createApplication } from "./lib/app.js";
import type { RunStatus } from "./lib/types.js";

function getFlagValue(args: string[], flagName: string): string {
  const index = args.indexOf(flagName);

  if (index === -1) {
    return "";
  }

  return args[index + 1] ?? "";
}

function isTerminalStatus(status: RunStatus): boolean {
  return (
    status === "completed" || status === "failed" || status === "cancelled"
  );
}

async function markWorkerFailure(
  rootDir: string,
  runId: string,
  error: unknown
): Promise<void> {
  if (!rootDir || !runId) {
    return;
  }

  const runStore = new RunStore(rootDir);
  await runStore.init();
  const run = await runStore.getRun(runId);

  if (!run || isTerminalStatus(run.status)) {
    return;
  }

  const appError = toAppError(error);
  await runStore.updateRun(runId, {
    status: "failed",
    finishedAt: new Date().toISOString(),
    exitCode: -1,
    resultSummary: appError.message
  });
  await runStore.appendEvent(runId, "worker_failed", {
    error: serializeError(appError)
  });
}

async function main() {
  const args = process.argv.slice(2);
  const rootDir = getFlagValue(args, "--root-dir");
  const runId = getFlagValue(args, "--run-id");

  if (!rootDir || !runId) {
    throw new Error("run-worker requires --root-dir and --run-id.");
  }

  const app = await createApplication({ rootDir });
  await app.runManager.startRun(runId);
  await app.runManager.waitForRun(runId, 365 * 24 * 60 * 60 * 1000);
}

main().catch(async (error: unknown) => {
  const args = process.argv.slice(2);
  const rootDir = getFlagValue(args, "--root-dir");
  const runId = getFlagValue(args, "--run-id");
  await markWorkerFailure(rootDir, runId, error);
  process.exit(1);
});
