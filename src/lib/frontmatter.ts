import matter from "gray-matter";

import { UserError } from "./errors.js";

export function parseFrontmatter(markdown: string): {
   attributes: Record<string, unknown>;
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

   try {
      const parsed = matter(normalizedMarkdown);
      const attributes =
         typeof parsed.data === "object" &&
         parsed.data !== null &&
         !Array.isArray(parsed.data)
            ? (parsed.data as Record<string, unknown>)
            : {};

      return {
         attributes,
         body: parsed.content.trim()
      };
   } catch (error) {
      throw new UserError(
         `Agent frontmatter could not be parsed: ${error instanceof Error ? error.message : String(error)}`
      );
   }
}
