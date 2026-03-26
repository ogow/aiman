import test from "node:test";
import assert from "node:assert/strict";

import { ValidationError } from "../src/lib/errors.js";
import {
  formatCommandResult,
  getExitCode,
  renderError
} from "../src/lib/cli/output.js";
import type { CliIO, ReadableInput } from "../src/lib/types.js";

function createIo(): CliIO & {
  stdout: { chunks: string[]; write(text: string): void };
  stderr: { chunks: string[]; write(text: string): void };
} {
  return {
    stdin: {
      isTTY: true,
      setEncoding() {},
      async *[Symbol.asyncIterator]() {}
    } as ReadableInput,
    stdout: {
      chunks: [] as string[],
      write(text: string) {
        this.chunks.push(text);
      }
    },
    stderr: {
      chunks: [] as string[],
      write(text: string) {
        this.chunks.push(text);
      }
    }
  };
}

test("formatCommandResult renders empty and non-empty lists for humans", () => {
  assert.equal(
    formatCommandResult("agent:list", { agents: [] }),
    "No agents found."
  );
  assert.equal(formatCommandResult("run:list", { runs: [] }), "No runs found.");

  assert.match(
    formatCommandResult("agent:list", {
      agents: [
        {
          name: "reviewer",
          provider: "codex",
          source: "project",
          model: "gpt-5.4"
        }
      ]
    }),
    /reviewer {2}codex {2}project {2}gpt-5\.4/
  );

  assert.match(
    formatCommandResult("run:list", {
      runs: [
        {
          id: "run-1",
          status: "completed",
          agentName: "reviewer",
          provider: "codex"
        }
      ]
    }),
    /run-1 {2}completed {2}reviewer {2}codex/
  );
});

test("renderError writes JSON errors when requested", () => {
  const io = createIo();
  renderError(io, {
    json: true,
    error: new ValidationError("Bad input.")
  });

  const payload = JSON.parse(io.stdout.chunks.join(""));
  assert.equal(payload.error.code, "validation_error");
  assert.equal(io.stderr.chunks.length, 0);
});

test("getExitCode maps internal and expected errors separately", () => {
  assert.equal(getExitCode(new ValidationError("Bad input.")), 2);
  assert.equal(getExitCode(new Error("Boom")), 1);
});
