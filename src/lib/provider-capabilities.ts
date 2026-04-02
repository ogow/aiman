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
               "Safe mode reads the workspace without writing; aiman launches Codex with `--sandbox read-only`.",
            mode: "safe",
            providerControl: "--sandbox read-only",
            summary: "safe read-only workspace access"
         },
         {
            details:
               "Yolo mode can read and modify files in the selected working directory; aiman launches Codex with `--sandbox workspace-write`.",
            mode: "yolo",
            providerControl: "--sandbox workspace-write",
            summary: "yolo read/write workspace access"
         }
      ],
      provider: "codex"
   },
   gemini: {
      environmentSummary,
      modes: [
         {
            details:
               "Safe mode keeps Gemini in planning/no-edit behavior via `--approval-mode plan`.",
            mode: "safe",
            providerControl: "--approval-mode plan",
            summary: "plan/no-edit mode"
         },
         {
            details:
               "Yolo mode launches Gemini with `--approval-mode auto_edit`, so it may modify files in the selected working directory.",
            mode: "yolo",
            providerControl: "--approval-mode auto_edit",
            summary: "auto-edit workspace access"
         }
      ],
      provider: "gemini"
   }
};

function normalizeMode(mode: RunMode): "safe" | "yolo" {
   return mode === "workspace-write" || mode === "yolo" ? "yolo" : "safe";
}

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
      (currentCapability) => currentCapability.mode === normalizeMode(mode)
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
