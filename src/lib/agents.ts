import { readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
   ensureProfileScopeDirectory,
   getProfilesDirectoryForScope
} from "./paths.js";
import { normalizeTimeoutMs } from "./timeouts.js";
import type { ProjectPaths } from "./paths.js";
import type {
   ProfileCheckReport,
   ProfileDefinition,
   ProfileScope,
   ProviderId,
   ReasoningEffort,
   ResultMode,
   ScopedProfileDefinition,
   ValidationIssue
} from "./types.js";

const providers = new Set<ProviderId>(["codex", "gemini"]);
const resultModes = new Set<ResultMode>(["schema", "text"]);
const codexReasoningEfforts = new Set<ReasoningEffort>([
   "none",
   "low",
   "medium",
   "high"
]);
const geminiReasoningEfforts = new Set<ReasoningEffort>(["none"]);
const recommendedSectionNames = [
   "Role",
   "Task Input",
   "Instructions",
   "Constraints",
   "Stop Conditions",
   "Expected Output"
] as const;
const taskPlaceholder = "{{task}}";
const profileScopeChoices = ["project", "user"] as const;

type ParsedBodySection = {
   content: string;
   normalizedTitle: string;
};

export const builtinProfiles: ScopedProfileDefinition[] = [
   {
      body: [
         "## Role",
         "You are the build specialist.",
         "",
         "## Task Input",
         "<task>",
         taskPlaceholder,
         "</task>",
         "",
         "## Instructions",
         "- Work directly in the current project to complete the task.",
         "- Keep the user informed of important progress and blockers.",
         "- Prefer a working result over long explanations.",
         "",
         "## Constraints",
         "- Stay focused on the requested task.",
         "- Use the repo's native context files.",
         "- If something is risky or blocked, say so clearly.",
         "",
         "## Stop Conditions",
         "- Stop when the requested task is complete enough to summarize clearly.",
         "- Stop with a blocked outcome when required context or evidence is missing.",
         "- Do not keep exploring once the requested outcome is already clear.",
         "",
         "## Expected Output",
         "- Deliver the requested result.",
         "- Mention any verification you completed.",
         "- Note any important remaining risk."
      ].join("\n"),
      description: "Default write-enabled profile for hands-on work",
      id: "build",
      isBuiltIn: true,
      model: "gpt-5.4-mini",
      name: "build",
      path: "<builtin>/build",
      provider: "codex",
      reasoningEffort: "medium",
      resultMode: "text",
      scope: "user"
   },
   {
      body: [
         "## Role",
         "You are the planning specialist.",
         "",
         "## Task Input",
         "<task>",
         taskPlaceholder,
         "</task>",
         "",
         "## Instructions",
         "- Analyze the task and the codebase carefully before recommending changes.",
         "- Do not propose edits you cannot justify from the evidence.",
         "- Focus on a concise, implementation-ready plan or review.",
         "",
         "## Constraints",
         "- Do not assume write access or make code changes.",
         "- Use the repo's native context files.",
         "- Call out open questions and risks clearly.",
         "",
         "## Stop Conditions",
         "- Stop when the recommendation or plan is clear enough to act on.",
         "- Stop with a blocked recommendation if required evidence is missing.",
         "- Do not continue exploring once the key risks and next step are already clear.",
         "",
         "## Expected Output",
         "- Provide a clear recommendation or plan.",
         "- Highlight key risks or unknowns.",
         "- Suggest the next concrete action."
      ].join("\n"),
      description: "Default planning profile for analysis and review",
      id: "plan",
      isBuiltIn: true,
      model: "gpt-5.4-mini",
      name: "plan",
      path: "<builtin>/plan",
      provider: "codex",
      reasoningEffort: "medium",
      resultMode: "text",
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

function normalizeCapabilities(
   value: unknown,
   agentName: string
): string[] | undefined {
   if (value === undefined) {
      return undefined;
   }

   if (!Array.isArray(value)) {
      throw new UserError(
         `Agent "${agentName}" has invalid capabilities. Use a YAML list of non-empty strings.`
      );
   }

   const normalized: string[] = [];
   const seen = new Set<string>();

   for (const entry of value) {
      if (typeof entry !== "string") {
         throw new UserError(
            `Agent "${agentName}" has invalid capabilities. Use a YAML list of non-empty strings.`
         );
      }

      const trimmedEntry = entry.trim();

      if (trimmedEntry.length === 0) {
         throw new UserError(
            `Agent "${agentName}" has invalid capabilities. Empty values are not allowed.`
         );
      }

      if (seen.has(trimmedEntry)) {
         continue;
      }

      seen.add(trimmedEntry);
      normalized.push(trimmedEntry);
   }

   return normalized.length > 0 ? normalized : undefined;
}

function ensureTrailingPeriod(value: string): string {
   const trimmed = value.trim();
   return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function renderInstructionLines(instructions: string): string[] {
   const lines = instructions
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

   if (lines.length === 0) {
      return [
         "- Refine this section with the exact steps this agent should follow."
      ];
   }

   return lines.map((line) => {
      if (/^(?:[-*]|\d+\.)\s+/.test(line) || /^<[^>]+>$/.test(line)) {
         return line;
      }

      return `- ${ensureTrailingPeriod(line)}`;
   });
}

function getAllowedReasoningEfforts(
   provider: ProviderId
): ReadonlySet<ReasoningEffort> {
   return provider === "codex" ? codexReasoningEfforts : geminiReasoningEfforts;
}

function renderReasoningEffortList(provider: ProviderId): string {
   return [...getAllowedReasoningEfforts(provider)].join('", "');
}

function usesAutomaticGeminiModel(input: {
   model?: string;
   provider?: string;
}): boolean {
   return input.provider === "gemini" && input.model === "auto";
}

export function formatProfileModel(input: {
   model?: string;
   provider?: string;
}): string {
   if (usesAutomaticGeminiModel(input)) {
      return "automatic (Gemini default)";
   }

   if (typeof input.model === "string" && input.model.length > 0) {
      return input.model;
   }

   return "";
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
   const capabilities = normalizeCapabilities(
      attributes.capabilities,
      name ?? "unknown"
   );
   const model =
      typeof attributes.model === "string"
         ? attributes.model.trim()
         : undefined;
   const reasoningEffort =
      typeof attributes.reasoningEffort === "string"
         ? attributes.reasoningEffort.trim()
         : undefined;
   const resultMode =
      typeof attributes.resultMode === "string"
         ? attributes.resultMode.trim()
         : "text";

   if (typeof name !== "string" || name.length === 0) {
      throw new UserError(`Agent file ${filePath} is missing a name.`);
   }

   const timeoutMs = normalizeTimeoutMs(
      attributes.timeoutMs,
      `Agent "${name}" has invalid timeoutMs`
   );

   if (!providers.has(provider as ProviderId)) {
      throw new UserError(
         `Agent "${name}" has an unsupported provider: ${provider ?? "missing"}.`
      );
   }

   if (typeof description !== "string" || description.length === 0) {
      throw new UserError(`Agent "${name}" is missing a description.`);
   }

   if (attributes.permissions !== undefined) {
      throw new UserError(
         `Agent "${name}" uses unsupported field "permissions". The agent contract no longer supports mode or permissions fields.`
      );
   }

   if (attributes.mode !== undefined) {
      throw new UserError(
         `Agent "${name}" uses unsupported field "mode". Provider rights now come from the runtime and provider adapter, not agent frontmatter.`
      );
   }

   if (attributes.contextFiles !== undefined) {
      throw new UserError(
         `Agent "${name}" uses unsupported field "contextFiles". Configure shared repo context file names in .../config.json instead of per-agent frontmatter.`
      );
   }

   if (attributes.requiredMcps !== undefined) {
      throw new UserError(
         `Agent "${name}" uses unsupported field "requiredMcps". Remove it from the agent contract.`
      );
   }

   if (attributes.skills !== undefined) {
      throw new UserError(
         `Agent "${name}" uses unsupported field "skills". Let the downstream provider discover skills natively from the repo instead of declaring them in agent frontmatter.`
      );
   }

   if (!resultModes.has(resultMode as ResultMode)) {
      throw new UserError(
         `Agent "${name}" has invalid resultMode "${resultMode}". Use one of "text" or "schema".`
      );
   }

   if (typeof model !== "string" || model.length === 0) {
      throw new UserError(`Agent "${name}" is missing a model.`);
   }

   if (model === "auto" && provider !== "gemini") {
      throw new UserError(
         `Agent "${name}" has invalid model "auto" for provider "${provider}". Only Gemini supports automatic model selection via "model: auto".`
      );
   }

   let effectiveReasoningEffort = reasoningEffort;

   if (effectiveReasoningEffort === undefined && provider === "gemini") {
      effectiveReasoningEffort = "none";
   }

   if (
      typeof effectiveReasoningEffort !== "string" ||
      effectiveReasoningEffort.length === 0
   ) {
      throw new UserError(
         `Agent "${name}" is missing a reasoningEffort. Use one of "${renderReasoningEffortList(provider as ProviderId)}" for provider "${provider ?? "missing"}".`
      );
   }

   if (
      providers.has(provider as ProviderId) &&
      !getAllowedReasoningEfforts(provider as ProviderId).has(
         effectiveReasoningEffort as ReasoningEffort
      )
   ) {
      throw new UserError(
         `Agent "${name}" has invalid reasoningEffort "${effectiveReasoningEffort}" for provider "${provider}". Use one of "${renderReasoningEffortList(provider as ProviderId)}".`
      );
   }

   if (body.length === 0) {
      throw new UserError(`Agent "${name}" has an empty body.`);
   }

   return {
      body,
      ...(capabilities !== undefined ? { capabilities } : {}),
      description,
      model,
      name,
      provider: provider as ProviderId,
      reasoningEffort: effectiveReasoningEffort as ReasoningEffort,
      resultMode: resultMode as ResultMode,
      ...(timeoutMs !== undefined ? { timeoutMs } : {})
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
      const tagName = normalizedName.replace(/\s+/g, "_");
      const hasHeader = normalizedTitles.includes(normalizedName);
      const hasTag = new RegExp(`<${tagName}(?:\\s+[^>]*)?>`, "i").test(body);

      if (!hasHeader && !hasTag) {
         warnings.push(
            createIssue(
               `missing-${normalizedName.replace(/\s+/g, "-")}-section`,
               `Agent body is missing the recommended "${sectionName}" section (as a Markdown header or XML tag).`
            )
         );
      }
   }

   const expectedOutputSection = sections.find(
      (section) => section.normalizedTitle === "expected output"
   );
   const expectedOutputTagMatch = body.match(
      /<expected_output(?:\s+[^>]*)?>(.*?)<\/expected_output>/is
   );
   const expectedOutputContent =
      expectedOutputSection?.content ?? expectedOutputTagMatch?.[1] ?? "";

   if (
      expectedOutputContent.length > 0 &&
      !/^\s*(?:[-*]|\d+\.)\s+/m.test(expectedOutputContent)
   ) {
      warnings.push(
         createIssue(
            "missing-output-shape-guidance",
            'The "Expected Output" section should describe the result shape with a short list or other explicit structure.'
         )
      );
   }

   if (
      body.includes(taskPlaceholder) &&
      !/<(task|input|task_input)(?:\s+[^>]*)?>\s*\{\{task\}\}\s*<\/\1>/is.test(
         body
      )
   ) {
      warnings.push(
         createIssue(
            "missing-task-xml-wrapper",
            `Wrap ${taskPlaceholder} in <task>...</task>, <input>...</input>, or <task_input>...</task_input> so authored instructions and user-supplied task text stay separate.`
         )
      );
   }

   if (
      !/(missing (?:context|evidence|information)|not enough information|blocked outcome|instead of guessing|do not guess|don't guess|state assumptions clearly)/i.test(
         body
      )
   ) {
      warnings.push(
         createIssue(
            "missing-missing-evidence-guidance",
            "Agent body should say what to do when required evidence or context is missing instead of leaving the model to guess."
         )
      );
   }

   return warnings;
}

function dedupeValidationIssues(issues: ValidationIssue[]): ValidationIssue[] {
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
   capabilities?: string[];
   description: string;
   instructions: string;
   model: string;
   name: string;
   provider: ProviderId;
   reasoningEffort: ReasoningEffort;
   resultMode: ResultMode;
   timeoutMs?: number;
}): string {
   const expectedOutputLines =
      input.resultMode === "schema"
         ? [
              "- Return a concise `summary` and one stable `outcome`.",
              "- Keep `result` focused on task-specific facts another tool or agent can use.",
              "- Use `next` only when a concrete follow-up is genuinely needed."
           ]
         : [
              "- Deliver a concise result focused on the task.",
              "- Mention important verification you completed.",
              "- Note any important open risk or missing evidence."
           ];

   return [
      "---",
      `name: ${input.name}`,
      `provider: ${input.provider}`,
      `description: ${input.description}`,
      `model: ${input.model}`,
      `resultMode: ${input.resultMode}`,
      ...(input.timeoutMs !== undefined
         ? [`timeoutMs: ${input.timeoutMs}`]
         : []),
      ...(input.capabilities !== undefined && input.capabilities.length > 0
         ? [
              "capabilities:",
              ...input.capabilities.map(
                 (capability) => `  - ${JSON.stringify(capability)}`
              )
           ]
         : []),
      ...(input.provider === "gemini" && input.reasoningEffort === "none"
         ? []
         : [`reasoningEffort: ${input.reasoningEffort}`]),
      "---",
      "",
      "## Role",
      `You are the ${humanizeProfileName(input.name)} agent. ${ensureTrailingPeriod(input.description)}`,
      "",
      "## Task Input",
      "<task>",
      taskPlaceholder,
      "</task>",
      "",
      "## Instructions",
      ...renderInstructionLines(input.instructions),
      "- Base the answer on the task input and repo evidence that is actually available.",
      "- If required evidence is missing, say so directly and stop instead of guessing.",
      "- Keep the final result scoped to this agent's one job.",
      "",
      "## Constraints",
      "- Use the repo's native context files.",
      "- Do not invent files, behavior, commands, or verification you did not observe.",
      "- State assumptions clearly when information is missing.",
      "- Call out blockers directly instead of guessing.",
      "",
      "## Stop Conditions",
      "- Stop when you can deliver the requested outcome clearly.",
      "- Stop with a blocked outcome when required context or evidence is missing.",
      "- Do not keep exploring once the answer shape is already clear.",
      "",
      "## Expected Output",
      ...expectedOutputLines,
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
      profiles.push(
         ...builtinProfiles.map((profile) => ({
            ...profile
         }))
      );
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
      throw new UserError("Agent name is required.");
   }

   const profiles = await listProfiles(projectPaths, scope);
   const exactFileMatch = profiles.find(
      (profile) => profile.id === trimmedName
   );

   if (exactFileMatch !== undefined) {
      return exactFileMatch;
   }

   const exactNameMatch = profiles.find(
      (profile) => profile.name === trimmedName
   );

   if (exactNameMatch !== undefined) {
      return exactNameMatch;
   }

   throw new UserError(`Agent "${requestedName}" was not found.`);
}

export async function createProfileFile(
   projectPaths: ProjectPaths,
   input: {
      capabilities?: string[];
      description: string;
      force?: boolean;
      instructions: string;
      model: string;
      name: string;
      provider: ProviderId;
      reasoningEffort?: ReasoningEffort;
      resultMode?: ResultMode;
      scope: ProfileScope;
      timeoutMs?: number;
   }
): Promise<ScopedProfileDefinition> {
   const trimmedName = input.name.trim();
   const trimmedDescription = input.description.trim();
   const trimmedInstructions = input.instructions.trim();
   const provider = input.provider;
   const model = input.model.trim();
   const capabilities = normalizeCapabilities(input.capabilities, trimmedName);
   const reasoningEffort =
      input.reasoningEffort ?? (provider === "gemini" ? "none" : undefined);
   const resultMode = input.resultMode ?? "text";
   const timeoutMs = normalizeTimeoutMs(
      input.timeoutMs,
      `Agent "${trimmedName}" has invalid timeoutMs`
   );

   if (reasoningEffort === undefined) {
      throw new UserError(
         `Reasoning effort is required for provider "${provider}".`
      );
   }

   const fileId = normalizeName(trimmedName);

   if (fileId.length === 0) {
      throw new UserError(
         `Agent name "${input.name}" does not produce a valid file name.`
      );
   }

   await ensureProfileScopeDirectory(projectPaths, input.scope);

   const profilesDir = getProfilesDirectoryForScope(projectPaths, input.scope);
   const targetPath = path.join(profilesDir, `${fileId}.md`);
   const existingProfiles = await readProfileDirectory(
      projectPaths,
      input.scope
   );
   const conflictingName = existingProfiles.find(
      (profile) => profile.name === trimmedName && profile.path !== targetPath
   );

   if (conflictingName !== undefined) {
      throw new UserError(
         `A ${input.scope}-scope agent named "${trimmedName}" already exists at ${conflictingName.path}.`
      );
   }

   const conflictingFile = existingProfiles.find(
      (profile) => profile.path === targetPath
   );

   if (conflictingFile !== undefined && input.force !== true) {
      throw new UserError(
         `Agent file ${targetPath} already exists. Re-run with --force to overwrite it.`
      );
   }

   const renderedProfile = renderProfileMarkdown({
      ...(capabilities !== undefined ? { capabilities } : {}),
      description: trimmedDescription,
      instructions: trimmedInstructions,
      model,
      name: trimmedName,
      provider,
      reasoningEffort,
      resultMode,
      ...(timeoutMs !== undefined ? { timeoutMs } : {})
   });
   const parsedProfile = parseFrontmatter(renderedProfile);
   validateFrontmatterAttributes(
      targetPath,
      parsedProfile.attributes,
      parsedProfile.body
   );

   await writeFile(targetPath, renderedProfile, "utf8");

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
      throw new UserError("Agent name is required.");
   }

   const profiles = await listProfiles(projectPaths, scope);
   const profile = profiles.find(
      (currentProfile) =>
         currentProfile.id === trimmedName ||
         currentProfile.name === trimmedName
   );

   if (profile === undefined) {
      throw new UserError(`Agent "${requestedName}" was not found.`);
   }

   const errors: ValidationIssue[] = [];

   if (!profile.body.includes(taskPlaceholder)) {
      errors.push(
         createIssue(
            "missing-task-placeholder",
            `Agent "${profile.name}" must include the ${taskPlaceholder} placeholder in its body.`
         )
      );
   }

   const warnings = collectPromptStructureWarnings(profile.body);

   return {
      errors: dedupeValidationIssues(errors),
      profile: {
         ...(profile.capabilities !== undefined
            ? { capabilities: profile.capabilities }
            : {}),
         id: profile.id,
         ...(typeof profile.model === "string" ? { model: profile.model } : {}),
         name: profile.name,
         path: profile.path,
         provider: profile.provider,
         reasoningEffort: profile.reasoningEffort,
         resultMode: profile.resultMode,
         scope: profile.scope,
         ...(profile.timeoutMs !== undefined
            ? { timeoutMs: profile.timeoutMs }
            : {})
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

const agentScopeChoices = profileScopeChoices;

export {
   agentScopeChoices,
   builtinProfiles as builtinAgents,
   checkProfileDefinition as checkAgentDefinition,
   createProfileFile as createAgentFile,
   listProfiles as listAgents,
   loadProfileDefinition as loadAgentDefinition,
   profileScopeChoices
};
