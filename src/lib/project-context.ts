import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "../lib/errors.js";
import type { ProjectContext } from "../lib/types.js";

const runtimeSectionHeading = "## Aiman Runtime Context";
const maxRuntimeContextBytes = 16 * 1024;

function normalizeLineEndings(value: string): string {
   return value.replace(/\r\n?/g, "\n");
}

function extractRuntimeSection(markdown: string): string | undefined {
   const normalized = normalizeLineEndings(markdown);
   const headingIndex = normalized.indexOf(`${runtimeSectionHeading}\n`);

   if (headingIndex === -1) {
      return undefined;
   }

   const bodyStart = headingIndex + runtimeSectionHeading.length + 1;
   const nextHeadingIndex = normalized.indexOf("\n## ", bodyStart);
   const body = normalized
      .slice(bodyStart, nextHeadingIndex === -1 ? undefined : nextHeadingIndex)
      .trim();

   return body.length > 0 ? body : undefined;
}

export async function loadProjectContext(
   projectRoot: string
): Promise<ProjectContext | undefined> {
   const agentsFile = path.join(projectRoot, "AGENTS.md");
   let markdown: string;

   try {
      markdown = await readFile(agentsFile, "utf8");
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return undefined;
      }

      throw error;
   }

   const content = extractRuntimeSection(markdown);

   if (content === undefined) {
      return undefined;
   }

   const byteLength = Buffer.byteLength(content, "utf8");

   if (byteLength > maxRuntimeContextBytes) {
      throw new UserError(
         `AGENTS.md ${runtimeSectionHeading} exceeds ${maxRuntimeContextBytes} bytes. Keep it shorter so it remains reliable at run time.`
      );
   }

   return {
      content,
      path: "AGENTS.md#Aiman Runtime Context",
      title: runtimeSectionHeading
   };
}
