import { expect, test } from "bun:test";

import {
   renderOutputSections,
   renderRunActivity
} from "../src/tui/run-activity.js";

test("renderRunActivity formats codex json events into a readable timeline", () => {
   const output = renderRunActivity({
      provider: "codex",
      status: "running",
      stderr: "warming cache\n",
      stdout: [
         JSON.stringify({ type: "turn.started" }),
         JSON.stringify({
            name: "bash",
            text: "ls src",
            type: "tool.started"
         }),
         JSON.stringify({
            message: {
               content: "Inspecting the repository layout.",
               role: "assistant"
            },
            type: "turn.completed"
         })
      ].join("\n")
   });

   expect(output).toContain("event");
   expect(output).toContain("Turn started");
   expect(output).toContain("tool");
   expect(output).toContain("bash: ls src");
   expect(output).toContain("assistant");
   expect(output).toContain("Inspecting the repository layout.");
   expect(output).toContain("stderr");
   expect(output).toContain("warming cache");
});

test("renderRunActivity and renderOutputSections preserve gemini response and raw streams", () => {
   const activity = renderRunActivity({
      provider: "gemini",
      status: "success",
      stderr: "",
      stdout: JSON.stringify({
         content: "Finished the task.",
         role: "assistant",
         type: "message"
      })
   });
   const raw = renderOutputSections({
      stderr: "provider note\n",
      stdout: "plain stdout\n"
   });

   expect(activity).toContain("assistant");
   expect(activity).toContain("Finished the task.");
   expect(raw).toContain("Stdout");
   expect(raw).toContain("plain stdout");
   expect(raw).toContain("Stderr");
   expect(raw).toContain("provider note");
});
