import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
   cp,
   mkdir,
   mkdtemp,
   readFile,
   readdir,
   rm,
   stat
} from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { UserError, hasErrorCode } from "./errors.js";
import {
   ensureSkillScopeDirectory,
   getSkillsDirectoryForScope,
   type ProjectPaths
} from "./paths.js";
import { parseFrontmatter } from "./frontmatter.js";
import type { AgentScope, ResolvedSkill } from "./types.js";

type SkillDefinition = {
   description: string;
   name: string;
   path: string;
   scope: AgentScope;
};

type InstallSkillInput = {
   force?: boolean;
   repositorySubpath?: string;
   scope: AgentScope;
   sourcePath: string;
};

type ResolvedSkillSource = {
   cleanup?: () => Promise<void>;
   directory: string;
   fallbackName: string;
   omitGitMetadata?: boolean;
};

function hashText(value: string): string {
   return createHash("sha256").update(value).digest("hex");
}

function validateSkillName(name: string): string {
   const trimmedName = name.trim();

   if (trimmedName.length === 0) {
      throw new UserError("Skill names must not be empty.");
   }

   if (
      trimmedName === "." ||
      trimmedName === ".." ||
      trimmedName.includes("/") ||
      trimmedName.includes("\\")
   ) {
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

async function readOptionalSkillDefinition(input: {
   filePath: string;
   name: string;
   scope: AgentScope;
}): Promise<SkillDefinition | undefined> {
   try {
      return await readSkillDefinition(input);
   } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
         return undefined;
      }

      throw error;
   }
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

      const skills = await Promise.all(
         skillNames.map((name) =>
            readOptionalSkillDefinition({
               filePath: path.join(skillsDir, name, "SKILL.md"),
               name,
               scope
            })
         )
      );

      return skills.filter((skill) => skill !== undefined);
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

function getInstalledSkillName(markdown: string, fallbackName: string): string {
   const parsed = parseFrontmatter(markdown);
   const frontmatterName = parsed.attributes.name;

   if (
      typeof frontmatterName === "string" &&
      frontmatterName.trim().length > 0
   ) {
      return validateSkillName(frontmatterName);
   }

   return validateSkillName(fallbackName);
}

function isGitSource(sourcePath: string): boolean {
   return (
      sourcePath.startsWith("file://") ||
      sourcePath.startsWith("git@") ||
      sourcePath.startsWith("git://") ||
      sourcePath.startsWith("http://") ||
      sourcePath.startsWith("https://") ||
      sourcePath.startsWith("ssh://")
   );
}

async function readDirectoryStats(
   directoryPath: string
): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
   return stat(directoryPath).catch((error: unknown) => {
      if (hasErrorCode(error, "ENOENT")) {
         return undefined;
      }

      throw error;
   });
}

async function ensureSkillDirectoryExists(
   directoryPath: string
): Promise<void> {
   const directoryStats = await readDirectoryStats(directoryPath);

   if (directoryStats === undefined) {
      throw new UserError(`Skill source was not found: ${directoryPath}`);
   }

   if (!directoryStats.isDirectory()) {
      throw new UserError(
         `Skill source must be a directory that contains SKILL.md: ${directoryPath}`
      );
   }
}

async function getBundledSkillDirectories(
   repositoryRoot: string
): Promise<string[]> {
   const skillsRoot = path.join(repositoryRoot, "skills");
   const skillsRootStats = await readDirectoryStats(skillsRoot);

   if (skillsRootStats === undefined || !skillsRootStats.isDirectory()) {
      return [];
   }

   const entries = await readdir(skillsRoot, { withFileTypes: true });
   const bundledSkillDirectories: string[] = [];

   for (const entry of entries) {
      if (!entry.isDirectory()) {
         continue;
      }

      const candidateDirectory = path.join(skillsRoot, entry.name);
      const candidateSkill = path.join(candidateDirectory, "SKILL.md");
      const candidateStats = await readDirectoryStats(candidateSkill);

      if (candidateStats?.isFile() === true) {
         bundledSkillDirectories.push(candidateDirectory);
      }
   }

   return bundledSkillDirectories.sort((left, right) =>
      left.localeCompare(right)
   );
}

