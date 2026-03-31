import type {
   ProviderCapabilities,
   ProviderId,
   RunMode,
   RunModeCapability
} from "./types.js";

const environmentSummary =
   "Allowlisted runtime environment only: common shell vars, relevant API keys, and AIMAN_* run paths when present.";

const providerCapabilities: Record<ProviderId, ProviderCapabilities> = {
   codex: {
      environmentSummary,
      modes: [
         {
            details:
               "Can read files in the selected working directory; aiman launches Codex with `--sandbox read-only`.",
            mode: "read-only",
            providerControl: "--sandbox read-only",
            summary: "read-only workspace access"
         },
         {
            details:
               "Can read and modify files in the selected working directory; aiman launches Codex with `--sandbox workspace-write`.",
            mode: "workspace-write",
            providerControl: "--sandbox workspace-write",
            summary: "read/write workspace access"
         }
      ],
      provider: "codex"
   },
   gemini: {
      environmentSummary,
      modes: [
         {
            details:
               "No-edit path; aiman launches Gemini with `--approval-mode plan` for planning/read-only behavior.",
            mode: "read-only",
            providerControl: "--approval-mode plan",
            summary: "plan/no-edit mode"
         },
         {
            details:
               "Edit path; aiman launches Gemini with `--approval-mode auto_edit`, so it may modify files in the selected working directory.",
            mode: "workspace-write",
            providerControl: "--approval-mode auto_edit",
            summary: "auto-edit workspace access"
         }
      ],
      provider: "gemini"
   }
};

export function getProviderCapabilities(
   provider: ProviderId
): ProviderCapabilities {
   return providerCapabilities[provider];
}

export function getRunModeCapability(
   provider: ProviderId,
   mode: RunMode
): RunModeCapability {
   const capability = getProviderCapabilities(provider).modes.find(
      (currentCapability) => currentCapability.mode === mode
   );

   if (capability === undefined) {
      throw new Error(
         `Provider "${provider}" does not define capabilities for mode "${mode}".`
      );
   }

   return capability;
}

export function summarizeProviderModes(provider: ProviderId): string {
   return getProviderCapabilities(provider)
      .modes.map((capability) => capability.mode)
      .join(", ");
}

export function formatRunRights(provider: ProviderId, mode: RunMode): string {
   const capability = getRunModeCapability(provider, mode);
   return `${capability.summary} via ${capability.providerControl}`;
}
