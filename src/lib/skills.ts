import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
   getSkillsDirectoryForScope,
   type ProjectPaths
} from "./paths.js";
import type {
   ProfileDefinition,
   ProfileScope,
   PromptSkill,
   ResolvedSkill,
   RunMode,
   ValidationIssue
} from "./types.js";

type SkillSelectionResult = {
   active: ResolvedSkill[];
   suggested: ResolvedSkill[];
};

const runModes = new Set<RunMode>(["safe", "yolo"]);
const profileScopes = ["project", "user"] as const;

function hashText(value: string): string {
   return createHash("sha256").update(value).digest("hex");
}

function validateSkillName(name: string): string {
   const trimmed = name.trim();

   if (
      trimmed.length === 0 ||
      trimmed === "." ||
      trimmed === ".." ||
      trimmed.includes("/") ||
      trimmed.includes("\\")
   ) {
      throw new UserError(
         `Skill "${name}" is invalid. Use a single skill directory name.`
      );
   }

   return trimmed;
}

function parseStringList(
   input: {
      code: string;
      field: string;
      name: string;
      value: unknown;
   }
): string[] {
   if (input.value === undefined) {
      return [];
   }

   if (!Array.isArray(input.value)) {
      throw new UserError(
         `Skill "${input.name}" has invalid ${input.field}: expected a YAML list of strings.`
      );
   }

   const values: string[] = [];
   const seen = new Set<string>();

   for (const entry of input.value) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
         throw new UserError(
            `Skill "${input.name}" has invalid ${input.field}: expected a YAML list of strings.`
         );
      }

      const normalized = entry.trim();

      if (seen.has(normalized)) {
         throw new UserError(
            `Skill "${input.name}" declares duplicate ${input.field} entries.`
         );
      }

      seen.add(normalized);
      values.push(normalized);
   }

   return values;
}

function parseModes(name: string, value: unknown): RunMode[] | undefined {
   const modes = parseStringList({
      code: "invalid-modes",
      field: "modes",
      name,
      value
   });

   if (modes.length === 0) {
      return undefined;
   }

   for (const mode of modes) {
      if (!runModes.has(mode as RunMode)) {
         throw new UserError(`Skill "${name}" has invalid mode "${mode}".`);
      }
   }

   return modes as RunMode[];
}

async function readSkillDefinition(input: {
   filePath: string;
   name: string;
   scope: ProfileScope;
}): Promise<PromptSkill> {
   const markdown = await readFile(input.filePath, "utf8");
   const parsed = parseFrontmatter(markdown);
   const description = parsed.attributes.description;
   const frontmatterName = parsed.attributes.name;
   const resolvedName =
      typeof frontmatterName === "string" && frontmatterName.trim().length > 0
         ? validateSkillName(frontmatterName)
         : validateSkillName(input.name);
   const modes = parseModes(resolvedName, parsed.attributes.modes);
   const profiles = parseStringList({
      code: "invalid-profiles",
      field: "profiles",
      name: resolvedName,
      value: parsed.attributes.profiles
   });

   return {
      body: parsed.body,
      description: typeof description === "string" ? description.trim() : "",
      keywords: parseStringList({
         code: "invalid-keywords",
         field: "keywords",
         name: resolvedName,
         value: parsed.attributes.keywords
      }),
      ...(modes !== undefined ? { modes } : {}),
      name: resolvedName,
      path: input.filePath,
      ...(profiles.length > 0 ? { profiles } : {}),
      scope: input.scope
   };
}

async function readSkillsForScope(
   projectPaths: ProjectPaths,
   scope: ProfileScope
): Promise<PromptSkill[]> {
   const skillsDir = getSkillsDirectoryForScope(projectPaths, scope);

   try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      const skillNames = entries
         .filter((entry) => entry.isDirectory())
         .map((entry) => entry.name)
         .sort((left, right) => left.localeCompare(right));

      const skills = await Promise.all(
         skillNames.map(async (name) => {
            try {
               return await readSkillDefinition({
                  filePath: path.join(skillsDir, name, "SKILL.md"),
                  name,
                  scope
               });
            } catch (error) {
               if (hasErrorCode(error, "ENOENT")) {
                  return undefined;
               }

               throw error;
            }
         })
      );

      return skills.filter((skill): skill is PromptSkill => skill !== undefined);
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return [];
      }

      throw error;
   }
}

function applyListPrecedence(
   skills: PromptSkill[],
   scope?: ProfileScope
): PromptSkill[] {
   if (scope !== undefined) {
      return skills;
   }

   const keptScopeByName = new Map<string, ProfileScope>();

   return skills.filter((skill) => {
      const keptScope = keptScopeByName.get(skill.name);

      if (keptScope === undefined) {
         keptScopeByName.set(skill.name, skill.scope);
         return true;
      }

      return keptScope === skill.scope;
   });
}

function toResolvedSkill(skill: PromptSkill): ResolvedSkill {
   return {
      ...skill,
      digest: hashText(skill.body)
   };
}

