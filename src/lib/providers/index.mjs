import {
  ModelNotFoundError,
  RunnerNotFoundError
} from "../errors.mjs";
import { getKnownModels } from "../models.mjs";

function renderValue(value, variables) {
  return Object.entries(variables).reduce((output, [key, replacement]) => {
    return output.replaceAll(`{{${key}}}`, replacement);
  }, value);
}

function validateSelectedModel(agent, model) {
  const supportedModels = getKnownModels(agent.provider);

  if (model && supportedModels.length > 0 && !supportedModels.includes(model)) {
    throw new ModelNotFoundError({
      provider: agent.provider,
      model,
      availableModels: supportedModels
    });
  }
}

function renderPlan(command, args, variables, env = {}) {
  return {
    command: renderValue(command, variables),
    args: args.map((value) => renderValue(value, variables)),
    env
  };
}

function createProviderRunner({
  provider,
  defaultCommand,
  getDefaultArgs
}) {
  return {
    provider,
    buildRunPlan({ agent, model, workspace, assembledPrompt }) {
      validateSelectedModel(agent, model);

      const variables = {
        prompt: assembledPrompt,
        workspace,
        model: model ?? ""
      };
      const command = defaultCommand;
      const args = getDefaultArgs({ model: model ?? "", prompt: assembledPrompt, workspace });

      return renderPlan(command, args, variables);
    }
  };
}

const PROVIDER_RUNNERS = {
  codex: createProviderRunner({
    provider: "codex",
    defaultCommand: "codex",
    getDefaultArgs: ({ model, prompt }) => {
      const args = ["exec"];

      if (model) {
        args.push("--model", model);
      }

      args.push(prompt);
      return args;
    }
  }),
  claude: createProviderRunner({
    provider: "claude",
    defaultCommand: "claude",
    getDefaultArgs: ({ model, prompt }) => {
      const args = ["-p", prompt];

      if (model) {
        args.push("--model", model);
      }

      return args;
    }
  }),
  gemini: createProviderRunner({
    provider: "gemini",
    defaultCommand: "gemini",
    getDefaultArgs: ({ model, prompt }) => {
      const args = [];

      if (model) {
        args.push("-m", model);
      }

      args.push("-p", prompt);
      return args;
    }
  }),
  test: createProviderRunner({
    provider: "test",
    defaultCommand: "node",
    getDefaultArgs: ({ prompt }) => [
      "-e",
      [
        "const prompt = process.argv[1] ?? '';",
        "if (prompt.includes('__AIMAN_TEST_STUBBORN__')) {",
        "  process.on('SIGTERM', () => {});",
        "  setInterval(() => {}, 1000);",
        "} else if (prompt.includes('__AIMAN_TEST_SLOW__')) {",
        "  setTimeout(() => console.log('finished'), 5000);",
        "} else {",
        "  console.log(process.env.AGENT_MODEL);",
        "  console.log(prompt);",
        "}"
      ].join(" "),
      prompt
    ]
  })
};

export function resolveProviderRunner(provider) {
  const runner = PROVIDER_RUNNERS[provider];

  if (!runner) {
    throw new RunnerNotFoundError(provider);
  }

  return runner;
}

export function buildRunPlan({ agent, model, workspace, assembledPrompt }) {
  const runner = resolveProviderRunner(agent.provider);
  return runner.buildRunPlan({
    agent,
    model,
    workspace,
    assembledPrompt
  });
}
