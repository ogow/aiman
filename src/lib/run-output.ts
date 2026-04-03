import { UserError } from "./errors.js";
import { readRunDetails, readRunLog } from "./runs.js";
import type { RunInspection } from "./types.js";

export type RunOutputStream = "all" | "stderr" | "stdout";

function sleep(durationMs: number): Promise<void> {
   return new Promise((resolve) => {
      setTimeout(resolve, durationMs);
   });
}

function tailContent(content: string, lineCount: number): string {
   const trimmed = content.trimEnd();
   const safeLineCount = Math.max(0, Math.floor(lineCount));

   if (trimmed.length === 0 || safeLineCount === 0) {
      return "";
   }

   const lines = trimmed.split("\n");
   return lines.slice(-safeLineCount).join("\n");
}

function prefixChunk(prefix: string, content: string): string {
   return content
      .split("\n")
      .map((line, index, lines) => {
         if (line.length === 0 && index === lines.length - 1) {
            return "";
         }

         return `${prefix}${line}`;
      })
      .join("\n");
}

async function readOptionalRunLog(
   runId: string,
   stream: "stderr" | "stdout"
): Promise<string> {
   try {
      return await readRunLog(runId, stream);
   } catch (error) {
      if (
         error instanceof UserError &&
         error.message === `No ${stream} log exists for run "${runId}".`
      ) {
         return "";
      }

      throw error;
   }
}

function renderCombinedOutput(input: {
   stderr: string;
   stdout: string;
}): string {
   const sections: string[] = [];

   if (input.stdout.length > 0) {
      sections.push(`Stdout\n\n${input.stdout}`);
   }

   if (input.stderr.length > 0) {
      sections.push(`Stderr\n\n${input.stderr}`);
   }

   return sections.join("\n\n");
}

export async function readRunOutput(
   runId: string,
   stream: RunOutputStream,
   lineCount: number
): Promise<string> {
   if (stream === "stdout" || stream === "stderr") {
      return tailContent(await readOptionalRunLog(runId, stream), lineCount);
   }

   const [stdout, stderr] = await Promise.all([
      readOptionalRunLog(runId, "stdout"),
      readOptionalRunLog(runId, "stderr")
   ]);

   return renderCombinedOutput({
      stderr: tailContent(stderr, lineCount),
      stdout: tailContent(stdout, lineCount)
   });
}

function renderInitialFollowOutput(input: {
   stderr: string;
   stdout: string;
   stream: RunOutputStream;
   tailLines: number;
}): string {
   if (input.stream === "stdout" || input.stream === "stderr") {
      const content = input.stream === "stdout" ? input.stdout : input.stderr;
      const tail = tailContent(content, input.tailLines);

      return tail.length > 0 ? `${tail}\n` : "";
   }

   const stdoutTail = tailContent(input.stdout, input.tailLines);
   const stderrTail = tailContent(input.stderr, input.tailLines);
   const combined = renderCombinedOutput({
      stderr: stderrTail,
      stdout: stdoutTail
   });

   return combined.length > 0 ? `${combined}\n\n` : "";
}

function renderFollowChunk(input: {
   stderrChunk: string;
   stdoutChunk: string;
   stream: RunOutputStream;
}): string {
   if (input.stream === "stdout") {
      return input.stdoutChunk;
   }

   if (input.stream === "stderr") {
      return input.stderrChunk;
   }

   return [
      input.stdoutChunk.length > 0
         ? prefixChunk("[stdout] ", input.stdoutChunk)
         : "",
      input.stderrChunk.length > 0
         ? prefixChunk("[stderr] ", input.stderrChunk)
         : ""
   ]
      .filter((chunk) => chunk.length > 0)
      .join("");
}

export async function followRunOutput(input: {
   onChunk: (chunk: string) => void;
   pollIntervalMs?: number;
   runId: string;
   stream: RunOutputStream;
   tailLines?: number;
}): Promise<RunInspection> {
   const pollIntervalMs = input.pollIntervalMs ?? 250;
   const tailLines = input.tailLines ?? 40;
   let stdout = await readOptionalRunLog(input.runId, "stdout");
   let stderr = await readOptionalRunLog(input.runId, "stderr");

   const initial = renderInitialFollowOutput({
      stderr,
      stdout,
      stream: input.stream,
      tailLines
   });

   if (initial.length > 0) {
      input.onChunk(initial);
   }

   let stdoutLength = stdout.length;
   let stderrLength = stderr.length;

   while (true) {
      const run = await readRunDetails(input.runId);
      const [nextStdout, nextStderr] = await Promise.all([
         readOptionalRunLog(input.runId, "stdout"),
         readOptionalRunLog(input.runId, "stderr")
      ]);

      if (nextStdout.length < stdoutLength) {
         stdoutLength = 0;
      }

      if (nextStderr.length < stderrLength) {
         stderrLength = 0;
      }

      const stdoutChunk = nextStdout.slice(stdoutLength);
      const stderrChunk = nextStderr.slice(stderrLength);
      const chunk = renderFollowChunk({
         stderrChunk,
         stdoutChunk,
         stream: input.stream
      });

      if (chunk.length > 0) {
         input.onChunk(chunk);
      }

      stdout = nextStdout;
      stderr = nextStderr;
      stdoutLength = stdout.length;
      stderrLength = stderr.length;

      if (!run.active && stdoutChunk.length === 0 && stderrChunk.length === 0) {
         return run;
      }

      await sleep(pollIntervalMs);
   }
}
