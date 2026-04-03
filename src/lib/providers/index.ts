import type { ProviderAdapter, ProviderId } from "../types.js";
import { createCodexAdapter } from "./codex.js";
import { createGeminiAdapter } from "./gemini.js";

const adapters: Record<ProviderId, ProviderAdapter> = {
   codex: createCodexAdapter(),
   gemini: createGeminiAdapter()
};

export function getAdapterForProvider(provider: ProviderId): ProviderAdapter {
   return adapters[provider];
}
