import type { ProviderCapabilities, ProviderId } from "./types.js";

const environmentSummary =
   "Allowlisted runtime environment only: common shell vars, relevant API keys, and AIMAN_* run paths when present.";

const providerCapabilities: Record<ProviderId, ProviderCapabilities> = {
   codex: {
      details:
         "Runs with `codex exec --sandbox workspace-write --skip-git-repo-check` rooted at the selected project and grants the external run artifacts directory as an extra writable root via `--add-dir`.",
      environmentSummary,
      launchSummary:
         "write-enabled project workspace via --sandbox workspace-write; Codex git repo check skipped; artifacts dir writable via --add-dir",
      provider: "codex"
   },
   gemini: {
      details:
         "Runs with `gemini --approval-mode yolo` in the selected project and includes the external run artifacts directory in Gemini's workspace via `--include-directories`.",
      environmentSummary,
      launchSummary:
         "write-enabled project workspace via --approval-mode yolo; artifacts dir included via --include-directories",
      provider: "gemini"
   }
};

export function getProviderCapabilities(
   provider: ProviderId
): ProviderCapabilities {
   return providerCapabilities[provider];
}

export function formatRunRights(provider: ProviderId): string {
   return getProviderCapabilities(provider).launchSummary;
}
