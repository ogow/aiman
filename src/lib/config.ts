import { readFile } from "node:fs/promises";

import { UserError, hasErrorCode } from "./errors.js";
import type { ProjectPaths } from "./paths.js";
import type { AimanConfig, ResolvedAimanConfig } from "./types.js";

function normalizeContextFileName(
   fileName: string,
   sourcePath: string
): string {
   const trimmed = fileName.trim();

   if (
      trimmed.length === 0 ||
      trimmed === "." ||
      trimmed === ".." ||
      trimmed.includes("/") ||
      trimmed.includes("\\")
   ) {
      throw new UserError(
         `Config file "${sourcePath}" has invalid contextFileNames entry "${fileName}". Use bare file names like "AGENTS.md".`
      );
   }

   return trimmed;
}

function validateStringArray(
   value: unknown,
   fieldName: string,
   sourcePath: string
): string[] | undefined {
   if (value === undefined) {
      return undefined;
   }

   if (!Array.isArray(value)) {
      throw new UserError(
         `Config file "${sourcePath}" has invalid "${fieldName}": expected a JSON array of strings.`
      );
   }

   return value.map((entry, index) => {
      if (typeof entry !== "string") {
         throw new UserError(
            `Config file "${sourcePath}" has invalid "${fieldName}" at index ${index}: expected a string.`
         );
      }

      return entry;
   });
}

function normalizeContextFileNames(
   value: unknown,
   sourcePath: string
): string[] | undefined {
   const names = validateStringArray(value, "contextFileNames", sourcePath);

   if (names === undefined) {
      return undefined;
   }

   const normalized: string[] = [];
   const seen = new Set<string>();

   for (const entry of names) {
      const norm = normalizeContextFileName(entry, sourcePath);

      if (seen.has(norm)) {
         continue;
      }

      seen.add(norm);
      normalized.push(norm);
   }

   if (normalized.length === 0) {
      throw new UserError(
         `Config file "${sourcePath}" must declare at least one context file name when "contextFileNames" is set.`
      );
   }

   if (!seen.has("AGENTS.md")) {
      throw new UserError(
         `Config file "${sourcePath}" must include "AGENTS.md" in "contextFileNames" so all providers share the same bootstrap context contract.`
      );
   }

   return normalized;
}

function validateConfig(
   value: unknown,
   sourcePath: string
): AimanConfig | undefined {
   if (value === undefined) {
      return undefined;
   }

   if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new UserError(
         `Config file "${sourcePath}" must contain a top-level JSON object.`
      );
   }

   const record = value as Record<string, unknown>;
   const contextFileNames = normalizeContextFileNames(
      record.contextFileNames,
      sourcePath
   );

   if (contextFileNames === undefined) {
      return {};
   }

   return { contextFileNames };
}

async function readConfigFile(
   filePath: string
): Promise<AimanConfig | undefined> {
   try {
      const rawConfig = await readFile(filePath, "utf8");
      return validateConfig(JSON.parse(rawConfig) as unknown, filePath);
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return undefined;
      }

      if (error instanceof SyntaxError) {
         throw new UserError(
            `Config file "${filePath}" is not valid JSON: ${error.message}`
         );
      }

      throw error;
   }
}

export async function loadAimanConfig(
   projectPaths: ProjectPaths
): Promise<ResolvedAimanConfig> {
   const userConfig = await readConfigFile(projectPaths.userConfigPath);
   const projectConfig = await readConfigFile(projectPaths.projectConfigPath);

   const contextFileNames =
      projectConfig?.contextFileNames ?? userConfig?.contextFileNames;

   if (contextFileNames === undefined) {
      return {};
   }

   return { contextFileNames };
}
