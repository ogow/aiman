import os from "node:os";
import {
   mkdir,
   readFile,
   readdir,
   rename,
   stat,
   writeFile
} from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import * as z from "zod/v4";

import { AgentConfigError, ValidationError } from "./errors.js";
import {
   describeReasoningEffort,
   normalizeReasoningEffort,
   supportsReasoningEffort
} from "./models.js";
import type {
   Agent,
   AgentConfigRecord,
   AgentCreateInput,
   AgentFrontmatter,
   AgentMetadata,
   CreateAgentOptions,
   Scope
} from "./types.js";

const agentFrontmatterSchema = z
   .object({
      name: z
         .string()
         .trim()
         .min(1, { error: "name must be a non-empty string." }),
      provider: z
         .string()
         .trim()
         .min(1, { error: "provider must be a non-empty string." }),
      description: z.string().optional(),
      model: z.string().trim().optional(),
      reasoningEffort: z
         .string()
         .trim()
         .min(1, { error: "reasoningEffort must be a non-empty string." })
         .optional()
   })
   .strict();

function validateAgentReasoningEffort({
   provider,
   model = "",
   reasoningEffort,
   onError
}: {
   provider: string;
   model: string | undefined;
   reasoningEffort: string | undefined;
   onError(
      this: void,
      message: string,
      options?: { fix?: string | null }
   ): never;
}): string {
   if (!reasoningEffort) {
      return "";
   }

   if (!supportsReasoningEffort(provider, model)) {
      onError("reasoningEffort is not supported for this provider.", {
         fix: "Remove reasoningEffort from the agent, or use a provider that supports it."
      });
      return "";
   }

   const normalizedReasoningEffort = normalizeReasoningEffort(
      provider,
      model,
      reasoningEffort
   );

   if (!normalizedReasoningEffort) {
      onError(describeReasoningEffort(provider, model));
      return "";
   }

   return normalizedReasoningEffort;
}

async function exists(filePath: string): Promise<boolean> {
   try {
      await stat(filePath);
      return true;
   } catch {
      return false;
   }
}

function slugifyAgentName(name: string): string {
   return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-");
}

function normalizeAgent(
   record: AgentConfigRecord,
   metadata: AgentMetadata
): Agent {
   return {
      name: record.name,
      provider: record.provider,
      description:
         typeof record.description === "string"
            ? record.description.trim()
            : "",
      model: typeof record.model === "string" ? record.model.trim() : "",
      reasoningEffort:
         typeof record.reasoningEffort === "string"
            ? record.reasoningEffort.trim()
            : "",
      systemPrompt: record.systemPrompt,
      source: metadata.source,
      path: metadata.path,
      registryDir: metadata.registryDir
   };
}

function renderZodIssues(error: z.ZodError): string {
   return error.issues
      .map((issue) => {
         const prefix =
            issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
         return `${prefix}${issue.message}`;
      })
      .join("; ");
}

function parseAgentMarkdown(raw: string, filePath: string): AgentConfigRecord {
   let parsed;

   try {
      parsed = matter(raw);
   } catch (error) {
      throw new AgentConfigError({
         filePath,
         message: error instanceof Error ? error.message : String(error),
         fix: "Use valid YAML frontmatter at the top of the Markdown file."
      });
   }

   const frontmatter = parsed.data ?? {};
   const result = agentFrontmatterSchema.safeParse(frontmatter);

   if (!result.success) {
      throw new AgentConfigError({
         filePath,
         message: renderZodIssues(result.error),
         fix: "Use only name, provider, optional description, optional model, and optional reasoningEffort in frontmatter."
      });
   }

   const systemPrompt = parsed.content.trim();

   if (!systemPrompt) {
      throw new AgentConfigError({
         filePath,
         message:
            "prompt body must be a non-empty Markdown section below the frontmatter."
      });
   }

   const reasoningEffort = validateAgentReasoningEffort({
      provider: result.data.provider,
      model: result.data.model,
      reasoningEffort: result.data.reasoningEffort,
      onError(message, options = {}) {
         throw new AgentConfigError({
            filePath,
            message,
            ...options
         });
      }
   });

   return {
      ...result.data,
      description:
         typeof result.data.description === "string"
            ? result.data.description.trim()
            : "",
      model:
         typeof result.data.model === "string" ? result.data.model.trim() : "",
      reasoningEffort,
      systemPrompt
   };
}

