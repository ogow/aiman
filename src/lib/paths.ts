import { mkdir } from "node:fs/promises";
import * as path from "node:path";

export type ProjectPaths = {
   agentsDir: string;
   aimanDir: string;
   projectRoot: string;
   runsDir: string;
};

export function getProjectPaths(projectRoot = process.cwd()): ProjectPaths {
   const aimanDir = path.join(projectRoot, ".aiman");

   return {
      agentsDir: path.join(aimanDir, "agents"),
      aimanDir,
      projectRoot,
      runsDir: path.join(aimanDir, "runs")
   };
}

export async function ensureProjectDirectories(
   projectPaths: ProjectPaths
): Promise<void> {
   await mkdir(projectPaths.agentsDir, { recursive: true });
   await mkdir(projectPaths.runsDir, { recursive: true });
}

export function resolveRunCwd(projectRoot: string, cwd?: string): string {
   if (typeof cwd !== "string" || cwd.length === 0) {
      return projectRoot;
   }

   return path.resolve(projectRoot, cwd);
}
