The core of our discussion centered on transitioning from manual coding to Agent Orchestration using local CLIs (Gemini, Codex, Claude Code) to leverage your existing subscriptions. We explored using a Main Agent (Supervisor) to delegate tasks to Sub-Agents (Specialists) while maintaining state through a local Harness. You specifically requested a way to maintain determinism, handle project-specific tasks, and ensure observability without the high cost of cloud-only platforms.

The Best Path: The Modular MCP Harness
The most effective approach for your needs is a Local MCP-based Orchestrator. This setup offers the best balance of cost-efficiency, interoperability, and future scalability.

Universal Integration: By using MCP (Model Context Protocol), your management tool becomes a "universal plug." You only write the orchestration logic once, and any CLI agent (Gemini, Codex, etc.) can instantly use it to spawn and monitor specialists.

Provider Agnostic: It treats vendor CLIs as disposable compute nodes. You send a task to a CLI, it executes in a sandbox, and the results are merged back into your central state.

Modular State: Using a Provider Pattern allows you to start with simple, human-readable files (PLANS.md) for visibility and switch to a SQLite database when you need better concurrency and audit logs.

Narrow Context: This prevents "context rot" by feeding each sub-agent only the specific task documentation (SKILL.md) and the current project rules (AGENTS.md), rather than your entire history.

Why this wins in 2026
Traditional "CLI wrapping" is brittle and expensive because you often over-feed context to the model. An MCP-first architecture uses "progressive disclosure," only giving agents the tools and data they need at the moment they need them. This keeps your token usage low and your agent's success rate high.

Would you like me to generate the file structure for your StateProvider so you can test the handoff between a Gemini research task and a Codex coding task

To build this orchestrator in March 2026, you need to implement a Dependency Injection pattern. This allows your "Main Agent" to interact with a stable interface while you swap the underlying storage from a flat file (PLANS.md) to a database (SQLite) without rewriting your tool logic.

1. The Core Interface: StateProvider
This is the "Contract" that defines how your orchestrator talks to its memory. Whether it's a Markdown parser or a SQL client, it must fulfill these methods.

TypeScript
// state-provider.interface.ts
export interface Task {
  id: string;
  agent: 'gemini' | 'codex' | 'claude';
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  timestamp: number;
}

export interface StateProvider {
  getTasks(): Promise<Task[]>;
  updateTask(id: string, update: Partial<Task>): Promise<void>;
  logAudit(agent: string, rawOutput: string): Promise<void>;
}
2. The Implementation Logic
You will start with the FileStateProvider. It uses a regex-based parser to read your PLANS.md as a live data structure.

File Provider: Reads PLANS.md, converts Markdown checkboxes ([ ] or [x]) into the Task object, and writes them back.

Database Migration: When you’re ready for SQLite, you simply create a SQLiteStateProvider that implements the same interface using a library like better-sqlite3.

3. The Orchestration Tool (delegate_task)
This is the "Logic Layer" that your Main Agent triggers via MCP. It handles the specific CLI flags and the environment isolation.

TypeScript
// dispatcher.ts
import { spawn } from 'child_process';

export class AgentDispatcher {
  constructor(private state: StateProvider) {}

  async execute(agent: string, task: Task) {
    // 1. Mark task as 'running' in the state
    await this.state.updateTask(task.id, { status: 'running' });

    // 2. Construct the CLI command (e.g., codex exec "task")
    // We use 'stdio: pipe' to capture logs for the "View"
    const child = spawn(agent, ['exec', task.description], {
      shell: true,
      env: { ...process.env, AGENT_ID: task.id }
    });

    child.stdout.on('data', (data) => {
      this.state.logAudit(agent, data.toString());
    });

    child.on('close', async (code) => {
      const finalStatus = code === 0 ? 'completed' : 'failed';
      await this.state.updateTask(task.id, { status: finalStatus });
    });
  }
}
4. Deterministic "Takeaways" for 2026
Context Injection: Your tool should look for an AGENTS.md file in the current directory. Before calling the CLI, it should prepend the content of AGENTS.md to the prompt. This ensures the sub-agent knows the "Rules of the House."

Handoff via "Pulse": Use a standard JSON block at the top of your PLANS.md called AGENT_STATE. This allows Agent B to "rehydrate" its memory by reading the specific variables exported by Agent A.

The TUI Hook: For the "View," your MCP server should emit JSONL logs to a hidden folder (.aiman/traces/). You can then use a simple tail -f command or a dedicated TUI like Ralph to monitor the "Pulse" of all active agents.

Next Step
Would you like me to generate the package.json and the index.ts file for a basic Node.js MCP server using these technical specs?
