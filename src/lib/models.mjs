const DEFAULT_MODELS = {
  codex: ["gpt-5", "gpt-5-mini"],
  claude: ["claude-opus-4.1", "claude-sonnet-4.5"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  test: ["test-model"]
};

export function getKnownModels(provider) {
  return DEFAULT_MODELS[provider] ?? [];
}

export function resolveSupportedModels(provider, templateSupportedModels = []) {
  return templateSupportedModels.length > 0 ? templateSupportedModels : getKnownModels(provider);
}
