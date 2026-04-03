import { existsSync, realpathSync } from "node:fs";
import * as os from "node:os";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";

import type { ProfileScope } from "./types.js";

export type ProjectPaths = {
   aimanDir: string;
   projectAgentsDir: string;
   projectProfilesDir: string;
   projectRoot: string;
   projectSkillsDir: string;
   runDbPath: string;
   runsDir: string;
   userAimanDir: string;
   userAgentsDir: string;
   userProfilesDir: string;
   userSkillsDir: string;
};

function getUserHomeDirectory(): string {
   const home =
      process.env.HOME ??
      process.env.USERPROFILE ??
      (process.env.HOMEDRIVE !== undefined && process.env.HOMEPATH !== undefined
         ? path.join(process.env.HOMEDRIVE, process.env.HOMEPATH)
         : undefined);

   return typeof home === "string" && home.length > 0 ? home : os.homedir();
}

function normalizePathForComparison(directoryPath: string): string {
   let resolvedPath = path.resolve(directoryPath);

   try {
      resolvedPath = realpathSync.native(resolvedPath);
   } catch {}

   return process.platform === "win32"
      ? resolvedPath.toLowerCase()
      : resolvedPath;
}

function getUserHomeDirectories(): Set<string> {
   const candidates = [
      process.env.HOME,
      process.env.USERPROFILE,
      process.env.HOMEDRIVE !== undefined && process.env.HOMEPATH !== undefined
         ? path.join(process.env.HOMEDRIVE, process.env.HOMEPATH)
         : undefined,
      os.homedir()
   ];

   return new Set(
      candidates.flatMap((candidate) =>
         typeof candidate === "string" && candidate.length > 0
            ? [normalizePathForComparison(candidate)]
            : []
      )
   );
}

function hasProjectMarker(
   directoryPath: string,
   userHomeDirectories: Set<string>
): boolean {
   const isUserHomeDirectory = userHomeDirectories.has(
      normalizePathForComparison(directoryPath)
   );

   return (
      (!isUserHomeDirectory &&
         existsSync(path.join(directoryPath, ".aiman"))) ||
      (!isUserHomeDirectory &&
         existsSync(path.join(directoryPath, ".agents"))) ||
      (!isUserHomeDirectory && existsSync(path.join(directoryPath, ".git")))
   );
}

function resolveProjectRoot(startDirectory: string): string {
   let currentDirectory = path.resolve(startDirectory);
   const userHomeDirectories = getUserHomeDirectories();

   while (true) {
      if (hasProjectMarker(currentDirectory, userHomeDirectories)) {
         return currentDirectory;
      }

      const parentDirectory = path.dirname(currentDirectory);

      if (parentDirectory === currentDirectory) {
         return path.resolve(startDirectory);
      }

      currentDirectory = parentDirectory;
   }
}

export function getProjectPaths(projectRoot = process.cwd()): ProjectPaths {
   const resolvedProjectRoot = resolveProjectRoot(projectRoot);
   const aimanDir = path.join(resolvedProjectRoot, ".aiman");
   const userHomeDir = getUserHomeDirectory();
   const userAimanDir = path.join(userHomeDir, ".aiman");

   return {
      aimanDir,
      projectAgentsDir: path.join(aimanDir, "profiles"),
      projectProfilesDir: path.join(aimanDir, "profiles"),
      projectRoot: resolvedProjectRoot,
      projectSkillsDir: path.join(aimanDir, "skills"),
      runDbPath: path.join(userAimanDir, "aiman.db"),
      runsDir: path.join(userAimanDir, "runs"),
      userAimanDir,
      userAgentsDir: path.join(userAimanDir, "profiles"),
      userProfilesDir: path.join(userAimanDir, "profiles"),
      userSkillsDir: path.join(userAimanDir, "skills")
   };
}

export async function ensureProjectDirectories(
   projectPaths: ProjectPaths
): Promise<void> {
   await mkdir(projectPaths.projectProfilesDir, { recursive: true });
   await mkdir(projectPaths.projectSkillsDir, { recursive: true });
   await mkdir(projectPaths.runsDir, { recursive: true });
}

export async function ensureProfileScopeDirectory(
   projectPaths: ProjectPaths,
   scope: ProfileScope
): Promise<void> {
   await mkdir(getProfilesDirectoryForScope(projectPaths, scope), {
      recursive: true
   });
}

export async function ensureSkillScopeDirectory(
   projectPaths: ProjectPaths,
   scope: ProfileScope
): Promise<void> {
   await mkdir(getSkillsDirectoryForScope(projectPaths, scope), {
      recursive: true
   });
}

export function getProfilesDirectoryForScope(
   projectPaths: ProjectPaths,
   scope: ProfileScope
): string {
   return scope === "project"
      ? projectPaths.projectProfilesDir
      : projectPaths.userProfilesDir;
}

export function getSkillsDirectoryForScope(
   projectPaths: ProjectPaths,
   scope: ProfileScope
): string {
   return scope === "project"
      ? projectPaths.projectSkillsDir
      : projectPaths.userSkillsDir;
}

export function resolveRunCwd(projectRoot: string, cwd?: string): string {
   if (typeof cwd !== "string" || cwd.length === 0) {
      return projectRoot;
   }

   return path.resolve(projectRoot, cwd);
}
