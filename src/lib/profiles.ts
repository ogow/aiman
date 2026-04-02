import { copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
   ensureProfileScopeDirectory,
   getProfilesDirectoryForScope
} from "./paths.js";
import type { ProjectPaths } from "./paths.js";
import type {
   ProfileCheckReport,
   ProfileDefinition,
   ProfileScope,
   ProviderId,
   RunMode,
   ScopedProfileDefinition,
   ValidationIssue
} from "./types.js";

const providers = new Set<ProviderId>(["codex", "gemini"]);
const runModes = new Set<RunMode>(["safe", "yolo"]);
const recommendedSectionNames = [
   "Role",
   "Task Input",
   "Instructions",
   "Constraints",
   "Expected Output"
] as const;
const taskPlaceholder = "{{task}}";
const profileScopeChoices = ["project", "user"] as const;
const builtInProfileModel = "gpt-5.4-mini";

type ProfileFileReference = {
   filePath: string;
   id: string;
   scope: ProfileScope;
};

type ParsedBodySection = {
   content: string;
   normalizedTitle: string;
};

type MigrationWarning = {
   message: string;
   path: string;
   profile: string;
};

export const builtinProfiles: ScopedProfileDefinition[] = [
   {
      body: [
         "## Role",
         "You are the build specialist.",
         "",
         "## Task Input",
         taskPlaceholder,
         "",
         "## Instructions",
         "- Work directly in the current project to complete the task.",
         "- Keep the user informed of important progress and blockers.",
         "- Prefer a working result over long explanations.",
         "",
         "## Constraints",
         "- Stay focused on the requested task.",
         "- Use only the attached project context and active skills.",
         "- If something is risky or blocked, say so clearly.",
         "",
         "## Expected Output",
         "- Deliver the requested result.",
         "- Mention any verification you completed.",
         "- Note any important remaining risk."
      ].join("\n"),
      description: "Default write-enabled profile for hands-on work",
      id: "build",
      isBuiltIn: true,
      mode: "yolo",
      model: builtInProfileModel,
      name: "build",
      permissions: "yolo",
      path: "<builtin>/build",
      provider: "codex",
      scope: "user"
   },
   {
      body: [
         "## Role",
         "You are the planning specialist.",
         "",
         "## Task Input",
         taskPlaceholder,
         "",
         "## Instructions",
         "- Analyze the task and the codebase carefully before recommending changes.",
         "- Do not propose edits you cannot justify from the evidence.",
         "- Focus on a concise, implementation-ready plan or review.",
         "",
         "## Constraints",
         "- Do not assume write access or make code changes.",
         "- Use only the attached project context and active skills.",
         "- Call out open questions and risks clearly.",
         "",
         "## Expected Output",
         "- Provide a clear recommendation or plan.",
         "- Highlight key risks or unknowns.",
         "- Suggest the next concrete action."
      ].join("\n"),
      description: "Default safe profile for analysis and planning",
      id: "plan",
      isBuiltIn: true,
      mode: "safe",
      model: builtInProfileModel,
      name: "plan",
      permissions: "safe",
      path: "<builtin>/plan",
      provider: "codex",
      scope: "user"
   }
];

function createIssue(code: string, message: string): ValidationIssue {
   return { code, message };
}

function normalizeName(value: string): string {
   return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
}

function humanizeProfileName(name: string): string {
   return name.trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

function ensureTrailingPeriod(value: string): string {
   const trimmed = value.trim();
   return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function parseDeclaredSkills(
   value: unknown,
   profileName: string | undefined,
   filePath: string
): string[] {
   if (value === undefined) {
      return [];
   }

   if (!Array.isArray(value)) {
      throw new UserError(
         `Profile "${profileName ?? filePath}" has invalid skills: expected a YAML list of strings.`
      );
   }

   const seen = new Set<string>();
   const skills: string[] = [];

   for (const entry of value) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
         throw new UserError(
            `Profile "${profileName ?? filePath}" has invalid skills: expected a YAML list of strings.`
         );
      }

      const normalized = entry.trim();

      if (seen.has(normalized)) {
         throw new UserError(
            `Profile "${profileName ?? filePath}" declares duplicate skills entries.`
         );
      }

      seen.add(normalized);
      skills.push(normalized);
   }

   return skills;
}