async function resolveSkillDirectoryFromRoot(
   repositoryRoot: string,
   repositorySubpath?: string
): Promise<string> {
   if (
      typeof repositorySubpath === "string" &&
      repositorySubpath.trim().length > 0
   ) {
      const explicitDirectory = path.resolve(repositoryRoot, repositorySubpath);
      const relativePath = path.relative(repositoryRoot, explicitDirectory);

      if (
         relativePath === ".." ||
         relativePath.startsWith(`..${path.sep}`) ||
         path.isAbsolute(relativePath)
      ) {
         throw new UserError(
            `Skill path must stay inside the source repo: ${repositorySubpath}`
         );
      }

      await ensureSkillDirectoryExists(explicitDirectory);
      return explicitDirectory;
   }

   const rootSkillPath = path.join(repositoryRoot, "SKILL.md");
   const rootSkillStats = await readDirectoryStats(rootSkillPath);

   if (rootSkillStats?.isFile() === true) {
      return repositoryRoot;
   }

   const bundledSkillDirectories =
      await getBundledSkillDirectories(repositoryRoot);

   if (bundledSkillDirectories.length === 1) {
      return bundledSkillDirectories[0]!;
   }

   if (bundledSkillDirectories.length === 0) {
      throw new UserError(
         'Git source did not contain an installable skill. Expected "SKILL.md" at the repo root or exactly one "skills/<name>/SKILL.md" in the cloned default branch.'
      );
   }

   throw new UserError(
      'Git source contains multiple bundled skills. Re-run with "--path skills/<name>" to choose one from the cloned default branch.'
   );
}

async function resolveLocalSkillDirectory(
   sourceRoot: string,
   repositorySubpath?: string
): Promise<string> {
   if (
      typeof repositorySubpath === "string" &&
      repositorySubpath.trim().length > 0
   ) {
      return resolveSkillDirectoryFromRoot(sourceRoot, repositorySubpath);
   }

   const localSkillPath = path.join(sourceRoot, "SKILL.md");
   const localSkillStats = await readDirectoryStats(localSkillPath);

   if (localSkillStats?.isFile() === true) {
      return sourceRoot;
   }

   const localSkillsRoot = path.join(sourceRoot, "skills");
   const localSkillsRootStats = await readDirectoryStats(localSkillsRoot);

   if (localSkillsRootStats?.isDirectory() === true) {
      return resolveSkillDirectoryFromRoot(sourceRoot);
   }

   throw new UserError(`Skill source is missing SKILL.md: ${sourceRoot}`);
}

function getGitSourceBaseName(sourcePath: string): string {
   const trimmedSource = sourcePath.trim().replace(/[/\\]+$/, "");
   let candidatePath = trimmedSource;

   if (trimmedSource.startsWith("git@")) {
      const separatorIndex = trimmedSource.indexOf(":");

      if (separatorIndex >= 0 && separatorIndex < trimmedSource.length - 1) {
         candidatePath = trimmedSource.slice(separatorIndex + 1);
      }
   } else {
      try {
         candidatePath = new URL(trimmedSource).pathname;
      } catch {
         candidatePath = trimmedSource;
      }
   }

   const baseName = path.basename(candidatePath);
   const normalizedName = baseName.endsWith(".git")
      ? baseName.slice(0, -4)
      : baseName;

   return validateSkillName(normalizedName);
}

async function runGitCommand(input: {
   args: string[];
   cwd?: string;
}): Promise<void> {
   const child = spawn("git", input.args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"]
   });
   const stdoutChunks: Buffer[] = [];
   const stderrChunks: Buffer[] = [];

   child.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
   });
   child.stderr.on("data", (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
   });

   const result = await new Promise<{
      code: number | null;
      signal: string | null;
   }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => {
         resolve({ code, signal });
      });
   }).catch((error: unknown) => {
      throw new UserError(
         `Failed to run git while installing a skill: ${error instanceof Error ? error.message : String(error)}`
      );
   });

   if (result.code === 0) {
      return;
   }

   const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
   const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
   const detail = stderr.length > 0 ? stderr : stdout;

   throw new UserError(
      `Git clone failed while reading the default branch: ${detail.length > 0 ? detail : (result.signal ?? "unknown git error")}`
   );
}