export class AgentRegistry {
   workspaceDir: string;
   homeDir: string;
   homeAgentsDir: string;
   projectAgentsDir: string;

   constructor({
      workspaceDir,
      homeDir = path.join(os.homedir(), ".aiman")
   }: {
      workspaceDir: string;
      homeDir?: string;
   }) {
      this.workspaceDir = workspaceDir;
      this.homeDir = homeDir;
      this.homeAgentsDir = path.join(homeDir, "agents");
      this.projectAgentsDir = path.join(workspaceDir, ".aiman", "agents");
   }

   async init(): Promise<void> {
      await mkdir(this.projectAgentsDir, { recursive: true });
      await mkdir(this.homeAgentsDir, { recursive: true });
   }

   async createAgent(
      input: AgentCreateInput,
      { scope = "project" }: CreateAgentOptions = {}
   ): Promise<Agent> {
      const registryDir =
         scope === "home" ? this.homeAgentsDir : this.projectAgentsDir;
      await mkdir(registryDir, { recursive: true });

      const name = typeof input.name === "string" ? input.name.trim() : "";
      const provider =
         typeof input.provider === "string" ? input.provider.trim() : "";
      const description =
         typeof input.description === "string" ? input.description.trim() : "";
      const model = typeof input.model === "string" ? input.model.trim() : "";
      const rawReasoningEffort =
         typeof input.reasoningEffort === "string"
            ? input.reasoningEffort.trim()
            : "";
      const systemPrompt =
         typeof input.systemPrompt === "string"
            ? input.systemPrompt.trim()
            : typeof input.prompt === "string"
              ? input.prompt.trim()
              : "";

      if (!name) {
         throw new ValidationError("name must be a non-empty string.");
      }

      if (!provider) {
         throw new ValidationError("provider must be a non-empty string.");
      }

      if (!systemPrompt) {
         throw new ValidationError("prompt must be a non-empty string.");
      }

      const reasoningEffort = validateAgentReasoningEffort({
         provider,
         model,
         reasoningEffort: rawReasoningEffort,
         onError(message, options = {}) {
            throw new ValidationError(message, options);
         }
      });

      const filePath = path.join(registryDir, `${slugifyAgentName(name)}.md`);
      const frontmatter: AgentFrontmatter = {
         name,
         provider
      };

      if (description) {
         frontmatter.description = description;
      }

      if (model) {
         frontmatter.model = model;
      }

      if (reasoningEffort) {
         frontmatter.reasoningEffort = reasoningEffort;
      }

      const agent = normalizeAgent(
         {
            ...frontmatter,
            systemPrompt
         },
         {
            source: scope,
            path: filePath,
            registryDir
         }
      );

      const tempPath = `${agent.path}.tmp`;
      const markdown = matter.stringify(`${systemPrompt}\n`, frontmatter);
      await writeFile(tempPath, markdown, "utf8");
      await rename(tempPath, agent.path);
      return agent;
   }

   async listVisibleAgents(): Promise<Agent[]> {
      const homeAgents = await this.#readAgentsFromDirectory(
         this.homeAgentsDir,
         "home"
      );
      const projectAgents = await this.#readAgentsFromDirectory(
         this.projectAgentsDir,
         "project"
      );
      const merged = new Map<string, Agent>();

      for (const agent of homeAgents) {
         merged.set(agent.name, agent);
      }

      for (const agent of projectAgents) {
         merged.set(agent.name, agent);
      }

      return [...merged.values()].sort((left, right) =>
         left.name.localeCompare(right.name)
      );
   }

   async getVisibleAgent(name: string): Promise<Agent | null> {
      const agents = await this.listVisibleAgents();
      return agents.find((agent) => agent.name === name) ?? null;
   }

   async #readAgentsFromDirectory(
      directory: string,
      source: Scope
   ): Promise<Agent[]> {
      if (!(await exists(directory))) {
         return [];
      }

      const entries = await readdir(directory, { withFileTypes: true });
      const agents: Agent[] = [];

      for (const entry of entries) {
         if (!entry.isFile() || !entry.name.endsWith(".md")) {
            continue;
         }

         const filePath = path.join(directory, entry.name);
         const raw = await readFile(filePath, "utf8");
         const parsed = parseAgentMarkdown(raw, filePath);
         agents.push(
            normalizeAgent(parsed, {
               source,
               path: filePath,
               registryDir: directory
            })
         );
      }

      return agents;
   }
}
