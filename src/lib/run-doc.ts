import matter from "gray-matter";
import { readFile, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { hasErrorCode } from "./errors.js";
import type {
   MarkdownArtifact,
   MarkdownDocument,
   MarkdownFrontmatter,
   MarkdownValue
} from "./types.js";

function toMarkdownValue(value: unknown): MarkdownValue | undefined {
   if (value instanceof Date) {
      return value.toISOString();
   }

   if (
      value === null ||
      typeof value === "boolean" ||
      typeof value === "number" ||
      typeof value === "string"
   ) {
      return value;
   }

   if (Array.isArray(value)) {
      return value.flatMap((entry) => {
         const normalized = toMarkdownValue(entry);
         return normalized === undefined ? [] : [normalized];
      });
   }

   if (typeof value !== "object") {
      return undefined;
   }

   const record = value as Record<string, unknown>;

   return Object.fromEntries(
      Object.entries(record).flatMap(([key, entryValue]) => {
         const normalized = toMarkdownValue(entryValue);
         return normalized === undefined ? [] : [[key, normalized] as const];
      })
   );
}

function toMarkdownFrontmatter(value: unknown): MarkdownFrontmatter {
   if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return {};
   }

   return toMarkdownValue(value) as MarkdownFrontmatter;
}

function buildArtifacts(
   frontmatter: MarkdownFrontmatter,
   artifactsDir: string
): MarkdownArtifact[] {
   const artifacts = frontmatter.artifacts;
   const artifactsRoot = path.resolve(artifactsDir);

   if (!Array.isArray(artifacts)) {
      return [];
   }

   return artifacts.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
         return [];
      }

      const record = entry as Record<string, MarkdownValue>;
      const relativePath = record.path;

      if (typeof relativePath !== "string" || relativePath.length === 0) {
         return [];
      }

      const resolvedPath = path.resolve(artifactsRoot, relativePath);
      const relativeResolvedPath = path.relative(artifactsRoot, resolvedPath);

      if (
         relativeResolvedPath.startsWith("..") ||
         path.isAbsolute(relativeResolvedPath)
      ) {
         return [];
      }

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
   artifacts: MarkdownArtifact[]
): Promise<MarkdownArtifact[]> {
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

export async function readMarkdownDocument(
   filePath: string,
   artifactsDir: string
): Promise<MarkdownDocument> {
   try {
      const markdown = await readFile(filePath, "utf8");
      const parsed = matter(markdown);
      const frontmatter = toMarkdownFrontmatter(parsed.data);
      const artifacts = await populateArtifactExistence(
         buildArtifacts(frontmatter, artifactsDir)
      );

      return {
         artifacts,
         body: parsed.content,
         exists: true,
         frontmatter,
         path: filePath
      };
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return {
            artifacts: [],
            exists: false,
            path: filePath
         };
      }

      return {
         artifacts: [],
         exists: true,
         parseError: error instanceof Error ? error.message : String(error),
         path: filePath
      };
   }
}

export async function writeMarkdownDocument(input: {
   body: string;
   filePath: string;
   frontmatter: MarkdownFrontmatter;
}): Promise<void> {
   await writeFile(
      input.filePath,
      matter.stringify(input.body, input.frontmatter),
      "utf8"
   );
}
