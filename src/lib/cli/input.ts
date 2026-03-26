import { readFile } from "node:fs/promises";
import path from "node:path";

import { ValidationError } from "../errors.js";
import type { ReadableInput } from "../types.js";

export function parsePositiveInteger(
   value: string | number | undefined | null,
   flagName: string
): number | undefined {
   if (value === undefined || value === null) {
      return undefined;
   }

   const parsed = Number.parseInt(String(value), 10);

   if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ValidationError(`${flagName} must be a positive integer.`);
   }

   return parsed;
}

export function normalizeWriteScope(
   value: string | string[] | undefined
): string[] {
   if (!value) {
      return [];
   }

   const values = Array.isArray(value) ? value : [value];

   return values
      .flatMap((entry) => String(entry).split(","))
      .map((entry) => entry.trim())
      .filter(Boolean);
}

export function requireSinglePositional(
   positionals: string[],
   name: string
): string {
   if (positionals.length !== 1) {
      throw new ValidationError(`${name} requires exactly one value.`);
   }

   const [value] = positionals;

   if (!value) {
      throw new ValidationError(`${name} requires exactly one value.`);
   }

   return value;
}

export async function readStdinText(
   stdin: ReadableInput = process.stdin
): Promise<string> {
   if (stdin.isTTY) {
      return "";
   }

   let text = "";
   stdin.setEncoding("utf8");

   for await (const chunk of stdin) {
      text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
   }

   return text.trim();
}

export async function readInputFile(
   filePath: string,
   cwd: string,
   label: string
): Promise<string> {
   const resolvedPath = path.resolve(cwd, filePath);

   try {
      return (await readFile(resolvedPath, "utf8")).trim();
   } catch (error) {
      if (
         typeof error === "object" &&
         error !== null &&
         "code" in error &&
         error.code === "ENOENT"
      ) {
         throw new ValidationError(
            `${label} file '${filePath}' does not exist.`
         );
      }

      throw error;
   }
}

export async function resolveTextInput({
   value,
   filePath,
   stdinText,
   cwd,
   label,
   valueFlag,
   fileFlag
}: {
   value?: string | undefined;
   filePath?: string | undefined;
   stdinText?: string | undefined;
   cwd: string;
   label: string;
   valueFlag: string;
   fileFlag: string;
}): Promise<string> {
   const trimmedValue = typeof value === "string" ? value.trim() : "";
   const trimmedStdin = typeof stdinText === "string" ? stdinText.trim() : "";
   const sourceCount = [
      Boolean(trimmedValue),
      Boolean(filePath),
      Boolean(trimmedStdin)
   ].filter(Boolean).length;

   if (sourceCount > 1) {
      throw new ValidationError(`${label} must come from exactly one source.`, {
         fix: `Use only one of ${valueFlag}, ${fileFlag}, or stdin.`
      });
   }

   if (trimmedValue) {
      return trimmedValue;
   }

   if (filePath) {
      const fileText = await readInputFile(filePath, cwd, label);

      if (!fileText) {
         throw new ValidationError(`${label} must be a non-empty string.`);
      }

      return fileText;
   }

   if (trimmedStdin) {
      return trimmedStdin;
   }

   throw new ValidationError(`${label} must be provided.`, {
      fix: `Pass ${valueFlag}, ${fileFlag}, or pipe text on stdin.`
   });
}