function validateFrontmatterAttributes(
   filePath: string,
   attributes: Record<string, unknown>,
   body: string
): ProfileDefinition {
   const name =
      typeof attributes.name === "string" ? attributes.name.trim() : undefined;
   const provider =
      typeof attributes.provider === "string"
         ? attributes.provider.trim()
         : undefined;
   const description =
      typeof attributes.description === "string"
         ? attributes.description.trim()
         : undefined;
   const model =
      typeof attributes.model === "string" ? attributes.model.trim() : undefined;
   const mode =
      typeof attributes.mode === "string"
         ? attributes.mode.trim()
         : typeof attributes.permissions === "string"
           ? attributes.permissions.trim()
           : undefined;
   const skills = parseDeclaredSkills(attributes.skills, name, filePath);

   if (typeof name !== "string" || name.length === 0) {
      throw new UserError(`Profile file ${filePath} is missing a name.`);
   }

   if (!providers.has(provider as ProviderId)) {
      throw new UserError(
         `Profile "${name}" has an unsupported provider: ${provider ?? "missing"}.`
      );
   }

   if (typeof description !== "string" || description.length === 0) {
      throw new UserError(`Profile "${name}" is missing a description.`);
   }

   if (typeof model !== "string" || model.length === 0) {
      throw new UserError(`Profile "${name}" is missing a model.`);
   }

   if (!runModes.has(mode as RunMode)) {
      throw new UserError(
         `Profile "${name}" has invalid mode: ${mode ?? "missing"}.`
      );
   }

   if (body.length === 0) {
      throw new UserError(`Profile "${name}" has an empty body.`);
   }

   return {
      body,
      ...(attributes.contextFiles !== undefined
         ? { contextFiles: parseDeclaredSkills(attributes.contextFiles, name, filePath) }
         : {}),
      description,
      model,
      mode: mode as RunMode,
      name,
      permissions: mode as RunMode,
      provider: provider as ProviderId,
      ...(typeof attributes.reasoningEffort === "string"
         ? { reasoningEffort: attributes.reasoningEffort }
         : {}),
      ...(attributes.requiredMcps !== undefined
         ? {
              requiredMcps: parseDeclaredSkills(
                 attributes.requiredMcps,
                 name,
                 filePath
              )
           }
         : {}),
      ...(skills.length > 0 ? { skills } : {})
   };
}

async function readProfileFile(input: {
   filePath: string;
   id: string;
   scope: ProfileScope;
}): Promise<ScopedProfileDefinition> {
   const markdown = await readFile(input.filePath, "utf8");
   const parsed = parseFrontmatter(markdown);
   const profile = validateFrontmatterAttributes(
      input.filePath,
      parsed.attributes,
      parsed.body
   );

   return {
      ...profile,
      id: input.id,
      path: input.filePath,
      scope: input.scope
   };
}

async function readProfileDirectory(
   projectPaths: ProjectPaths,
   scope: ProfileScope
): Promise<ScopedProfileDefinition[]> {
   const profilesDir = getProfilesDirectoryForScope(projectPaths, scope);

   try {
      const entries = await readdir(profilesDir, { withFileTypes: true });
      const markdownFiles = entries
         .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
         .map((entry) => entry.name)
         .sort((left, right) => left.localeCompare(right));

      return Promise.all(
         markdownFiles.map(async (entry) =>
            readProfileFile({
               filePath: path.join(profilesDir, entry),
               id: path.parse(entry).name,
               scope
            })
         )
      );
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return [];
      }

      throw error;
   }
}

async function readProfileFileReferences(
   projectPaths: ProjectPaths,
   scope: ProfileScope
): Promise<ProfileFileReference[]> {
   const profilesDir = getProfilesDirectoryForScope(projectPaths, scope);

   try {
      const entries = await readdir(profilesDir, { withFileTypes: true });

      return entries
         .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
         .map((entry) => ({
            filePath: path.join(profilesDir, entry.name),
            id: path.parse(entry.name).name,
            scope
         }))
         .sort((left, right) => left.id.localeCompare(right.id));
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return [];
      }

      throw error;
   }
}

