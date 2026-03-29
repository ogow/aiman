import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";

import { hasErrorCode } from "./errors.js";
import type {
   ReportArtifact,
   ReportFrontmatter,
   ReportValue,
   RunReport
} from "./types.js";

type ParsedYamlBlock = {
   nextIndex: number;
   value: ReportValue;
};

type YamlLine = {
   indent: number;
   text: string;
};

function parseScalar(value: string): string {
   const trimmed = value.trim();

   if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
   ) {
      return trimmed.slice(1, -1);
   }

   return trimmed;
}

function normalizeLines(rawFrontmatter: string): YamlLine[] {
   return rawFrontmatter.split("\n").map((line) => ({
      indent: line.match(/^ */)?.[0].length ?? 0,
      text: line.trimEnd()
   }));
}

function isBlankLine(line: YamlLine): boolean {
   return line.text.trim().length === 0;
}

function looksLikeInlineObject(text: string): boolean {
   return /^[A-Za-z0-9_-]+\s*:/.test(text);
}

function peekNextMeaningfulLine(
   lines: YamlLine[],
   startIndex: number
): YamlLine | undefined {
   for (let index = startIndex; index < lines.length; index += 1) {
      const line = lines[index];

      if (line && !isBlankLine(line)) {
         return line;
      }
   }

   return undefined;
}

function parseYamlBlock(
   lines: YamlLine[],
   startIndex: number,
   indent: number
): ParsedYamlBlock {
   const nextLine = peekNextMeaningfulLine(lines, startIndex);

   if (!nextLine || nextLine.indent < indent) {
      return {
         nextIndex: startIndex,
         value: ""
      };
   }

   return nextLine.text.trim().startsWith("- ")
      ? parseYamlList(lines, startIndex, indent)
      : parseYamlMap(lines, startIndex, indent);
}

function parseYamlMap(
   lines: YamlLine[],
   startIndex: number,
   indent: number
): ParsedYamlBlock {
   const value: ReportFrontmatter = {};
   let index = startIndex;

   while (index < lines.length) {
      const line = lines[index];

      if (!line) {
         break;
      }

      if (isBlankLine(line)) {
         index += 1;
         continue;
      }

      if (line.indent < indent) {
         break;
      }

      if (line.indent > indent) {
         throw new Error(
            `Invalid indentation in frontmatter line: ${line.text}`
         );
      }

      const trimmed = line.text.trim();

      if (trimmed.startsWith("- ")) {
         throw new Error(
            `Unexpected list item in frontmatter line: ${line.text}`
         );
      }

      const separatorIndex = trimmed.indexOf(":");

      if (separatorIndex === -1) {
         throw new Error(`Invalid frontmatter line: ${line.text}`);
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1);

      if (key.length === 0) {
         throw new Error(`Invalid frontmatter key in line: ${line.text}`);
      }

      index += 1;

      if (rawValue.trim().length > 0) {
         value[key] = parseScalar(rawValue);
         continue;
      }

      const nextLine = peekNextMeaningfulLine(lines, index);

      if (!nextLine || nextLine.indent <= indent) {
         value[key] = "";
         continue;
      }

      const parsed = parseYamlBlock(lines, index, indent + 2);
      value[key] = parsed.value;
      index = parsed.nextIndex;
   }

   return { nextIndex: index, value };
}