async function resolveSourceDirectory(
   projectPaths: ProjectPaths,
   input: InstallSkillInput
): Promise<ResolvedSkillSource> {
   const localSourceRoot = path.resolve(
      projectPaths.projectRoot,
      input.sourcePath
   );
   const localSourceStats = await readDirectoryStats(localSourceRoot);

   if (localSourceStats?.isDirectory() === true) {
      const directory = await resolveLocalSkillDirectory(
         localSourceRoot,
         input.repositorySubpath
      );

      return {
         directory,
         fallbackName: validateSkillName(path.basename(directory))
      };
   }

   if (!isGitSource(input.sourcePath)) {
      throw new UserError(`Skill source was not found: ${localSourceRoot}`);
   }

   const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-skill-"));
   const cloneDirectory = path.join(temporaryRoot, "repo");

   try {
      await runGitCommand({
         args: [
            "clone",
            "--depth",
            "1",
            "--single-branch",
            input.sourcePath,
            cloneDirectory
         ]
      });

      const directory = await resolveSkillDirectoryFromRoot(
         cloneDirectory,
         input.repositorySubpath
      );
      const omitGitMetadata =
         path.resolve(directory) === path.resolve(cloneDirectory);

      return {
         cleanup: async () => {
            await rm(temporaryRoot, { force: true, recursive: true }).catch(
               () => {}
            );
         },
         directory,
         fallbackName: omitGitMetadata
            ? getGitSourceBaseName(input.sourcePath)
            : validateSkillName(path.basename(directory)),
         ...(omitGitMetadata ? { omitGitMetadata: true } : {})
      };
   } catch (error) {
      await rm(temporaryRoot, { force: true, recursive: true }).catch(() => {});
      throw error;
   }
}

async function copyInstalledSkill(input: {
   omitGitMetadata?: boolean;
   sourceDirectory: string;
   targetDirectory: string;
}): Promise<void> {
   if (input.omitGitMetadata !== true) {
      await cp(input.sourceDirectory, input.targetDirectory, {
         recursive: true
      });
      return;
   }

   await mkdir(input.targetDirectory, { recursive: true });
   const entries = await readdir(input.sourceDirectory, {
      withFileTypes: true
   });

   for (const entry of entries) {
      if (entry.name === ".git") {
         continue;
      }

      await cp(
         path.join(input.sourceDirectory, entry.name),
         path.join(input.targetDirectory, entry.name),
         { recursive: true }
      );
   }
}

export async function installSkill(
   projectPaths: ProjectPaths,
   input: InstallSkillInput
): Promise<SkillDefinition> {
   const resolvedSource = await resolveSourceDirectory(projectPaths, input);

   try {
      const sourceDirectory = resolvedSource.directory;
      const sourceSkillPath = path.join(sourceDirectory, "SKILL.md");
      const markdown = await readFile(sourceSkillPath, "utf8").catch(
         (error: unknown) => {
            if (hasErrorCode(error, "ENOENT")) {
               throw new UserError(
                  `Skill source is missing SKILL.md: ${sourceDirectory}`
               );
            }

            throw error;
         }
      );
      const skillName = getInstalledSkillName(
         markdown,
         resolvedSource.fallbackName
      );
      const targetDirectory = path.join(
         getSkillsDirectoryForScope(projectPaths, input.scope),
         skillName
      );
      const targetSkillPath = path.join(targetDirectory, "SKILL.md");

      if (path.resolve(sourceDirectory) === path.resolve(targetDirectory)) {
         throw new UserError(
            `Skill "${skillName}" is already installed at ${targetDirectory}.`
         );
      }

      const existingTarget = await stat(targetDirectory).catch(
         (error: unknown) => {
            if (hasErrorCode(error, "ENOENT")) {
               return undefined;
            }

            throw error;
         }
      );

      if (existingTarget !== undefined && input.force !== true) {
         throw new UserError(
            `A ${input.scope}-scope skill named "${skillName}" already exists at ${targetDirectory}. Use --force to replace it.`
         );
      }

      await ensureSkillScopeDirectory(projectPaths, input.scope);

      if (existingTarget !== undefined) {
         await rm(targetDirectory, { force: true, recursive: true });
      }

      await copyInstalledSkill({
         ...(resolvedSource.omitGitMetadata === true
            ? { omitGitMetadata: true }
            : {}),
         sourceDirectory,
         targetDirectory
      });

      return readSkillDefinition({
         filePath: targetSkillPath,
         name: skillName,
         scope: input.scope
      });
   } finally {
      if (resolvedSource.cleanup !== undefined) {
         await resolvedSource.cleanup();
      }
   }
}