function compareProfiles(
   left: ScopedProfileDefinition,
   right: ScopedProfileDefinition
): number {
   const nameComparison = left.name.localeCompare(right.name);

   if (nameComparison !== 0) {
      return nameComparison;
   }

   const scopeOrder =
      left.scope === right.scope
         ? 0
         : left.scope === "project"
           ? -1
           : right.scope === "project"
             ? 1
             : 0;

   if (scopeOrder !== 0) {
      return scopeOrder;
   }

   if (left.isBuiltIn === true && right.isBuiltIn !== true) {
      return 1;
   }

   if (left.isBuiltIn !== true && right.isBuiltIn === true) {
      return -1;
   }

   return left.path.localeCompare(right.path);
}

function applyListPrecedence(
   profiles: ScopedProfileDefinition[],
   scope?: ProfileScope
): ScopedProfileDefinition[] {
   if (scope !== undefined) {
      return profiles;
   }

   const keptScopeByName = new Map<string, string>();

   return profiles.filter((profile) => {
      const keptScope = keptScopeByName.get(profile.name);
      const currentScope =
         profile.isBuiltIn === true ? "builtin" : profile.scope;

      if (keptScope === undefined) {
         keptScopeByName.set(profile.name, currentScope);
         return true;
      }

      return keptScope === currentScope;
   });
}

function parseBodySections(body: string): ParsedBodySection[] {
   const normalizedBody = body.replace(/\r\n?/g, "\n");
   const headingPattern = /^##\s+(.+?)\s*$/gm;
   const matches = [...normalizedBody.matchAll(headingPattern)];

   return matches.map((match, index) => {
      const title = (match[1] ?? "").trim();
      const nextMatch = matches[index + 1];
      const startIndex = (match.index ?? 0) + match[0].length;
      const endIndex = nextMatch?.index ?? normalizedBody.length;

      return {
         content: normalizedBody.slice(startIndex, endIndex).trim(),
         normalizedTitle: title.toLowerCase()
      };
   });
}

function collectPromptStructureWarnings(body: string): ValidationIssue[] {
   const sections = parseBodySections(body);
   const warnings: ValidationIssue[] = [];
   const normalizedTitles = sections.map((section) => section.normalizedTitle);

   for (const sectionName of recommendedSectionNames) {
      const normalizedName = sectionName.toLowerCase();

      if (!normalizedTitles.includes(normalizedName)) {
         warnings.push(
            createIssue(
               `missing-${normalizedName.replace(/\s+/g, "-")}-section`,
               `Profile body is missing the recommended "${sectionName}" section.`
            )
         );
      }
   }

   const expectedOutputSection = sections.find(
      (section) => section.normalizedTitle === "expected output"
   );

   if (
      expectedOutputSection !== undefined &&
      !/^\s*(?:[-*]|\d+\.)\s+/m.test(expectedOutputSection.content)
   ) {
      warnings.push(
         createIssue(
            "missing-output-shape-guidance",
            'The "Expected Output" section should describe the result shape with a short list or other explicit structure.'
         )
      );
   }

   return warnings;
}

function dedupeValidationIssues(
   issues: ValidationIssue[]
): ValidationIssue[] {
   const seen = new Set<string>();

   return issues.filter((issue) => {
      const key = `${issue.code}\u0000${issue.message}`;

      if (seen.has(key)) {
         return false;
      }

      seen.add(key);
      return true;
   });
}

function renderProfileMarkdown(input: {
   description: string;
   instructions: string;
   model: string;
   mode: RunMode;
   name: string;
   provider: ProviderId;
}): string {
   return [
      "---",
      `name: ${input.name}`,
      `provider: ${input.provider}`,
      `description: ${input.description}`,
      `model: ${input.model}`,
      `mode: ${input.mode}`,
      "---",
      "",
      "## Role",
      `You are the ${humanizeProfileName(input.name)} profile. ${ensureTrailingPeriod(input.description)}`,
      "",
      "## Task Input",
      taskPlaceholder,
      "",
      "## Instructions",
      input.instructions.trim(),
      "",
      "## Constraints",
      "- Use only the attached project context and active skills.",
      "- State assumptions clearly when information is missing.",
      "- Call out blockers directly instead of guessing.",
      "",
      "## Expected Output",
      "- Deliver a concise result focused on the task.",
      "- Mention important verification or open risk.",
      ""
   ].join("\n");
}

