import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { ProjectPaths } from "./paths.js";
import { getAdapterForProvider } from "./providers/index.js";
import type { AgentDefinition, ProviderId, ValidationIssue } from "./types.js";

const reasoningEfforts = new Set(["low", "medium", "high"]);
const providers = new Set<ProviderId>(["codex", "gemini"]);

type AgentFile = {
   definition: AgentDefinition;
   id: string;
};

function validateFrontmatterAttributes(
   filePath: string,
   attributes: Record<string, string>,
   body: string
): AgentDefinition {
   const name = attributes.name;
   const provider = attributes.provider;
   const description = attributes.description;
   const model = attributes.model;
   const reasoningEffort = attributes.reasoningEffort;

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
      provider: provider as ProviderId,
      ...(typeof model === "string" && model.length > 0 ? { model } : {}),
      ...(normalizedReasoningEffort !== undefined
         ? { reasoningEffort: normalizedReasoningEffort }
         : {})
   };
}

async function readAgentFile(filePath: string): Promise<AgentDefinition> {
   const markdown = await readFile(filePath, "utf8");
   const parsed = parseFrontmatter(markdown);

   return validateFrontmatterAttributes(
      filePath,
      parsed.attributes,
      parsed.body
   );
}

async function readAgentDirectory(
   projectPaths: ProjectPaths
): Promise<AgentFile[]> {
   try {
      const entries = await readdir(projectPaths.agentsDir, {
         withFileTypes: true
      });
      const markdownFiles = entries
         .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
         .map((entry) => entry.name)
         .sort((left, right) => left.localeCompare(right));

      return Promise.all(
         markdownFiles.map(async (entry) => {
            const filePath = path.join(projectPaths.agentsDir, entry);

            return {
               definition: await readAgentFile(filePath),
               id: path.parse(entry).name
            };
         })
      );
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return [];
      }

      throw error;
   }
}

function findAgentDefinition(
   agentFiles: AgentFile[],
   requestedName: string
): AgentDefinition {
   const fileMatch = agentFiles.find(
      (agentFile) => agentFile.id === requestedName
   );

   if (fileMatch) {
      return fileMatch.definition;
   }

   const namedMatches = agentFiles.filter(
      (agentFile) => agentFile.definition.name === requestedName
   );

   if (namedMatches.length === 1) {
      const [match] = namedMatches;

      if (match) {
         return match.definition;
      }
   }

   if (namedMatches.length > 1) {
      throw new UserError(
         `Multiple agent files declare the name "${requestedName}".`
      );
   }

   throw new UserError(`Agent "${requestedName}" was not found.`);
}

export async function loadAgentDefinition(
   projectPaths: ProjectPaths,
   name: string
): Promise<AgentDefinition> {
   const trimmedName = name.trim();

   if (trimmedName.length === 0) {
      throw new UserError("Agent name is required.");
   }

   const agentFiles = await readAgentDirectory(projectPaths);

   return findAgentDefinition(agentFiles, trimmedName);
}

export async function listAgents(
   projectPaths: ProjectPaths
): Promise<Array<Pick<AgentDefinition, "description" | "name" | "provider">>> {
   const agentFiles = await readAgentDirectory(projectPaths);

   return agentFiles
      .map(({ definition }) => definition)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(({ description, name, provider }) => ({
         description,
         name,
         provider
      }));
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

   return [...(await adapter.detect()), ...adapter.validateAgent(agent)];
}
