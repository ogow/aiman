import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Agent } from "./types.js";

async function readOptionalText(filePath: string): Promise<string | null> {
   try {
      await stat(filePath);
      return await readFile(filePath, "utf8");
   } catch {
      return null;
   }
}

export async function assemblePrompt({
   rootDir,
   workspace,
   agent,
   taskPrompt
}: {
   rootDir: string;
   workspace: string;
   agent: Pick<Agent, "systemPrompt">;
   taskPrompt: string;
}): Promise<string> {
   const sections: string[] = [];
   const candidateAgentsFiles = [
      path.join(workspace, "AGENTS.md"),
      path.join(rootDir, "AGENTS.md")
   ];

   for (const candidate of candidateAgentsFiles) {
      const content = await readOptionalText(candidate);

      if (content) {
         sections.push(`# Repository Rules\n${content.trim()}`);
         break;
      }
   }

   if (agent.systemPrompt) {
      sections.push(`# Agent Role\n${agent.systemPrompt.trim()}`);
   }

   sections.push(`# Task\n${taskPrompt.trim()}`);

   return sections.join("\n\n");
}
