import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { readMarkdownDocument } from "../src/lib/run-doc.js";

test("readMarkdownDocument parses YAML frontmatter and resolves artifacts", async () => {
   const runDir = await mkdtemp(path.join(os.tmpdir(), "aiman-report-"));
   const artifactsDir = path.join(runDir, "artifacts");
   const reportPath = path.join(runDir, "report.md");

   await mkdir(artifactsDir, { recursive: true });
   await writeFile(path.join(artifactsDir, "trace.zip"), "trace", "utf8");
   await writeFile(
      reportPath,
      `---
kind: playwright-exploration
status: success
summary: Explored checkout flow
artifacts:
  - kind: playwright-trace
    label: checkout trace
    path: trace.zip
findings:
  - title: Coupon modal blocks submit
    severity: warning
    detail: Submit button stays disabled until modal is dismissed
metadata:
  route: /checkout
---
# Checkout Exploration

Report body.
`,
      "utf8"
   );

   const report = await readMarkdownDocument(reportPath, artifactsDir);

   assert.equal(report.exists, true);
   assert.equal(report.parseError, undefined);
   assert.equal(report.frontmatter?.kind, "playwright-exploration");
   assert.deepEqual(report.frontmatter?.metadata, {
      route: "/checkout"
   });
   assert.equal(report.artifacts.length, 1);
   assert.deepEqual(report.artifacts[0], {
      exists: true,
      kind: "playwright-trace",
      label: "checkout trace",
      path: "trace.zip",
      resolvedPath: path.join(artifactsDir, "trace.zip")
   });
   assert.match(report.body ?? "", /Report body/);
});

test("readMarkdownDocument surfaces malformed frontmatter without throwing", async () => {
   const runDir = await mkdtemp(path.join(os.tmpdir(), "aiman-report-bad-"));
   const artifactsDir = path.join(runDir, "artifacts");
   const reportPath = path.join(runDir, "report.md");

   await mkdir(artifactsDir, { recursive: true });
   await writeFile(
      reportPath,
      `---
kind: [unterminated
---
broken
`,
      "utf8"
   );

   const report = await readMarkdownDocument(reportPath, artifactsDir);

   assert.equal(report.exists, true);
   assert.match(
      report.parseError ?? "",
      /unexpected end of the stream|end of the stream|missed comma between flow collection entries/i
   );
   assert.deepEqual(report.artifacts, []);
});
