import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import * as assert from "node:assert/strict";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { getProjectPaths } from "../src/lib/paths.js";

function useFixture(input: { cwd: string; homeRoot: string }): () => void {
   const originalCwd = process.cwd();
   const originalHome = process.env.HOME;
   const originalUserProfile = process.env.USERPROFILE;

   process.chdir(input.cwd);
   process.env.HOME = input.homeRoot;
   process.env.USERPROFILE = input.homeRoot;

   return () => {
      process.chdir(originalCwd);

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
   };
}

test("getProjectPaths keeps agents under .aiman", async () => {
   const homeRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-home-root-"));
   const projectRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-project-"));
   await mkdir(path.join(projectRoot, ".aiman"), { recursive: true });

   const restore = useFixture({ cwd: projectRoot, homeRoot });

   try {
      const projectPaths = getProjectPaths();

      assert.equal(projectPaths.projectRoot, projectRoot);
      assert.equal(
         projectPaths.projectProfilesDir,
         path.join(projectRoot, ".aiman", "agents")
      );
      assert.equal(
         projectPaths.userProfilesDir,
         path.join(homeRoot, ".aiman", "agents")
      );
   } finally {
      restore();
   }
});

test("getProjectPaths does not treat home-level user dirs as a project root", async () => {
   const homeRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-home-root-"));
   const nestedCwd = path.join(homeRoot, "scratch", "demo");
   await mkdir(path.join(homeRoot, ".aiman", "agents"), { recursive: true });
   await mkdir(nestedCwd, { recursive: true });

   const restore = useFixture({ cwd: nestedCwd, homeRoot });

   try {
      const projectPaths = getProjectPaths();

      assert.equal(projectPaths.projectRoot, nestedCwd);
      assert.equal(
         projectPaths.projectProfilesDir,
         path.join(nestedCwd, ".aiman", "agents")
      );
      assert.equal(
         projectPaths.userProfilesDir,
         path.join(homeRoot, ".aiman", "agents")
      );
   } finally {
      restore();
   }
});

test("getProjectPaths ignores AGENTS.md alone as a project marker", async () => {
   const homeRoot = await mkdtemp(path.join(os.tmpdir(), "aiman-home-root-"));
   const agentsOnlyRoot = await mkdtemp(
      path.join(os.tmpdir(), "aiman-project-")
   );
   const nestedCwd = path.join(agentsOnlyRoot, "packages", "cli");

   await mkdir(nestedCwd, { recursive: true });
   await writeFile(path.join(agentsOnlyRoot, "AGENTS.md"), "# notes\n", "utf8");

   const restore = useFixture({ cwd: nestedCwd, homeRoot });

   try {
      const projectPaths = getProjectPaths();
      assert.equal(projectPaths.projectRoot, nestedCwd);
   } finally {
      restore();
   }
});
