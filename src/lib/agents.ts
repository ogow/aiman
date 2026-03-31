import { readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import {
   ensureAgentScopeDirectory,
   getAgentsDirectoryForScope
} from "./paths.js";
import type { ProjectPaths } from "./paths.js";
import { parseFrontmatter } from "./frontmatter.js";
import { getAdapterForProvider } from "./providers/index.js";
import type {
   AgentDefinition,
   AgentScope,
   ProviderId,
   RunMode,
   ScopedAgentDefinition,
   ValidationIssue
} from "./types.js";

const reasoningEfforts = new Set(["low", "medium", "high"]);
const providers = new Set<ProviderId>(["codex", "gemini"]);
const runModes = new Set<RunMode>(["read-only", "workspace-write"]);
const scopePriority: Record<AgentScope, number> = {
   project: 0,
   user: 1
};
const taskPlaceholder = "{{task}}";

export const agentScopeChoices = ["project", "user"] as const;

function validateFrontmatterAttributes(
   filePath: string,
   attributes: Record<string, unknown>,
   body: string
): AgentDefinition {
   const name =
      typeof attributes.name === "string" ? attributes.name : undefined;
   const provider =
      typeof attributes.provider === "string" ? attributes.provider : undefined;
   const description =
      typeof attributes.description === "string"
         ? attributes.description
         : undefined;
   const model =
      typeof attributes.model === "string" ? attributes.model : undefined;
   const permissions =
      typeof attributes.permissions === "string"
         ? attributes.permissions
         : undefined;
   const reasoningEffort =
      typeof attributes.reasoningEffort === "string"
         ? attributes.reasoningEffort
         : undefined;
   const skills = parseDeclaredSkills(attributes.skills, name, filePath);
   const requiredMcps = parseDeclaredRequiredMcps(
      attributes.requiredMcps,
      name,
      filePath
   );

   if (typeof name !== "string" || name.length === 0) {
      throw new UserError(`Agent file ${filePath} is missing a name.`);
   }

   if (!providers.has(provider as ProviderId)) {
      throw new UserError(
         `Agent "${name}" has an unsupported provider: ${provider ?? "missing"}.`
      );
   }

   if (typeof description !== "string" || description.length === 0) {
      throw new UserError(`Agent "${name}" is missing a description.`);
   }

   if (!runModes.has(permissions as RunMode)) {
      throw new UserError(
         `Agent "${name}" has invalid permissions: ${permissions ?? "missing"}.`
      );
   }

   if (body.length === 0) {
      throw new UserError(`Agent "${name}" has an empty body.`);
   }

   if (
      reasoningEffort !== undefined &&
      !reasoningEfforts.has(reasoningEffort)
   ) {
      throw new UserError(
         `Agent "${name}" has an invalid reasoningEffort: ${reasoningEffort}.`
      );
   }

   const normalizedReasoningEffort =
      typeof reasoningEffort === "string" &&
      reasoningEfforts.has(reasoningEffort)
         ? (reasoningEffort as AgentDefinition["reasoningEffort"])
         : undefined;

   return {
      body,
      description,
      name,
      permissions: permissions as RunMode,
      provider: provider as ProviderId,
      ...(typeof model === "string" && model.length > 0 ? { model } : {}),
      ...(normalizedReasoningEffort !== undefined
         ? { reasoningEffort: normalizedReasoningEffort }
         : {}),
      ...(requiredMcps.length > 0 ? { requiredMcps } : {}),
      ...(skills.length > 0 ? { skills } : {})
   };
}

function parseDeclaredStringList(input: {
   agentName: string | undefined;
   duplicateLabel: string;
   emptyLabel: string;
   filePath: string;
   invalidLabel: string;
   value: unknown;
}): string[] {
   if (input.value === undefined) {
      return [];
   }

   if (!Array.isArray(input.value)) {
      throw new UserError(
         `Agent "${input.agentName ?? input.filePath}" has invalid ${input.invalidLabel}: expected a YAML list of strings.`
      );
   }

   const values = input.value.map((entry) => {
      if (typeof entry !== "string") {
         throw new UserError(
            `Agent "${input.agentName ?? input.filePath}" has invalid ${input.invalidLabel}: expected a YAML list of strings.`
         );
      }

      const trimmedEntry = entry.trim();

      if (trimmedEntry.length === 0) {
         throw new UserError(
            `Agent "${input.agentName ?? input.filePath}" declares an empty ${input.emptyLabel}.`
         );
      }

      return trimmedEntry;
   });
   const uniqueValues = new Set(values);

   if (uniqueValues.size !== values.length) {
      throw new UserError(
         `Agent "${input.agentName ?? input.filePath}" declares duplicate ${input.duplicateLabel}.`
      );
   }

   return values;
}

function parseDeclaredSkills(
   value: unknown,
   agentName: string | undefined,
   filePath: string
): string[] {
   return parseDeclaredStringList({
      agentName,
      duplicateLabel: "skill names",
      emptyLabel: "skill name",
      filePath,
      invalidLabel: "skills",
      value
   });
}

function parseDeclaredRequiredMcps(
   value: unknown,
   agentName: string | undefined,
   filePath: string
): string[] {
   return parseDeclaredStringList({
      agentName,
      duplicateLabel: "required MCP names",
      emptyLabel: "required MCP name",
      filePath,
      invalidLabel: "requiredMcps",
      value
   });
}

async function readAgentFile(input: {
   filePath: string;
   id: string;
   scope: AgentScope;
}): Promise<ScopedAgentDefinition> {
   const markdown = await readFile(input.filePath, "utf8");
   const parsed = parseFrontmatter(markdown);
   const definition = validateFrontmatterAttributes(
      input.filePath,
      parsed.attributes,
      parsed.body
   );

   return {
      ...definition,
      id: input.id,
      path: input.filePath,
      scope: input.scope
   };
}

async function readAgentDirectory(
   projectPaths: ProjectPaths,
   scope: AgentScope
): Promise<ScopedAgentDefinition[]> {
   const agentsDir = getAgentsDirectoryForScope(projectPaths, scope);

   try {
      const entries = await readdir(agentsDir, {
         withFileTypes: true
      });
      const markdownFiles = entries
         .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
         .map((entry) => entry.name)
         .sort((left, right) => left.localeCompare(right));

      return Promise.all(
         markdownFiles.map(async (entry) =>
            readAgentFile({
               filePath: path.join(agentsDir, entry),
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

async function readAgentDirectories(
   projectPaths: ProjectPaths,
   scope?: AgentScope
): Promise<ScopedAgentDefinition[]> {
   const scopes = scope === undefined ? agentScopeChoices : [scope];
   const scopedAgents = await Promise.all(
      scopes.map(async (currentScope) =>
         readAgentDirectory(projectPaths, currentScope)
      )
   );

   return scopedAgents.flat();
}

function compareAgents(
   left: ScopedAgentDefinition,
   right: ScopedAgentDefinition
): number {
   const nameComparison = left.name.localeCompare(right.name);

   if (nameComparison !== 0) {
      return nameComparison;
   }

   const scopeComparison =
      scopePriority[left.scope] - scopePriority[right.scope];

   if (scopeComparison !== 0) {
      return scopeComparison;
   }

   return left.path.localeCompare(right.path);
}

function applyListPrecedence(
   agentFiles: ScopedAgentDefinition[],
   scope?: AgentScope
): ScopedAgentDefinition[] {
   if (scope !== undefined) {
      return agentFiles;
   }

   const keptScopeByName = new Map<string, AgentScope>();

   return agentFiles.filter((agentFile) => {
      const keptScope = keptScopeByName.get(agentFile.name);

      if (keptScope === undefined) {
         keptScopeByName.set(agentFile.name, agentFile.scope);
         return true;
      }

      return keptScope === agentFile.scope;
   });
}

function findAgentDefinition(
   agentFiles: ScopedAgentDefinition[],
   requestedName: string,
   scope?: AgentScope
): ScopedAgentDefinition {
   const scopes = scope === undefined ? agentScopeChoices : [scope];

   for (const currentScope of scopes) {
      const scopedAgents = agentFiles.filter(
         (agentFile) => agentFile.scope === currentScope
      );
      const fileMatch = scopedAgents.find(
         (agentFile) => agentFile.id === requestedName
      );

      if (fileMatch) {
         return fileMatch;
      }

      const namedMatches = scopedAgents.filter(
         (agentFile) => agentFile.name === requestedName
      );

      if (namedMatches.length === 1) {
         const [match] = namedMatches;

         if (match) {
            return match;
         }
      }

      if (namedMatches.length > 1) {
         throw new UserError(
            `Multiple ${currentScope}-scope agent files declare the name "${requestedName}".`
         );
      }
   }

   throw new UserError(`Agent "${requestedName}" was not found.`);
}

function slugifyAgentName(name: string): string {
   return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
}

function ensureTrailingPeriod(value: string): string {
   const trimmed = value.trim();

   return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function humanizeAgentName(name: string): string {
   return name.trim().replace(/[-_]+/g, " ").replace(/\s+/g, " ");
}

function renderAgentMarkdown(input: {
   description: string;
   instructions: string;
   model?: string;
   name: string;
   permissions: RunMode;
   provider: ProviderId;
   reasoningEffort?: AgentDefinition["reasoningEffort"];
}): string {
   const lines = [
      "---",
      `name: ${input.name}`,
      `provider: ${input.provider}`,
      `description: ${input.description}`,
      `permissions: ${input.permissions}`,
      ...(typeof input.model === "string" && input.model.length > 0
         ? [`model: ${input.model}`]
         : []),
      ...(typeof input.reasoningEffort === "string"
         ? [`reasoningEffort: ${input.reasoningEffort}`]
         : []),
      "---",
      "",
      "## Role",
      `You are the ${humanizeAgentName(input.name)} specialist. ${ensureTrailingPeriod(input.description)}`,
      "",
      "## Task Input",
      taskPlaceholder,
      "",
      "## Instructions",
      input.instructions.trim(),
      "",
      "## Constraints",
      "- Stay within the assigned task.",
      "- State assumptions clearly when information is missing.",
      "- Do not invent facts, files, or results.",
      "",
      "## Expected Output",
      "- Deliver a concise result focused on the task.",
      "- Highlight key findings or recommendations clearly.",
      "- Include clear next steps when relevant.",
      ""
   ];

   return lines.join("\n");
}

export async function loadAgentDefinition(
   projectPaths: ProjectPaths,
   name: string,
   scope?: AgentScope
): Promise<ScopedAgentDefinition> {
   const trimmedName = name.trim();

   if (trimmedName.length === 0) {
      throw new UserError("Agent name is required.");
   }

   const agentFiles = await readAgentDirectories(projectPaths, scope);

   return findAgentDefinition(agentFiles, trimmedName, scope);
}

export async function listAgents(
   projectPaths: ProjectPaths,
   scope?: AgentScope
): Promise<
   Array<
      Pick<
         ScopedAgentDefinition,
         "description" | "name" | "path" | "provider" | "scope"
      >
   >
> {
   const agentFiles = await readAgentDirectories(projectPaths, scope);

   return applyListPrecedence(agentFiles.sort(compareAgents), scope).map(
      ({ description, name, path: filePath, provider, scope: agentScope }) => ({
         description,
         name,
         path: filePath,
         provider,
         scope: agentScope
      })
   );
}

export async function createAgentFile(
   projectPaths: ProjectPaths,
   input: {
      description: string;
      force?: boolean;
      instructions: string;
      model?: string;
      name: string;
      permissions: RunMode;
      provider: ProviderId;
      reasoningEffort?: AgentDefinition["reasoningEffort"];
      scope: AgentScope;
   }
): Promise<ScopedAgentDefinition> {
   const trimmedName = input.name.trim();
   const trimmedDescription = input.description.trim();
   const trimmedInstructions = input.instructions.trim();

   if (trimmedName.length === 0) {
      throw new UserError("Agent name is required.");
   }

   if (trimmedDescription.length === 0) {
      throw new UserError("Agent description is required.");
   }

   if (trimmedInstructions.length === 0) {
      throw new UserError("Agent instructions are required.");
   }

   const fileId = slugifyAgentName(trimmedName);

   if (fileId.length === 0) {
      throw new UserError(
         `Agent name "${input.name}" does not produce a valid file name.`
      );
   }

   await ensureAgentScopeDirectory(projectPaths, input.scope);

   const agentsDir = getAgentsDirectoryForScope(projectPaths, input.scope);
   const targetPath = path.join(agentsDir, `${fileId}.md`);
   const existingAgents = await readAgentDirectory(projectPaths, input.scope);
   const conflictingName = existingAgents.find(
      (agent) => agent.name === trimmedName && agent.path !== targetPath
   );

   if (conflictingName) {
      throw new UserError(
         `A ${input.scope}-scope agent named "${trimmedName}" already exists at ${conflictingName.path}.`
      );
   }

   const conflictingFile = existingAgents.find(
      (agent) => agent.path === targetPath
   );

   if (conflictingFile && input.force !== true) {
      throw new UserError(
         `Agent file ${targetPath} already exists. Re-run with --force to overwrite it.`
      );
   }

   const markdown = renderAgentMarkdown({
      description: trimmedDescription,
      instructions: trimmedInstructions,
      ...(typeof input.model === "string" && input.model.length > 0
         ? { model: input.model }
         : {}),
      name: trimmedName,
      permissions: input.permissions,
      provider: input.provider,
      ...(typeof input.reasoningEffort === "string"
         ? { reasoningEffort: input.reasoningEffort }
         : {})
   });

   await writeFile(targetPath, markdown, "utf8");

   return readAgentFile({
      filePath: targetPath,
      id: fileId,
      scope: input.scope
   });
}

export async function collectAgentValidationIssues(
   agent: AgentDefinition
): Promise<ValidationIssue[]> {
   const adapter = getAdapterForProvider(agent.provider);
   return adapter.validateAgent(agent);
}

export async function collectAgentRuntimeIssues(
   agent: AgentDefinition
): Promise<ValidationIssue[]> {
   const adapter = getAdapterForProvider(agent.provider);
   const promptIssues: ValidationIssue[] = agent.body.includes(taskPlaceholder)
      ? []
      : [
           {
              code: "missing-task-placeholder",
              message: `Agent "${agent.name}" must include the ${taskPlaceholder} placeholder in its body.`
           }
        ];

   return [
      ...(await adapter.detect(agent)),
      ...promptIssues,
      ...adapter.validateAgent(agent)
   ];
}
