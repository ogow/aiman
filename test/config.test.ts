import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { loadAimanConfig } from "../src/lib/config.js";
import { getProjectPaths } from "../src/lib/paths.js";

test("loadAimanConfig leaves contextFileNames unset when no config exists", async () => {
   const homeRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-config-home-"));
   const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "aiman-config-project-")
   );
   await mkdir(path.join(projectRoot, ".aiman"), { recursive: true });

   const originalHome = process.env.HOME;
   const originalUserProfile = process.env.USERPROFILE;

   process.env.HOME = homeRoot;
   process.env.USERPROFILE = homeRoot;

   try {
      const config = await loadAimanConfig(getProjectPaths(projectRoot));
      assert.equal(config.contextFileNames, undefined);
   } finally {
      if (originalHome === undefined) {
         delete process.env.HOME;
      } else {
         process.env.HOME = originalHome;
      }

      if (originalUserProfile === undefined) {
         delete process.env.USERPROFILE;
      } else {
         process.env.USERPROFILE = originalUserProfile;
      }
   }
});

test("loadAimanConfig lets project config override home config", async () => {
   const homeRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-config-home-"));
   const projectRoot = await mkdtemp(
      path.join(os.tmpdir(), "aiman-config-project-")
   );
   await mkdir(path.join(homeRoot, ".aiman"), { recursive: true });
   await mkdir(path.join(projectRoot, ".aiman"), { recursive: true });
   await writeFile(
      path.join(homeRoot, ".aiman", "config.json"),
      JSON.stringify({ contextFileNames: ["AGENTS.md", "HOME.md"] }, null, 2),
      "utf8"
   );
   await writeFile(
      path.join(projectRoot, ".aiman", "config.json"),
      JSON.stringify(
         { contextFileNames: ["AGENTS.md", "CONTEXT.md"] },
         null,
         2
      ),
      "utf8"
   );

   const originalHome = process.env.HOME;
   const originalUserProfile = process.env.USERPROFILE;

   process.env.HOME = homeRoot;
   process.env.USERPROFILE = homeRoot;

   try {
      const config = await loadAimanConfig(getProjectPaths(projectRoot));
      assert.deepEqual(config.contextFileNames, ["AGENTS.md", "CONTEXT.md"]);
   } finally {
      if (originalHome === undefined) {
         delete process.env.HOME;
      } else {
         process.env.HOME = originalHome;
      }

      if (originalUserProfile === undefined) {
         delete process.env.USERPROFILE;
      } else {
         process.env.USERPROFILE = originalUserProfile;
      }
   }
});
