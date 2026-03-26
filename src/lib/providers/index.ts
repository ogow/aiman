import {
  ModelNotFoundError,
  ReasoningEffortNotSupportedError,
  ValidationError,
  RunnerNotFoundError
} from "../errors.js";
import {
  describeReasoningEffort,
  getKnownModels,
  normalizeReasoningEffort,
  renderReasoningEffortForCli,
  supportsReasoningEffort
} from "../models.js";
import type { Agent, RunPlan } from "../types.js";

interface PlanVariables {
  prompt: string;
  workspace: string;
  model: string;
  reasoningEffort: string;
  cliReasoningEffort: string;
}

interface ProviderRunner {
  provider: string;
  buildRunPlan(input: {
    agent: Pick<Agent, "provider">;
    model: string;
    reasoningEffort?: string;
    workspace: string;
    assembledPrompt: string;
  }): RunPlan;
}

function renderValue(value: string, variables: PlanVariables): string {
  const entries = Object.entries(variables) as Array<
    [keyof PlanVariables, string]
  >;

  return entries.reduce((output, [key, replacement]) => {
    return output.replaceAll(`{{${key}}}`, replacement);
  }, value);
}

function validateSelectedModel(
  agent: Pick<Agent, "provider">,
  model: string
): void {
  const supportedModels = getKnownModels(agent.provider);

  if (model && supportedModels.length > 0 && !supportedModels.includes(model)) {
    throw new ModelNotFoundError({
      provider: agent.provider,
      model,
      availableModels: supportedModels
    });
  }
}

function validateSelectedReasoningEffort(
  provider: string,
  model: string,
  reasoningEffort: string
) {
  if (!reasoningEffort) {
    return {
      normalizedReasoningEffort: "",
      cliReasoningEffort: ""
    };
  }

  if (!supportsReasoningEffort(provider, model)) {
    throw new ReasoningEffortNotSupportedError({ provider, reasoningEffort });
  }

  const normalizedReasoningEffort = normalizeReasoningEffort(
    provider,
    model,
    reasoningEffort
  );

  if (!normalizedReasoningEffort) {
    throw new ValidationError(describeReasoningEffort(provider, model));
  }

  return {
    normalizedReasoningEffort,
    cliReasoningEffort: renderReasoningEffortForCli(
      provider,
      model,
      normalizedReasoningEffort
    )
  };
}

function renderPlan(
  command: string,
  args: string[],
  variables: PlanVariables,
  env: Record<string, string> = {}
): RunPlan {
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
}: {
  provider: string;
  defaultCommand: string;
  getDefaultArgs(
    this: void,
    input: {
      model: string;
      reasoningEffort: string;
      cliReasoningEffort: string;
      prompt: string;
      workspace: string;
    }
  ): string[];
}): ProviderRunner {
  return {
    provider,
    buildRunPlan({
      agent,
      model,
      reasoningEffort,
      workspace,
      assembledPrompt
    }) {
      validateSelectedModel(agent, model);
      const { normalizedReasoningEffort, cliReasoningEffort } =
        validateSelectedReasoningEffort(provider, model, reasoningEffort ?? "");

      const variables = {
        prompt: assembledPrompt,
        workspace,
        model: model ?? "",
        reasoningEffort: normalizedReasoningEffort,
        cliReasoningEffort
      };
      const command = defaultCommand;
      const args = getDefaultArgs({
        model: model ?? "",
        reasoningEffort: normalizedReasoningEffort,
        cliReasoningEffort,
        prompt: assembledPrompt,
        workspace
      });

      return renderPlan(command, args, variables);
    }
  };
}

const PROVIDER_RUNNERS: Record<string, ProviderRunner> = {
  codex: createProviderRunner({
    provider: "codex",
    defaultCommand: "codex",
    getDefaultArgs: ({ model, cliReasoningEffort, prompt }) => {
      const args = ["exec"];

      if (model) {
        args.push("--model", model);
      }

      if (cliReasoningEffort) {
        args.push(
          "--config",
          `model_reasoning_effort=${JSON.stringify(cliReasoningEffort)}`
        );
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
        "  console.log(process.env.AGENT_REASONING_EFFORT);",
        "  console.log(prompt);",
        "}"
      ].join(" "),
      prompt
    ]
  })
};

export function resolveProviderRunner(provider: string): ProviderRunner {
  const runner = PROVIDER_RUNNERS[provider];

  if (!runner) {
    throw new RunnerNotFoundError(provider);
  }

  return runner;
}

export function buildRunPlan({
  agent,
  model,
  reasoningEffort,
  workspace,
  assembledPrompt
}: {
  agent: Pick<Agent, "provider">;
  model: string;
  reasoningEffort?: string;
  workspace: string;
  assembledPrompt: string;
}): RunPlan {
  const runner = resolveProviderRunner(agent.provider);
  return runner.buildRunPlan({
    agent,
    model,
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    workspace,
    assembledPrompt
  });
}
