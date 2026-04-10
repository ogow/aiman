import { UserError } from "./errors.js";
import { formatDuration } from "./pretty.js";

export const defaultRunTimeoutMs = 5 * 60 * 1000;
export const defaultKillGraceMs = 1 * 1000;

export function normalizeTimeoutMs(
   value: unknown,
   errorPrefix: string
): number | undefined {
   if (value === undefined) {
      return undefined;
   }

   const normalizedValue =
      typeof value === "string" && /^\d+$/.test(value.trim())
         ? Number(value.trim())
         : value;

   if (
      typeof normalizedValue !== "number" ||
      !Number.isSafeInteger(normalizedValue) ||
      normalizedValue < 0
   ) {
      throw new UserError(
         `${errorPrefix}. Use a non-negative integer number of milliseconds; use 0 to disable the timeout.`
      );
   }

   return normalizedValue;
}

export function resolveRunTimeoutMs(input: {
   authoredTimeoutMs?: number;
   overrideTimeoutMs?: number;
}): number {
   return (
      input.overrideTimeoutMs ?? input.authoredTimeoutMs ?? defaultRunTimeoutMs
   );
}

export function formatRunTimeout(timeoutMs: number): string {
   return timeoutMs === 0 ? "none" : formatDuration(timeoutMs);
}

export function formatAuthoredTimeout(timeoutMs?: number): string {
   return timeoutMs === undefined
      ? `default (${formatRunTimeout(defaultRunTimeoutMs)})`
      : formatRunTimeout(timeoutMs);
}
