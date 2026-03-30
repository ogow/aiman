import * as os from "node:os";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";

import type { AgentScope } from "./types.js";

export type ProjectPaths = {
   aimanDir: string;
   projectRoot: string;
   projectAgentsDir: string;
   runsDir: string;
   userAimanDir: string;
   userAgentsDir: string;
};

export function getProjectPaths(projectRoot = process.cwd()): ProjectPaths {
   const aimanDir = path.join(projectRoot, ".aiman");
   const userAimanDir = path.join(os.homedir(), ".aiman");

   return {
      aimanDir,
      projectRoot,
      projectAgentsDir: path.join(aimanDir, "agents"),
      runsDir: path.join(aimanDir, "runs"),
      userAimanDir,
      userAgentsDir: path.join(userAimanDir, "agents")
   };
}

export async function ensureProjectDirectories(
   projectPaths: ProjectPaths
): Promise<void> {
   await mkdir(projectPaths.projectAgentsDir, { recursive: true });
   await mkdir(projectPaths.runsDir, { recursive: true });
}

export async function ensureAgentScopeDirectory(
   projectPaths: ProjectPaths,
   scope: AgentScope
): Promise<void> {
   await mkdir(getAgentsDirectoryForScope(projectPaths, scope), {
      recursive: true
   });
}

export function getAgentsDirectoryForScope(
   projectPaths: ProjectPaths,
   scope: AgentScope
): string {
   return scope === "project"
      ? projectPaths.projectAgentsDir
      : projectPaths.userAgentsDir;
}

export function resolveRunCwd(projectRoot: string, cwd?: string): string {
   if (typeof cwd !== "string" || cwd.length === 0) {
      return projectRoot;
   }

   return path.resolve(projectRoot, cwd);
}
