import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parsePositiveInteger,
  readStdinText,
  requireSinglePositional,
  resolveTextInput
} from "../src/lib/cli/input.js";
import { ValidationError } from "../src/lib/errors.js";

test("parsePositiveInteger accepts positive integers", () => {
  assert.equal(parsePositiveInteger("42", "--limit"), 42);
  assert.equal(parsePositiveInteger(undefined, "--limit"), undefined);
});

test("parsePositiveInteger rejects non-positive values", () => {
  assert.throws(() => parsePositiveInteger("0", "--limit"), ValidationError);
  assert.throws(() => parsePositiveInteger("-1", "--limit"), ValidationError);
  assert.throws(() => parsePositiveInteger("abc", "--limit"), ValidationError);
});

test("requireSinglePositional returns the only positional value", () => {
  assert.equal(requireSinglePositional(["run-123"], "run get"), "run-123");
});

test("requireSinglePositional rejects zero or many positional values", () => {
  assert.throws(() => requireSinglePositional([], "run get"), ValidationError);
  assert.throws(
    () => requireSinglePositional(["one", "two"], "run get"),
    ValidationError
  );
});

test("resolveTextInput accepts inline, file, and stdin sources", async () => {
  const workspaceDir = await mkdtemp(
    path.join(os.tmpdir(), "aiman-cli-input-")
  );
  const filePath = path.join(workspaceDir, "prompt.md");
  await writeFile(filePath, "Prompt from file.\n", "utf8");

  assert.equal(
    await resolveTextInput({
      value: "Prompt inline",
      stdinText: "",
      cwd: workspaceDir,
      label: "prompt",
      valueFlag: "--prompt",
      fileFlag: "--prompt-file"
    }),
    "Prompt inline"
  );

  assert.equal(
    await resolveTextInput({
      filePath: "prompt.md",
      stdinText: "",
      cwd: workspaceDir,
      label: "prompt",
      valueFlag: "--prompt",
      fileFlag: "--prompt-file"
    }),
    "Prompt from file."
  );

  assert.equal(
    await resolveTextInput({
      stdinText: "Prompt from stdin\n",
      cwd: workspaceDir,
      label: "prompt",
      valueFlag: "--prompt",
      fileFlag: "--prompt-file"
    }),
    "Prompt from stdin"
  );
});

test("resolveTextInput rejects conflicting or empty sources", async () => {
  const workspaceDir = await mkdtemp(
    path.join(os.tmpdir(), "aiman-cli-input-")
  );
  const emptyFilePath = path.join(workspaceDir, "empty.md");
  await writeFile(emptyFilePath, "\n", "utf8");

  await assert.rejects(
    () =>
      resolveTextInput({
        value: "Inline",
        stdinText: "From stdin",
        cwd: workspaceDir,
        label: "prompt",
        valueFlag: "--prompt",
        fileFlag: "--prompt-file"
      }),
    ValidationError
  );

  await assert.rejects(
    () =>
      resolveTextInput({
        filePath: "empty.md",
        stdinText: "",
        cwd: workspaceDir,
        label: "prompt",
        valueFlag: "--prompt",
        fileFlag: "--prompt-file"
      }),
    ValidationError
  );

  await assert.rejects(
    () =>
      resolveTextInput({
        stdinText: "",
        cwd: workspaceDir,
        label: "prompt",
        valueFlag: "--prompt",
        fileFlag: "--prompt-file"
      }),
    ValidationError
  );
});

test("readStdinText trims piped input", async () => {
  const chunks = ["  hello", " world \n"];
  const stdin = {
    isTTY: false,
    setEncoding() {},
    async *[Symbol.asyncIterator]() {
      yield* chunks;
    }
  };

  assert.equal(await readStdinText(stdin), "hello world");
});
