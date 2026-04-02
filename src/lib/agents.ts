import type {
   AgentCheckReport,
   AgentDefinition,
   AgentScope,
   ScopedAgentDefinition,
   ValidationIssue
} from "./types.js";
import {
   builtinProfiles,
   checkProfileDefinition,
   createProfileFile,
   listProfiles,
   loadProfileDefinition,
   migrateLegacyAgents,
   profileScopeChoices
} from "./profiles.js";
import type { ProjectPaths } from "./paths.js";

export { builtinProfiles, profileScopeChoices as agentScopeChoices };

export async function loadAgentDefinition(
   projectPaths: ProjectPaths,
   name: string,
   scope?: AgentScope
): Promise<ScopedAgentDefinition> {
   return loadProfileDefinition(projectPaths, name, scope);
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
   return listProfiles(projectPaths, scope);
}

export async function createAgentFile(
   projectPaths: ProjectPaths,
   input: {
      description: string;
      force?: boolean;
      instructions: string;
      model: string;
      mode?: AgentDefinition["mode"];
      name: string;
      permissions?: AgentDefinition["mode"];
      provider: AgentDefinition["provider"];
      reasoningEffort?: string;
      scope: AgentScope;
   }
): Promise<ScopedAgentDefinition> {
   return createProfileFile(projectPaths, {
      ...input,
      mode: input.mode ?? input.permissions ?? "safe"
   });
}

export async function checkAgentDefinition(
   projectPaths: ProjectPaths,
   name: string,
   scope?: AgentScope
): Promise<AgentCheckReport> {
   const report = await checkProfileDefinition(projectPaths, name, scope);

   return {
      agent: report.profile,
      errors: report.errors,
      status: report.status,
      warnings: report.warnings
   };
}

export async function collectAgentValidationIssues(
   agent: AgentDefinition
): Promise<ValidationIssue[]> {
   const issues: ValidationIssue[] = [];

   if (!agent.body.includes("{{task}}")) {
      issues.push({
         code: "missing-task-placeholder",
         message: `Profile "${agent.name}" must include the {{task}} placeholder in its body.`
      });
   }

   return issues;
}

export async function collectAgentRuntimeIssues(
   agent: AgentDefinition
): Promise<ValidationIssue[]> {
   return collectAgentValidationIssues(agent);
}

export { migrateLegacyAgents };
