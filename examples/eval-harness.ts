#!/usr/bin/env bun

import { readFile } from "node:fs/promises";

import chalk from "chalk";

import { createAiman } from "../src/index.js";

type EvalCase = {
   expect?: {
      finalTextIncludes?: string[];
      outcome?: string;
      status?: "cancelled" | "error" | "success";
      structuredResultHasKeys?: string[];
      summaryIncludes?: string[];
   };
   name: string;
   task: string;
};

function usage(): never {
   console.log(
      "Usage: bun run examples/eval-harness.ts <agent> <suite.json> [project-root]"
   );
   process.exit(1);
}

function ensureStringArray(
   value: unknown,
   label: string,
   caseName: string
): string[] | undefined {
   if (value === undefined) {
      return undefined;
   }

   if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
      throw new Error(
         `Eval case "${caseName}" has invalid ${label}. Use an array of strings.`
      );
   }

   return value.length > 0 ? value : undefined;
}

function parseSuite(rawText: string): EvalCase[] {
   const parsed = JSON.parse(rawText) as unknown;

   if (!Array.isArray(parsed)) {
      throw new Error("Eval suite must be a JSON array.");
   }

   return parsed.map((entry, index) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
         throw new Error(`Eval case at index ${index} must be an object.`);
      }

      const record = entry as Record<string, unknown>;
      const caseName =
         typeof record.name === "string" && record.name.trim().length > 0
            ? record.name.trim()
            : `case-${index + 1}`;

      if (typeof record.task !== "string" || record.task.trim().length === 0) {
         throw new Error(`Eval case "${caseName}" is missing a task.`);
      }

      const expect =
         typeof record.expect === "object" &&
         record.expect !== null &&
         !Array.isArray(record.expect)
            ? (record.expect as Record<string, unknown>)
            : undefined;

      const expectedStatus = expect?.status;

      if (
         expectedStatus !== undefined &&
         expectedStatus !== "cancelled" &&
         expectedStatus !== "error" &&
         expectedStatus !== "success"
      ) {
         throw new Error(
            `Eval case "${caseName}" has invalid expect.status "${String(expectedStatus)}".`
         );
      }

      const normalizedExpect =
         expect === undefined
            ? undefined
            : {
                 ...(typeof expectedStatus === "string"
                    ? { status: expectedStatus }
                    : {}),
                 ...(typeof expect.outcome === "string"
                    ? { outcome: expect.outcome }
                    : {}),
                 ...(ensureStringArray(
                    expect.summaryIncludes,
                    "expect.summaryIncludes",
                    caseName
                 ) !== undefined
                    ? {
                         summaryIncludes: ensureStringArray(
                            expect.summaryIncludes,
                            "expect.summaryIncludes",
                            caseName
                         )
                      }
                    : {}),
                 ...(ensureStringArray(
                    expect.finalTextIncludes,
                    "expect.finalTextIncludes",
                    caseName
                 ) !== undefined
                    ? {
                         finalTextIncludes: ensureStringArray(
                            expect.finalTextIncludes,
                            "expect.finalTextIncludes",
                            caseName
                         )
                      }
                    : {}),
                 ...(ensureStringArray(
                    expect.structuredResultHasKeys,
                    "expect.structuredResultHasKeys",
                    caseName
                 ) !== undefined
                    ? {
                         structuredResultHasKeys: ensureStringArray(
                            expect.structuredResultHasKeys,
                            "expect.structuredResultHasKeys",
                            caseName
                         )
                      }
                    : {})
              };

      return {
         ...(normalizedExpect !== undefined ? { expect: normalizedExpect } : {}),
         name: caseName,
         task: record.task.trim()
      };
   });
}

function checkIncludes(
   haystack: string | undefined,
   needles: string[] | undefined
): string[] {
   if (needles === undefined) {
      return [];
   }

   return needles.filter((needle) => !(haystack ?? "").includes(needle));
}

function checkStructuredKeys(
   value: unknown,
   requiredKeys: string[] | undefined
): string[] {
   if (requiredKeys === undefined) {
      return [];
   }

   if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return requiredKeys;
   }

   return requiredKeys.filter((key) => !(key in value));
}

async function main() {
   const [agentName, suitePath, projectRoot] = process.argv.slice(2);

   if (
      typeof agentName !== "string" ||
      agentName.length === 0 ||
      typeof suitePath !== "string" ||
      suitePath.length === 0
   ) {
      usage();
   }

   const suite = parseSuite(await readFile(suitePath, "utf8"));
   const aiman = await createAiman(
      typeof projectRoot === "string" && projectRoot.length > 0
         ? { projectRoot }
         : {}
   );
   let passed = 0;

   console.log(
      chalk.blue(
         `Running ${suite.length} eval case${suite.length === 1 ? "" : "s"} for agent "${agentName}"...`
      )
   );

   for (const testCase of suite) {
      const result = await aiman.runs.run(agentName, { task: testCase.task });
      const failures: string[] = [];

      if (
         testCase.expect?.status !== undefined &&
         result.status !== testCase.expect.status
      ) {
         failures.push(
            `expected status ${testCase.expect.status}, got ${result.status}`
         );
      }

      if (
         testCase.expect?.outcome !== undefined &&
         result.outcome !== testCase.expect.outcome
      ) {
         failures.push(
            `expected outcome ${testCase.expect.outcome}, got ${result.outcome ?? "missing"}`
         );
      }

      const missingSummary = checkIncludes(
         result.summary,
         testCase.expect?.summaryIncludes
      );

      if (missingSummary.length > 0) {
         failures.push(
            `summary missing ${missingSummary.map((value) => JSON.stringify(value)).join(", ")}`
         );
      }

      const missingFinalText = checkIncludes(
         result.finalText,
         testCase.expect?.finalTextIncludes
      );

      if (missingFinalText.length > 0) {
         failures.push(
            `finalText missing ${missingFinalText.map((value) => JSON.stringify(value)).join(", ")}`
         );
      }

      const missingStructuredKeys = checkStructuredKeys(
         result.structuredResult,
         testCase.expect?.structuredResultHasKeys
      );

      if (missingStructuredKeys.length > 0) {
         failures.push(
            `structuredResult missing keys ${missingStructuredKeys.join(", ")}`
         );
      }

      if (failures.length === 0) {
         passed += 1;
         console.log(chalk.green(`PASS  ${testCase.name}`));
         continue;
      }

      console.log(chalk.red(`FAIL  ${testCase.name}`));
      console.log(chalk.dim(`  Task: ${testCase.task}`));

      for (const failure of failures) {
         console.log(chalk.red(`  - ${failure}`));
      }

      if (typeof result.summary === "string" && result.summary.length > 0) {
         console.log(chalk.dim(`  Summary: ${result.summary}`));
      }
   }

   console.log(
      `\n${passed}/${suite.length} case${suite.length === 1 ? "" : "s"} passed.`
   );

   if (passed !== suite.length) {
      process.exit(1);
   }
}

main().catch((error) => {
   console.error(error instanceof Error ? error.message : String(error));
   process.exit(1);
});