function parseYamlList(
   lines: YamlLine[],
   startIndex: number,
   indent: number
): ParsedYamlBlock {
   const value: ReportValue[] = [];
   let index = startIndex;

   while (index < lines.length) {
      const line = lines[index];

      if (!line) {
         break;
      }

      if (isBlankLine(line)) {
         index += 1;
         continue;
      }

      if (line.indent < indent) {
         break;
      }

      if (line.indent > indent) {
         throw new Error(
            `Invalid indentation in frontmatter line: ${line.text}`
         );
      }

      const trimmed = line.text.trim();

      if (!trimmed.startsWith("- ")) {
         throw new Error(
            `Unexpected map item in frontmatter line: ${line.text}`
         );
      }

      const itemContent = trimmed.slice(2).trim();
      index += 1;

      if (itemContent.length === 0) {
         const parsed = parseYamlBlock(lines, index, indent + 2);
         value.push(parsed.value);
         index = parsed.nextIndex;
         continue;
      }

      if (looksLikeInlineObject(itemContent)) {
         const separatorIndex = itemContent.indexOf(":");
         const key = itemContent.slice(0, separatorIndex).trim();
         const rawValue = itemContent.slice(separatorIndex + 1);
         const entry: ReportFrontmatter = {};

         if (rawValue.trim().length > 0) {
            entry[key] = parseScalar(rawValue);
         } else {
            const nextLine = peekNextMeaningfulLine(lines, index);

            if (!nextLine || nextLine.indent <= indent) {
               entry[key] = "";
            } else {
               const parsed = parseYamlBlock(lines, index, indent + 2);
               entry[key] = parsed.value;
               index = parsed.nextIndex;
            }
         }

         const nextLine = peekNextMeaningfulLine(lines, index);

         if (nextLine && nextLine.indent > indent) {
            const parsed = parseYamlMap(lines, index, indent + 2);

            if (
               typeof parsed.value === "object" &&
               !Array.isArray(parsed.value)
            ) {
               Object.assign(entry, parsed.value);
            }

            index = parsed.nextIndex;
         }

         value.push(entry);
         continue;
      }

      value.push(parseScalar(itemContent));
   }

   return { nextIndex: index, value };
}

function extractFrontmatter(markdown: string): {
   body: string;
   rawFrontmatter?: string;
} {
   const normalizedMarkdown = markdown.replace(/\r\n?/g, "\n");

   if (!normalizedMarkdown.startsWith("---\n")) {
      return { body: normalizedMarkdown };
   }

   const endIndex = normalizedMarkdown.indexOf("\n---\n", 4);

   if (endIndex === -1) {
      throw new Error("Report frontmatter is not closed.");
   }

   return {
      body: normalizedMarkdown.slice(endIndex + "\n---\n".length),
      rawFrontmatter: normalizedMarkdown.slice(4, endIndex)
   };
}

function parseReportFrontmatter(rawFrontmatter: string): ReportFrontmatter {
   const lines = normalizeLines(rawFrontmatter);
   const parsed = parseYamlMap(lines, 0, 0);

   if (typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      throw new Error("Report frontmatter must be a map.");
   }

   return parsed.value;
}

function buildArtifacts(
   frontmatter: ReportFrontmatter,
   artifactsDir: string
): ReportArtifact[] {
   const artifacts = frontmatter.artifacts;

   if (!Array.isArray(artifacts)) {
      return [];
   }

   return artifacts.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
         return [];
      }

      const record = entry as Record<string, ReportValue>;
      const relativePath = record.path;

      if (typeof relativePath !== "string" || relativePath.length === 0) {
         return [];
      }

      const resolvedPath = path.resolve(artifactsDir, relativePath);

      return [
         {
            exists: false,
            ...(typeof record.kind === "string" ? { kind: record.kind } : {}),
            ...(typeof record.label === "string"
               ? { label: record.label }
               : {}),
            ...(record.metadata !== undefined
               ? { metadata: record.metadata }
               : {}),
            path: relativePath,
            resolvedPath
         }
      ];
   });
}

async function populateArtifactExistence(
   artifacts: ReportArtifact[]
): Promise<ReportArtifact[]> {
   return Promise.all(
      artifacts.map(async (artifact) => {
         try {
            await stat(artifact.resolvedPath);
            return {
               ...artifact,
               exists: true
            };
         } catch (error) {
            if (hasErrorCode(error, "ENOENT")) {
               return artifact;
            }

            throw error;
         }
      })
   );
}

export async function readRunReport(
   reportPath: string,
   artifactsDir: string
): Promise<RunReport> {
   try {
      const markdown = await readFile(reportPath, "utf8");
      const extracted = extractFrontmatter(markdown);

      if (extracted.rawFrontmatter === undefined) {
         return {
            artifacts: [],
            body: extracted.body,
            exists: true,
            path: reportPath
         };
      }

      const frontmatter = parseReportFrontmatter(extracted.rawFrontmatter);
      const artifacts = await populateArtifactExistence(
         buildArtifacts(frontmatter, artifactsDir)
      );

      return {
         artifacts,
         body: extracted.body,
         exists: true,
         frontmatter,
         path: reportPath
      };
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return {
            artifacts: [],
            exists: false,
            path: reportPath
         };
      }

      return {
         artifacts: [],
         exists: true,
         parseError: error instanceof Error ? error.message : String(error),
         path: reportPath
      };
   }
}
