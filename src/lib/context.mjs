import { readFile, stat } from "node:fs/promises";
import path from "node:path";

async function readOptionalText(filePath) {
  try {
    await stat(filePath);
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function assemblePrompt({ rootDir, workspace, agent, taskPrompt }) {
  const sections = [];
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
