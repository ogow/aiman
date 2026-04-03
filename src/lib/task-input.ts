import { UserError } from "./errors.js";

async function readStdin(): Promise<string> {
   if (process.stdin.isTTY) {
      return "";
   }

   const chunks: Buffer[] = [];

   for await (const chunk of process.stdin) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
   }

   return Buffer.concat(chunks).toString("utf8").trim();
}

export async function readTaskInput(taskOption?: string): Promise<string> {
   const stdinTask = await readStdin();
   const optionTask = taskOption?.trim() ?? "";

   if (optionTask.length > 0 && stdinTask.length > 0) {
      throw new UserError("Provide task input with --task or stdin, not both.");
   }

   const task = optionTask.length > 0 ? optionTask : stdinTask;

   if (task.length === 0) {
      throw new UserError("Provide task input with --task or stdin.");
   }

   return task;
}
