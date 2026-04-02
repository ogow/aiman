import { constants } from "node:fs";
import { access } from "node:fs/promises";
import * as path from "node:path";

type ResolveExecutableOptions = {
   comspecValue?: string;
   pathExtValue?: string;
   pathValue?: string;
   platform?: NodeJS.Platform;
};

export type ResolvedCommandLaunch = {
   args: string[];
   command: string;
   needsShell: boolean;
   usesCommandProcessor: boolean;
   windowsVerbatimArguments: boolean;
};

const defaultWindowsPathExtensions = [".com", ".exe", ".bat", ".cmd"];
const windowsShellMetaChars = /([()\][%!^"`<>&|;, *?])/g;
const npmCmdShimPattern = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

function getExecutableSearchCandidates(
   command: string,
   options?: ResolveExecutableOptions
): string[] {
   const platform = options?.platform ?? process.platform;

   if (
      platform !== "win32" ||
      path.extname(command).length > 0 ||
      command.includes("/") ||
      command.includes("\\")
   ) {
      return [command];
   }

   const rawExtensions =
      options?.pathExtValue ?? process.env.PATHEXT ?? undefined;
   const extensions =
      typeof rawExtensions === "string" && rawExtensions.length > 0
         ? rawExtensions
              .split(";")
              .map((extension) => extension.trim().toLowerCase())
              .filter((extension) => extension.length > 0)
         : defaultWindowsPathExtensions;

   return [...extensions.map((extension) => `${command}${extension}`), command];
}

function getExecutableAccessMode(platform: NodeJS.Platform): number {
   return platform === "win32" ? constants.F_OK : constants.X_OK;
}

function usesPathLookup(command: string): boolean {
   return (
      !path.isAbsolute(command) &&
      !command.includes("/") &&
      !command.includes("\\")
   );
}

export async function resolveExecutable(
   command: string,
   options?: ResolveExecutableOptions
): Promise<string | undefined> {
   const platform = options?.platform ?? process.platform;
   const pathValue = options?.pathValue ?? process.env.PATH;
   const candidates = getExecutableSearchCandidates(command, options);
   const accessMode = getExecutableAccessMode(platform);

   if (!usesPathLookup(command)) {
      for (const candidate of candidates) {
         try {
            await access(candidate, accessMode);
            return candidate;
         } catch {}
      }

      return undefined;
   }

   if (typeof pathValue !== "string" || pathValue.length === 0) {
      return undefined;
   }

   for (const segment of pathValue.split(path.delimiter)) {
      for (const candidate of candidates) {
         try {
            const candidatePath = path.join(segment, candidate);
            await access(candidatePath, accessMode);
            return candidatePath;
         } catch {}
      }
   }

   return undefined;
}

function shouldUseShellForExecutable(
   command: string,
   platform: NodeJS.Platform
): boolean {
   return platform === "win32" && /\.(bat|cmd)$/i.test(command);
}

function escapeWindowsCommand(command: string): string {
   return command.replace(windowsShellMetaChars, "^$1");
}

function escapeWindowsArgument(
   value: string,
   doubleEscapeMetaChars: boolean
): string {
   let escapedValue = `${value}`;

   escapedValue = escapedValue.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
   escapedValue = escapedValue.replace(/(?=(\\+?)?)\1$/g, "$1$1");
   escapedValue = `"${escapedValue}"`;
   escapedValue = escapedValue.replace(windowsShellMetaChars, "^$1");

   if (doubleEscapeMetaChars) {
      escapedValue = escapedValue.replace(windowsShellMetaChars, "^$1");
   }

   return escapedValue;
}

function createWindowsCommandProcessorLaunch(
   command: string,
   args: string[],
   options?: ResolveExecutableOptions
): ResolvedCommandLaunch {
   const comspec =
      options?.comspecValue ??
      process.env.comspec ??
      process.env.COMSPEC ??
      "cmd.exe";
   const normalizedCommand = path.normalize(command);
   const doubleEscapeMetaChars = npmCmdShimPattern.test(normalizedCommand);
   const commandLine = `"${[
      escapeWindowsCommand(normalizedCommand),
      ...args.map((arg) => escapeWindowsArgument(arg, doubleEscapeMetaChars))
   ].join(" ")}"`;

   return {
      args: ["/d", "/s", "/c", commandLine],
      command: comspec,
      needsShell: false,
      usesCommandProcessor: true,
      windowsVerbatimArguments: true
   };
}

export async function resolveCommandLaunch(
   command: string,
   args: string[],
   options?: ResolveExecutableOptions
): Promise<ResolvedCommandLaunch> {
   const platform = options?.platform ?? process.platform;
   const resolvedCommand = await resolveExecutable(command, options);
   const launchCommand = resolvedCommand ?? command;

   if (shouldUseShellForExecutable(launchCommand, platform)) {
      return createWindowsCommandProcessorLaunch(launchCommand, args, options);
   }

   return {
      args: [...args],
      command: launchCommand,
      needsShell: false,
      usesCommandProcessor: false,
      windowsVerbatimArguments: false
   };
}
