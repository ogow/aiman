import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AgentRegistry } from "../src/lib/agent-registry.js";
import { AgentConfigError, ValidationError } from "../src/lib/errors.js";

test("AgentRegistry merges home and project agents with project precedence", async () => {
   const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "agent-workspace-")
   );
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const registry = new AgentRegistry({ workspaceDir, homeDir });
   await registry.init();

   await registry.createAgent(
      {
         name: "frontend",
         provider: "codex",
         model: "gpt-5.4-mini",
         systemPrompt: "Review frontend code."
      },
      { scope: "home" }
   );

   await registry.createAgent(
      {
         name: "frontend",
         provider: "codex",
         model: "gpt-5.4",
         reasoningEffort: "high",
         systemPrompt: "Review the project frontend code."
      },
      { scope: "project" }
   );

   await registry.createAgent(
      {
         name: "research",
         provider: "claude",
         model: "claude-sonnet-4.5",
         systemPrompt: "Research the issue."
      },
      { scope: "home" }
   );

   const agents = await registry.listVisibleAgents();
   const frontend = await registry.getVisibleAgent("frontend");

   assert.equal(agents.length, 2);
   assert.ok(frontend);
   assert.equal(frontend.source, "project");
   assert.equal(frontend.model, "gpt-5.4");
   assert.equal(frontend.reasoningEffort, "high");
   assert.ok(agents.some((agent) => agent.name === "research"));
});

test("AgentRegistry writes new agents as markdown with frontmatter", async () => {
   const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "agent-workspace-")
   );
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const registry = new AgentRegistry({ workspaceDir, homeDir });
   await registry.init();

   const agent = await registry.createAgent(
      {
         name: "reviewer",
         provider: "codex",
         model: "gpt-5.4",
         reasoningEffort: "medium",
         description: "Reviews code changes",
         systemPrompt: "Review the diff and call out risks."
      },
      { scope: "project" }
   );

   const raw = await readFile(agent.path, "utf8");

   assert.match(agent.path, /\.md$/);
   assert.match(raw, /^---\n/);
   assert.match(raw, /name: reviewer/);
   assert.match(raw, /provider: codex/);
   assert.match(raw, /reasoningEffort: medium/);
   assert.match(raw, /Review the diff and call out risks\./);
});

test("AgentRegistry rejects malformed markdown frontmatter", async () => {
   const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "agent-workspace-")
   );
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const registry = new AgentRegistry({ workspaceDir, homeDir });
   await registry.init();

   const agentPath = path.join(homeDir, "agents", "broken.md");
   await writeFile(
      agentPath,
      "---\nname: broken\nprovider: [oops\n---\nPrompt body.\n",
      "utf8"
   );

   await assert.rejects(
      () => registry.listVisibleAgents(),
      (error) => {
         assert.ok(error instanceof AgentConfigError);
         assert.match(error.message, /broken\.md/);
         return true;
      }
   );
});

test("AgentRegistry rejects unknown frontmatter keys", async () => {
   const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "agent-workspace-")
   );
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const registry = new AgentRegistry({ workspaceDir, homeDir });
   await registry.init();

   const agentPath = path.join(homeDir, "agents", "unknown-key.md");
   await writeFile(
      agentPath,
      "---\nname: review\nprovider: codex\ntools:\n  - Read\n---\nPrompt body.\n",
      "utf8"
   );

   await assert.rejects(
      () => registry.listVisibleAgents(),
      (error) => {
         assert.ok(error instanceof AgentConfigError);
         assert.match(error.message, /Unrecognized key|unknown/i);
         return true;
      }
   );
});

test("AgentRegistry rejects missing required frontmatter fields", async () => {
   const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "agent-workspace-")
   );
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const registry = new AgentRegistry({ workspaceDir, homeDir });
   await registry.init();

   const agentPath = path.join(homeDir, "agents", "missing-provider.md");
   await writeFile(agentPath, "---\nname: review\n---\nPrompt body.\n", "utf8");

   await assert.rejects(
      () => registry.listVisibleAgents(),
      (error) => {
         assert.ok(error instanceof AgentConfigError);
         assert.match(error.message, /provider/i);
         return true;
      }
   );
});

test("AgentRegistry rejects empty prompt bodies", async () => {
   const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "agent-workspace-")
   );
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const registry = new AgentRegistry({ workspaceDir, homeDir });
   await registry.init();

   const agentPath = path.join(homeDir, "agents", "empty-body.md");
   await writeFile(
      agentPath,
      "---\nname: review\nprovider: codex\n---\n",
      "utf8"
   );

   await assert.rejects(
      () => registry.listVisibleAgents(),
      (error) => {
         assert.ok(error instanceof AgentConfigError);
         assert.match(error.message, /prompt body/i);
         return true;
      }
   );
});

test("AgentRegistry rejects reasoningEffort for unsupported providers", async () => {
   const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "agent-workspace-")
   );
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const registry = new AgentRegistry({ workspaceDir, homeDir });
   await registry.init();

   await assert.rejects(
      () =>
         registry.createAgent(
            {
               name: "claude-reviewer",
               provider: "claude",
               reasoningEffort: "high",
               systemPrompt: "Review the code."
            },
            { scope: "project" }
         ),
      (error) => {
         assert.ok(error instanceof ValidationError);
         assert.match(error.message, /not supported/i);
         return true;
      }
   );
});

test("AgentRegistry rejects reasoningEffort values unsupported by the selected model", async () => {
   const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "agent-workspace-")
   );
   const homeDir = await mkdtemp(path.join(os.tmpdir(), "agent-home-"));
   const registry = new AgentRegistry({ workspaceDir, homeDir });
   await registry.init();

   await assert.rejects(
      () =>
         registry.createAgent(
            {
               name: "mini-reviewer",
               provider: "codex",
               model: "gpt-5.1-codex-mini",
               reasoningEffort: "low",
               systemPrompt: "Review the change."
            },
            { scope: "project" }
         ),
      (error) => {
         assert.ok(error instanceof ValidationError);
         assert.match(error.message, /gpt-5\.1-codex-mini/);
         return true;
      }
   );
});
