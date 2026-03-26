import { formatErrorMessage, serializeError, toAppError } from "../errors.js";
import type { CliIO, RunEvent } from "../types.js";

function formatAgent(
  agent: Record<string, unknown> & {
    name: string;
    provider: string;
    source: string;
    path: string;
    description?: string;
    model?: string;
    reasoningEffort?: string;
  }
): string {
  const lines = [
    `Name: ${agent.name}`,
    `Provider: ${agent.provider}`,
    `Source: ${agent.source}`,
    `Path: ${agent.path}`
  ];

  if (agent.description) {
    lines.push(`Description: ${agent.description}`);
  }

  if (agent.model) {
    lines.push(`Model: ${agent.model}`);
  }

  if (agent.reasoningEffort) {
    lines.push(`Reasoning Effort: ${agent.reasoningEffort}`);
  }

  return lines.join("\n");
}

function formatRun(
  run: Record<string, unknown> & {
    id: string;
    status: string;
    agentName: string;
    provider: string;
    workspace: string;
    model?: string;
    reasoningEffort?: string;
    pid?: number | null;
    resultSummary?: string | null;
  }
): string {
  const lines = [
    `Run: ${run.id}`,
    `Status: ${run.status}`,
    `Agent: ${run.agentName}`,
    `Provider: ${run.provider}`,
    `Workspace: ${run.workspace}`
  ];

  if (run.model) {
    lines.push(`Model: ${run.model}`);
  }

  if (run.reasoningEffort) {
    lines.push(`Reasoning Effort: ${run.reasoningEffort}`);
  }

  if (run.pid) {
    lines.push(`PID: ${run.pid}`);
  }

  if (run.resultSummary) {
    lines.push(`Summary: ${run.resultSummary}`);
  }

  return lines.join("\n");
}

function formatAgentList(
  agents: Array<{
    name: string;
    provider: string;
    source: string;
    model?: string;
  }>
): string {
  if (agents.length === 0) {
    return "No agents found.";
  }

  return agents
    .map(
      (agent) =>
        `${agent.name}  ${agent.provider}  ${agent.source}${agent.model ? `  ${agent.model}` : ""}`
    )
    .join("\n");
}

function formatRunList(
  runs: Array<{
    id: string;
    status: string;
    agentName: string;
    provider: string;
  }>
): string {
  if (runs.length === 0) {
    return "No runs found.";
  }

  return runs
    .map((run) => `${run.id}  ${run.status}  ${run.agentName}  ${run.provider}`)
    .join("\n");
}

function formatEvents(events: RunEvent[]): string {
  if (events.length === 0) {
    return "No log events found.";
  }

  return events
    .flatMap((event) => {
      if (
        (event.type === "stdout" || event.type === "stderr") &&
        typeof event.payload === "object" &&
        event.payload !== null &&
        "text" in event.payload &&
        typeof event.payload.text === "string"
      ) {
        return event.payload.text
          .split("\n")
          .filter(Boolean)
          .map((line: string) => `${event.type} | ${line}`);
      }

      return `${event.timestamp}  ${event.type}  ${JSON.stringify(event.payload)}`;
    })
    .join("\n");
}

export function formatCommandResult(command: string, result: unknown): string {
  switch (command) {
    case "agent:list":
      return formatAgentList(
        (
          result as {
            agents: Array<{
              name: string;
              provider: string;
              source: string;
              model?: string;
            }>;
          }
        ).agents
      );
    case "agent:get":
    case "agent:create":
      return formatAgent(
        ((result as { agent?: Record<string, unknown> }).agent ??
          result) as Record<string, unknown> & {
          name: string;
          provider: string;
          source: string;
          path: string;
          description?: string;
          model?: string;
          reasoningEffort?: string;
        }
      );
    case "run:list":
      return formatRunList(
        (
          result as {
            runs: Array<{
              id: string;
              status: string;
              agentName: string;
              provider: string;
            }>;
          }
        ).runs
      );
    case "run:get":
    case "run:spawn":
    case "run:wait":
    case "run:cancel":
      return formatRun(
        (result as { run: Record<string, unknown> }).run as Record<
          string,
          unknown
        > & {
          id: string;
          status: string;
          agentName: string;
          provider: string;
          workspace: string;
          model?: string;
          reasoningEffort?: string;
          pid?: number | null;
          resultSummary?: string | null;
        }
      );
    case "run:logs":
      return formatEvents((result as { events: RunEvent[] }).events);
    default:
      return JSON.stringify(result, null, 2);
  }
}

function renderJson(io: CliIO, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function renderHuman(io: CliIO, text: string): void {
  io.stdout.write(`${text}\n`);
}

export function renderResponse(
  io: CliIO,
  {
    json,
    command,
    result
  }: {
    json: boolean;
    command: string;
    result: unknown;
  }
): void {
  if (json) {
    renderJson(io, result);
    return;
  }

  renderHuman(io, formatCommandResult(command, result));
}

export function renderError(
  io: CliIO,
  { json, error }: { json: boolean; error: unknown }
): void {
  if (json) {
    renderJson(io, {
      error: serializeError(error)
    });
    return;
  }

  io.stderr.write(`${formatErrorMessage(error)}\n`);
}

export function getExitCode(error: unknown): number {
  const appError = toAppError(error);

  if (appError.code === "internal_error") {
    return 1;
  }

  return 2;
}