function normalizeWords(value: string): string[] {
   return value
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((entry) => entry.length > 0);
}

function matchesTaskKeywords(skill: PromptSkill, task: string): boolean {
   if (skill.keywords.length === 0) {
      return false;
   }

   const words = new Set(normalizeWords(task));
   return skill.keywords.some((keyword) => words.has(keyword.toLowerCase()));
}

function matchesMode(skill: PromptSkill, mode: RunMode): boolean {
   return skill.modes === undefined || skill.modes.includes(mode);
}

function matchesProfile(skill: PromptSkill, profileName: string): boolean {
   return (
      skill.profiles === undefined ||
      skill.profiles.includes(profileName) ||
      skill.profiles.includes(normalizeWords(profileName).join("-"))
   );
}

function dedupeSkills(skills: PromptSkill[]): PromptSkill[] {
   const seen = new Set<string>();

   return skills.filter((skill) => {
      if (seen.has(skill.name)) {
         return false;
      }

      seen.add(skill.name);
      return true;
   });
}

export async function listSkills(
   projectPaths: ProjectPaths,
   scope?: ProfileScope
): Promise<PromptSkill[]> {
   const scopes = scope === undefined ? profileScopes : [scope];
   const skills = (
      await Promise.all(
         scopes.map(async (currentScope) =>
            readSkillsForScope(projectPaths, currentScope)
         )
      )
   )
      .flat()
      .sort((left, right) => {
         const nameComparison = left.name.localeCompare(right.name);

         if (nameComparison !== 0) {
            return nameComparison;
         }

         return left.scope.localeCompare(right.scope);
      });

   return applyListPrecedence(skills, scope);
}

export async function loadSkillDefinition(
   projectPaths: ProjectPaths,
   requestedName: string,
   scope?: ProfileScope
): Promise<PromptSkill> {
   const normalizedName = validateSkillName(requestedName);
   const skills = await listSkills(projectPaths, scope);
   const skill = skills.find((entry) => entry.name === normalizedName);

   if (skill === undefined) {
      throw new UserError(`Skill "${requestedName}" was not found.`);
   }

   return skill;
}

export async function checkSkillDefinition(
   projectPaths: ProjectPaths,
   requestedName: string,
   scope?: ProfileScope
): Promise<{
   errors: ValidationIssue[];
   skill: PromptSkill;
   status: "invalid" | "ok";
}> {
   const skill = await loadSkillDefinition(projectPaths, requestedName, scope);
   const errors: ValidationIssue[] = [];

   if (skill.body.trim().length === 0) {
      errors.push({
         code: "empty-body",
         message: `Skill "${skill.name}" has an empty body.`
      });
   }

   return {
      errors,
      skill,
      status: errors.length > 0 ? "invalid" : "ok"
   };
}

export async function installSkill(
   _projectPaths: ProjectPaths,
   _input?: unknown
): Promise<PromptSkill> {
   throw new UserError(
      "Skill installation is no longer part of vNext. Create local skills under .aiman/skills/<name>/SKILL.md or ~/.aiman/skills/<name>/SKILL.md."
   );
}

export async function resolveSkillsForRun(
   projectPaths: ProjectPaths,
   input: {
      profile: ProfileDefinition;
      selectedSkillNames?: string[];
      task: string;
   }
): Promise<SkillSelectionResult> {
   const catalog = await listSkills(projectPaths);
   const activeMode = input.profile.mode ?? input.profile.permissions ?? "safe";
   const catalogByName = new Map(catalog.map((skill) => [skill.name, skill]));
   const active: PromptSkill[] = [];
   const suggested: PromptSkill[] = [];
   const declaredSkillNames = dedupeSkills(
      (input.profile.skills ?? []).map((name) => ({
         body: "",
         description: "",
         keywords: [],
         name,
         path: "",
         scope: "project" as const
      }))
   ).map((skill) => skill.name);
   const requestedSkillNames = input.selectedSkillNames ?? [];

   for (const skillName of [...declaredSkillNames, ...requestedSkillNames]) {
      const skill = catalogByName.get(validateSkillName(skillName));

      if (skill === undefined) {
         throw new UserError(
            `Profile "${input.profile.name}" requested skill "${skillName}", but no local SKILL.md was found under .aiman/skills/ or ~/.aiman/skills/.`
         );
      }

      active.push(skill);
   }

   for (const skill of catalog) {
      if (active.some((activeSkill) => activeSkill.name === skill.name)) {
         continue;
      }

      if (
         !matchesMode(skill, activeMode) ||
         !matchesProfile(skill, input.profile.name)
      ) {
         continue;
      }

      if (!matchesTaskKeywords(skill, input.task)) {
         continue;
      }

      suggested.push(skill);
   }

   return {
      active: dedupeSkills(active).map(toResolvedSkill),
      suggested: dedupeSkills(suggested).map(toResolvedSkill)
   };
}
