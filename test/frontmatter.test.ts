import { expect, test, describe } from "bun:test";
import { parseFrontmatter } from "../src/lib/frontmatter.js";
import { UserError } from "../src/lib/errors.js";

describe("parseFrontmatter", () => {
   test("parses valid frontmatter", () => {
      const input = "---\ntitle: Hello\n---\nWorld";
      const result = parseFrontmatter(input);
      expect(result.attributes).toEqual({ title: "Hello" });
      expect(result.body).toBe("World");
   });

   test("normalizes CRLF", () => {
      const input = "---\r\ntitle: Hello\r\n---\r\nWorld\r\n";
      const result = parseFrontmatter(input);
      expect(result.attributes).toEqual({ title: "Hello" });
      expect(result.body).toBe("World");
   });

   test("throws UserError if frontmatter does not start correctly", () => {
      const input = "title: Hello\n---\nWorld";
      expect(() => parseFrontmatter(input)).toThrow(UserError);
      expect(() => parseFrontmatter(input)).toThrow("Agent file must start with frontmatter.");
   });

   test("throws UserError if frontmatter is not closed", () => {
      const input = "---\ntitle: Hello\nWorld";
      expect(() => parseFrontmatter(input)).toThrow(UserError);
      expect(() => parseFrontmatter(input)).toThrow("Agent frontmatter is not closed.");
   });

   test("throws UserError if frontmatter cannot be parsed", () => {
      const input = "---\ntitle: *invalid: yaml: :\n---\nWorld";
      expect(() => parseFrontmatter(input)).toThrow(UserError);
      expect(() => parseFrontmatter(input)).toThrow(/Agent frontmatter could not be parsed/);
   });

   test("returns empty attributes if parsed data is an array", () => {
      const input = "---\n- array item\n---\nWorld";
      const result = parseFrontmatter(input);
      expect(result.attributes).toEqual({});
      expect(result.body).toBe("World");
   });

   test("returns empty attributes if parsed data is null or empty", () => {
      const input = "---\n---\nWorld";
      const result = parseFrontmatter(input);
      expect(result.attributes).toEqual({});
      expect(result.body).toBe("World");
   });
});