export async function listProfiles(
   projectPaths: ProjectPaths,
   scope?: ProfileScope
): Promise<ScopedProfileDefinition[]> {
   const scopes = scope === undefined ? profileScopeChoices : [scope];
   const scopedProfiles = await Promise.all(
      scopes.map(async (currentScope) =>
         readProfileDirectory(projectPaths, currentScope)
      )
   );
   const profiles = scopedProfiles.flat();

   if (scope === undefined || scope === "user") {
      profiles.push(...builtinProfiles);
   }

   return applyListPrecedence(profiles.sort(compareProfiles), scope);
}

export async function loadProfileDefinition(
   projectPaths: ProjectPaths,
   requestedName: string,
   scope?: ProfileScope
): Promise<ScopedProfileDefinition> {
   const trimmedName = requestedName.trim();

   if (trimmedName.length === 0) {
      throw new UserError("Profile name is required.");
   }

   const profiles = await listProfiles(projectPaths, scope);
   const exactFileMatch = profiles.find((profile) => profile.id === trimmedName);

   if (exactFileMatch !== undefined) {
      return exactFileMatch;
   }

   const exactNameMatch = profiles.find((profile) => profile.name === trimmedName);

   if (exactNameMatch !== undefined) {
      return exactNameMatch;
   }

   throw new UserError(`Profile "${requestedName}" was not found.`);
}

export async function createProfileFile(
   projectPaths: ProjectPaths,
   input: {
      description: string;
      force?: boolean;
      instructions: string;
      model: string;
      mode: RunMode;
      name: string;
      provider: ProviderId;
      scope: ProfileScope;
   }
): Promise<ScopedProfileDefinition> {
   const trimmedName = input.name.trim();
   const trimmedDescription = input.description.trim();
   const trimmedInstructions = input.instructions.trim();
   const trimmedModel = input.model.trim();
   const fileId = normalizeName(trimmedName);

   if (fileId.length === 0) {
      throw new UserError(
         `Profile name "${input.name}" does not produce a valid file name.`
      );
   }

   await ensureProfileScopeDirectory(projectPaths, input.scope);

   const profilesDir = getProfilesDirectoryForScope(projectPaths, input.scope);
   const targetPath = path.join(profilesDir, `${fileId}.md`);
   const existingProfiles = await readProfileDirectory(projectPaths, input.scope);
   const conflictingName = existingProfiles.find(
      (profile) => profile.name === trimmedName && profile.path !== targetPath
   );

   if (conflictingName !== undefined) {
      throw new UserError(
         `A ${input.scope}-scope profile named "${trimmedName}" already exists at ${conflictingName.path}.`
      );
   }

   const conflictingFile = existingProfiles.find(
      (profile) => profile.path === targetPath
   );

   if (conflictingFile !== undefined && input.force !== true) {
      throw new UserError(
         `Profile file ${targetPath} already exists. Re-run with --force to overwrite it.`
      );
   }

   await writeFile(
      targetPath,
      renderProfileMarkdown({
         description: trimmedDescription,
         instructions: trimmedInstructions,
         model: trimmedModel,
         mode: input.mode,
         name: trimmedName,
         provider: input.provider
      }),
      "utf8"
   );

   return readProfileFile({
      filePath: targetPath,
      id: fileId,
      scope: input.scope
   });
}

export async function checkProfileDefinition(
   projectPaths: ProjectPaths,
   requestedName: string,
   scope?: ProfileScope
): Promise<ProfileCheckReport> {
   const trimmedName = requestedName.trim();

   if (trimmedName.length === 0) {
      throw new UserError("Profile name is required.");
   }

   const profiles = await listProfiles(projectPaths, scope);
   const profile = profiles.find(
      (currentProfile) =>
         currentProfile.id === trimmedName || currentProfile.name === trimmedName
   );

   if (profile === undefined) {
      throw new UserError(`Profile "${requestedName}" was not found.`);
   }

   const errors: ValidationIssue[] = [];

   if (!profile.body.includes(taskPlaceholder)) {
      errors.push(
         createIssue(
            "missing-task-placeholder",
            `Profile "${profile.name}" must include the ${taskPlaceholder} placeholder in its body.`
         )
      );
   }

   const warnings = collectPromptStructureWarnings(profile.body);

   return {
      errors: dedupeValidationIssues(errors),
      profile: {
         id: profile.id,
         ...(typeof profile.model === "string" ? { model: profile.model } : {}),
         ...(typeof profile.mode === "string" ? { mode: profile.mode } : {}),
         name: profile.name,
         path: profile.path,
         ...(typeof profile.mode === "string"
            ? { permissions: profile.mode }
            : {}),
         provider: profile.provider,
         scope: profile.scope,
         ...(profile.skills !== undefined ? { skills: profile.skills } : {})
      },
      status:
         errors.length > 0
            ? "invalid"
            : warnings.length > 0
              ? "warnings"
              : "ok",
      warnings: dedupeValidationIssues(warnings)
   };
}

