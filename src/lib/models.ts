import type { ProviderModelConfig, ReasoningEffortConfig } from "./types.js";

const PROVIDER_MODEL_CONFIGS: Record<string, ProviderModelConfig> = {
  codex: {
    models: [
      "gpt-5.4",
      "gpt-5.4-mini",
      "gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "gpt-5.2-codex",
      "gpt-5.2",
      "gpt-5.1-codex-max",
      "gpt-5.1",
      "gpt-5.1-codex",
      "gpt-5.1-codex-mini",
      "gpt-5-codex",
      "gpt-5-codex-mini",
      "gpt-5"
    ],
    defaultModel: "gpt-5.4",
    reasoningEffort: {
      values: ["low", "medium", "high", "xhigh"],
      aliases: {
        max: "xhigh"
      },
      toCliValue: (value: string) => value
    },
    modelOverrides: {
      "gpt-5.4-mini": {
        reasoningEffort: {
          values: ["low", "medium", "high", "xhigh"]
        }
      },
      "gpt-5.3-codex": {
        reasoningEffort: {
          values: ["low", "medium", "high", "xhigh"]
        }
      },
      "gpt-5.3-codex-spark": {
        reasoningEffort: {
          values: ["low", "medium", "high", "xhigh"]
        }
      },
      "gpt-5.2-codex": {
        reasoningEffort: {
          values: ["low", "medium", "high", "xhigh"]
        }
      },
      "gpt-5.2": {
        reasoningEffort: {
          values: ["low", "medium", "high", "xhigh"]
        }
      },
      "gpt-5.1-codex-max": {
        reasoningEffort: {
          values: ["low", "medium", "high", "xhigh"]
        }
      },
      "gpt-5.1": {
        reasoningEffort: {
          values: ["low", "medium", "high"]
        }
      },
      "gpt-5.1-codex": {
        reasoningEffort: {
          values: ["low", "medium", "high"]
        }
      },
      "gpt-5.1-codex-mini": {
        reasoningEffort: {
          values: ["medium", "high"]
        }
      },
      "gpt-5-codex": {
        reasoningEffort: {
          values: ["low", "medium", "high"]
        }
      },
      "gpt-5-codex-mini": {
        reasoningEffort: {
          values: ["medium", "high"]
        }
      },
      "gpt-5": {
        reasoningEffort: {
          values: ["minimal", "low", "medium", "high"]
        }
      }
    }
  },
  claude: {
    models: ["claude-opus-4.1", "claude-sonnet-4.5"]
  },
  gemini: {
    models: ["gemini-2.5-pro", "gemini-2.5-flash"]
  },
  test: {
    models: ["test-model"],
    defaultModel: "test-model",
    reasoningEffort: {
      values: ["low", "medium", "high"],
      aliases: {
        careful: "high"
      },
      toCliValue: (value: string) => `test-${value}`
    }
  }
};

function findMatchingValue(values: string[], candidate: string): string | null {
  return (
    values.find((value) => value.toLowerCase() === candidate.toLowerCase()) ??
    null
  );
}

function parseReasoningEffortArgs(modelOrValue: string, maybeValue?: string) {
  if (maybeValue === undefined) {
    return {
      model: "",
      value: modelOrValue
    };
  }

  return {
    model: modelOrValue,
    value: maybeValue
  };
}

export function getProviderModelConfig(
  provider: string
): ProviderModelConfig | null {
  return PROVIDER_MODEL_CONFIGS[provider] ?? null;
}

export function getKnownModels(provider: string): string[] {
  return getProviderModelConfig(provider)?.models ?? [];
}

export function resolveSupportedModels(
  provider: string,
  templateSupportedModels: string[] = []
): string[] {
  return templateSupportedModels.length > 0
    ? templateSupportedModels
    : getKnownModels(provider);
}

function resolveReasoningEffortConfig(
  provider: string,
  model = ""
): ReasoningEffortConfig | null {
  const providerConfig = getProviderModelConfig(provider);

  if (!providerConfig) {
    return null;
  }

  const normalizedModel = typeof model === "string" ? model.trim() : "";
  const selectedModel = normalizedModel || providerConfig.defaultModel || "";
  const baseConfig = providerConfig.reasoningEffort ?? null;
  const overrideConfig = selectedModel
    ? (providerConfig.modelOverrides?.[selectedModel]?.reasoningEffort ?? null)
    : null;

  if (
    normalizedModel &&
    selectedModel &&
    selectedModel !== providerConfig.defaultModel &&
    !overrideConfig
  ) {
    return null;
  }

  if (!baseConfig && !overrideConfig) {
    return null;
  }

  if (!overrideConfig) {
    return baseConfig;
  }

  const mergedConfig: ReasoningEffortConfig = {
    ...baseConfig,
    ...overrideConfig,
    aliases: {
      ...(baseConfig?.aliases ?? {}),
      ...(overrideConfig.aliases ?? {})
    },
    values: overrideConfig.values ?? baseConfig?.values ?? []
  };

  const toCliValue = overrideConfig.toCliValue ?? baseConfig?.toCliValue;

  if (toCliValue) {
    mergedConfig.toCliValue = toCliValue;
  }

  return mergedConfig;
}

export function getReasoningEffortValues(
  provider: string,
  model = ""
): string[] {
  return resolveReasoningEffortConfig(provider, model)?.values ?? [];
}

export function supportsReasoningEffort(provider: string, model = ""): boolean {
  return getReasoningEffortValues(provider, model).length > 0;
}

export function normalizeReasoningEffort(
  provider: string,
  modelOrValue: string,
  maybeValue?: string
): string {
  const { model, value } = parseReasoningEffortArgs(modelOrValue, maybeValue);
  const normalizedInput = typeof value === "string" ? value.trim() : "";

  if (!normalizedInput) {
    return "";
  }

  const config = resolveReasoningEffortConfig(provider, model);

  if (!config) {
    return normalizedInput;
  }

  const aliasValue = config.aliases?.[normalizedInput.toLowerCase()];

  if (aliasValue) {
    return findMatchingValue(config.values, aliasValue) ?? "";
  }

  return findMatchingValue(config.values, normalizedInput) ?? "";
}

export function renderReasoningEffortForCli(
  provider: string,
  modelOrValue: string,
  maybeValue?: string
): string {
  const { model, value } = parseReasoningEffortArgs(modelOrValue, maybeValue);
  const normalizedValue = normalizeReasoningEffort(provider, model, value);

  if (!normalizedValue) {
    return "";
  }

  const config = resolveReasoningEffortConfig(provider, model);

  if (!config) {
    return normalizedValue;
  }

  return typeof config.toCliValue === "function"
    ? config.toCliValue(normalizedValue)
    : normalizedValue;
}

export function describeReasoningEffort(provider: string, model = ""): string {
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  const values = getReasoningEffortValues(provider, normalizedModel);

  if (values.length === 0) {
    return "This provider does not support reasoningEffort.";
  }

  if (normalizedModel) {
    return `reasoningEffort for model '${normalizedModel}' must be one of: ${values.join(", ")}.`;
  }

  return `reasoningEffort must be one of: ${values.join(", ")}.`;
}
