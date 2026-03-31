import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import type { ProjectPaths } from "./paths.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { AgentScope, ResolvedSkill } from "./types.js";

type SkillDefinition = {
   description: string;
   name: string;
   path: string;
   scope: AgentScope;
};

function hashText(value: string): string {
   return createHash("sha256").update(value).digest("hex");
}

function getSkillsDirectoryForScope(
   projectPaths: ProjectPaths,
   scope: AgentScope
): string {
   return scope === "project"
      ? projectPaths.projectSkillsDir
      : projectPaths.userSkillsDir;
}

function validateSkillName(name: string): string {
   const trimmedName = name.trim();

   if (trimmedName.length === 0) {
      throw new UserError("Skill names must not be empty.");
   }

   if (trimmedName !== path.basename(trimmedName)) {
      throw new UserError(
         `Skill "${name}" is invalid. Use a single skill directory name.`
      );
   }

   return trimmedName;
}

async function readResolvedSkill(
   projectPaths: ProjectPaths,
   scope: AgentScope,
   name: string
): Promise<ResolvedSkill | undefined> {
   const validatedName = validateSkillName(name);
   const skillPath = path.join(
      getSkillsDirectoryForScope(projectPaths, scope),
      validatedName,
      "SKILL.md"
   );

   try {
      const source = await readFile(skillPath, "utf8");

      return {
         digest: hashText(source),
         name: validatedName,
         path: skillPath,
         scope
      };
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return undefined;
      }

      throw error;
   }
}

export async function resolveDeclaredSkills(
   projectPaths: ProjectPaths,
   declaredSkills?: string[]
): Promise<ResolvedSkill[]> {
   if (declaredSkills === undefined || declaredSkills.length === 0) {
      return [];
   }

   const seenNames = new Set<string>();
   const resolvedSkills: ResolvedSkill[] = [];

   for (const name of declaredSkills) {
      const validatedName = validateSkillName(name);

      if (seenNames.has(validatedName)) {
         throw new UserError(
            `Skill "${validatedName}" was declared more than once.`
         );
      }

      seenNames.add(validatedName);

      const resolvedSkill =
         (await readResolvedSkill(projectPaths, "project", validatedName)) ??
         (await readResolvedSkill(projectPaths, "user", validatedName));

      if (resolvedSkill === undefined) {
         throw new UserError(
            `Agent requires skill "${validatedName}", but no ${path.join(validatedName, "SKILL.md")} was found under .agents/skills/ or ~/.agents/skills/.`
         );
      }

      resolvedSkills.push(resolvedSkill);
   }

   return resolvedSkills;
}

async function readSkillDefinition(input: {
   filePath: string;
   name: string;
   scope: AgentScope;
}): Promise<SkillDefinition> {
   const markdown = await readFile(input.filePath, "utf8");
   const parsed = parseFrontmatter(markdown);
   const description = parsed.attributes.description;

   return {
      description: typeof description === "string" ? description : "",
      name: input.name,
      path: input.filePath,
      scope: input.scope
   };
}

async function readSkillsForScope(
   projectPaths: ProjectPaths,
   scope: AgentScope
): Promise<SkillDefinition[]> {
   const skillsDir = getSkillsDirectoryForScope(projectPaths, scope);

   try {
      const entries = await readdir(skillsDir, {
         withFileTypes: true
      });
      const skillNames = entries
         .filter((entry) => entry.isDirectory())
         .map((entry) => entry.name)
         .sort((left, right) => left.localeCompare(right));

      return Promise.all(
         skillNames.flatMap((name) => [
            readSkillDefinition({
               filePath: path.join(skillsDir, name, "SKILL.md"),
               name,
               scope
            })
         ])
      );
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return [];
      }

      throw error;
   }
}

function applyListPrecedence(
   skills: SkillDefinition[],
   scope?: AgentScope
): SkillDefinition[] {
   if (scope !== undefined) {
      return skills;
   }

   const keptScopeByName = new Map<string, AgentScope>();

   return skills.filter((skill) => {
      const keptScope = keptScopeByName.get(skill.name);

      if (keptScope === undefined) {
         keptScopeByName.set(skill.name, skill.scope);
         return true;
      }

      return keptScope === skill.scope;
   });
}

export async function listSkills(
   projectPaths: ProjectPaths,
   scope?: AgentScope
): Promise<SkillDefinition[]> {
   const scopes =
      scope === undefined ? (["project", "user"] as const) : [scope];
   const skills = (
      await Promise.all(
         scopes.map((currentScope) =>
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
