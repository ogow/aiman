import { UserError } from "./errors.js";

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

export function parseFrontmatter(markdown: string): {
   attributes: Record<string, string>;
   body: string;
} {
   const normalizedMarkdown = markdown.replace(/\r\n?/g, "\n");

   if (!normalizedMarkdown.startsWith("---\n")) {
      throw new UserError("Agent file must start with frontmatter.");
   }

   const endIndex = normalizedMarkdown.indexOf("\n---\n", 4);

   if (endIndex === -1) {
      throw new UserError("Agent frontmatter is not closed.");
   }

   const rawFrontmatter = normalizedMarkdown.slice(4, endIndex);
   const rawBody = normalizedMarkdown.slice(endIndex + "\n---\n".length);
   const attributes: Record<string, string> = {};

   for (const line of rawFrontmatter.split("\n")) {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
         continue;
      }

      const separatorIndex = trimmed.indexOf(":");

      if (separatorIndex === -1) {
         throw new UserError(`Invalid frontmatter line: ${line}`);
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1);

      if (key.length === 0) {
         throw new UserError(`Invalid frontmatter key in line: ${line}`);
      }

      attributes[key] = parseScalar(value);
   }

   return {
      attributes,
      body: rawBody.trim()
   };
}
