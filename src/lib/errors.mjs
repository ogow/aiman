const ANSI = {
  reset: "\u001b[0m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  bold: "\u001b[1m"
};

function colorize(color, text) {
  return `${color}${text}${ANSI.reset}`;
}

export class AppError extends Error {
  constructor({
    code,
    title,
    message,
    fix = null,
    details = null
  }) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.title = title;
    this.fix = fix;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message, options = {}) {
    super({
      code: "validation_error",
      title: "Validation failed",
      message,
      ...options
    });
  }
}

export class AgentNotFoundError extends AppError {
  constructor(agentName) {
    super({
      code: "agent_not_found",
      title: "Agent not found",
      message: `No visible agent exists for name '${agentName}'.`,
      fix: "Create the agent in the home or project registry, or use agent_list."
    });
  }
}

export class AgentConfigError extends AppError {
  constructor({ filePath, message, fix = null }) {
    super({
      code: "agent_config_error",
      title: "Invalid agent file",
      message: `Agent file '${filePath}' is invalid: ${message}`,
      fix: fix ?? "Fix the frontmatter/body in that Markdown file and try again.",
      details: {
        filePath
      }
    });
  }
}

export class RunNotFoundError extends AppError {
  constructor(runId) {
    super({
      code: "run_not_found",
      title: "Run not found",
      message: `No run exists for id '${runId}'.`,
      fix: "Use a valid run id from run_spawn or run_list."
    });
  }
}

export class ModelNotFoundError extends AppError {
  constructor({ provider, model, availableModels }) {
    super({
      code: "model_not_found",
      title: "Model not found",
      message: `Provider '${provider}' does not support model '${model}'.`,
      fix:
        availableModels.length > 0
          ? `Use one of: ${availableModels.join(", ")}`
          : "Use a model supported by that provider.",
      details: {
        provider,
        requestedModel: model,
        availableModels
      }
    });
  }
}

export class RunnerNotFoundError extends AppError {
  constructor(provider) {
    super({
      code: "runner_not_found",
      title: "Runner not found",
      message: `No runner is configured for provider '${provider}'.`,
      fix: "Use a supported provider or add a runner adapter for it."
    });
  }
}

export class BinaryNotFoundError extends AppError {
  constructor(command) {
    super({
      code: "binary_not_found",
      title: "Command not found",
      message: `The command '${command}' is not available on this machine.`,
      fix: "Install the CLI or update the template command."
    });
  }
}

export function toAppError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error?.code === "ENOENT" && error?.syscall === "spawn") {
    return new BinaryNotFoundError(error.path ?? "unknown");
  }

  return new AppError({
    code: "internal_error",
    title: "Unexpected error",
    message: error instanceof Error ? error.message : String(error),
    fix: "Check the run logs and the template configuration."
  });
}

export function formatErrorMessage(error) {
  const appError = toAppError(error);
  const lines = [
    colorize(ANSI.red, `${ANSI.bold}ERROR:${ANSI.reset}${ANSI.red} ${appError.title}${ANSI.reset}`),
    colorize(ANSI.red, appError.message)
  ];

  if (appError.details) {
    for (const [key, value] of Object.entries(appError.details)) {
      const renderedValue = Array.isArray(value) ? value.join(", ") : String(value);
      lines.push(colorize(ANSI.red, `${key}: ${renderedValue}`));
    }
  }

  if (appError.fix) {
    lines.push(colorize(ANSI.yellow, `Fix: ${appError.fix}`));
  }

  return lines.join("\n");
}

export function serializeError(error) {
  const appError = toAppError(error);

  return {
    code: appError.code,
    title: appError.title,
    message: appError.message,
    fix: appError.fix,
    details: appError.details
  };
}