async function readLegacyAgentFiles(
   directoryPath: string,
   scope: ProfileScope
): Promise<ProfileFileReference[]> {
   try {
      const entries = await readdir(directoryPath, { withFileTypes: true });

      return entries
         .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
         .map((entry) => ({
            filePath: path.join(directoryPath, entry.name),
            id: path.parse(entry.name).name,
            scope
         }));
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return [];
      }

      throw error;
   }
}

export async function migrateLegacyAgents(
   projectPaths: ProjectPaths
): Promise<{
   created: ScopedProfileDefinition[];
   warnings: MigrationWarning[];
}> {
   const legacyDirectories: Array<{
      directoryPath: string;
      scope: ProfileScope;
   }> = [
      {
         directoryPath: path.join(projectPaths.aimanDir, "agents"),
         scope: "project"
      },
      {
         directoryPath: path.join(projectPaths.userAimanDir, "agents"),
         scope: "user"
      }
   ];
   const references = (
      await Promise.all(
         legacyDirectories.map(async (entry) =>
            readLegacyAgentFiles(entry.directoryPath, entry.scope)
         )
      )
   ).flat();
   const created: ScopedProfileDefinition[] = [];
   const warnings: MigrationWarning[] = [];

   for (const reference of references) {
      const markdown = await readFile(reference.filePath, "utf8");
      const parsed = parseFrontmatter(markdown);
      const attributes = parsed.attributes;
      const mode =
         attributes.permissions === "workspace-write" ? "yolo" : "safe";
      const skills = Array.isArray(attributes.skills)
         ? attributes.skills.filter(
              (entry): entry is string =>
                 typeof entry === "string" && entry.trim().length > 0
           )
         : [];

      if (attributes.contextFiles !== undefined) {
         warnings.push({
            message:
               "Dropped legacy contextFiles. Use AGENTS.md ## Aiman Runtime Context instead.",
            path: reference.filePath,
            profile: reference.id
         });
      }

      if (attributes.requiredMcps !== undefined) {
         warnings.push({
            message:
               "Dropped legacy requiredMcps. vNext keeps provider setup outside the profile contract.",
            path: reference.filePath,
            profile: reference.id
         });
      }

      if (attributes.reasoningEffort !== undefined) {
         warnings.push({
            message:
               "Dropped legacy reasoningEffort. vNext keeps provider tuning out of the public profile contract.",
            path: reference.filePath,
            profile: reference.id
         });
      }

      const profile = await createProfileFile(projectPaths, {
         description:
            typeof attributes.description === "string"
               ? attributes.description
               : `Migrated profile from ${reference.id}`,
         force: true,
         instructions: parsed.body,
         model:
            typeof attributes.model === "string"
               ? attributes.model
               : builtInProfileModel,
         mode,
         name:
            typeof attributes.name === "string" && attributes.name.trim().length > 0
               ? attributes.name
               : reference.id,
         provider:
            attributes.provider === "gemini" ? "gemini" : "codex",
         scope: reference.scope
      });

      if (skills.length > 0) {
         const targetBody = await readFile(profile.path, "utf8");
         const augmentedBody = targetBody.replace(
            /^mode: (safe|yolo)$/m,
            (match) =>
               `${match}\nskills:\n${skills.map((skill) => `  - ${skill}`).join("\n")}`
         );
         await writeFile(profile.path, augmentedBody, "utf8");
         created.push(await readProfileFile({
            filePath: profile.path,
            id: profile.id,
            scope: profile.scope
         }));
      } else {
         created.push(profile);
      }
   }

   return { created, warnings };
}

export { profileScopeChoices };
