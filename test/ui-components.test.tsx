import * as assert from "node:assert/strict";
import { test } from "node:test";

import { render } from "ink-testing-library";

import {
   buildHomeHeroLines,
   getGlobalViewHotkey
} from "../src/ui/aiman-app.js";
import { AppHeader, StyledLinesPane } from "../src/ui/components.js";
import { renderTopMarkdown } from "../src/cmd/top.js";

test("StyledLinesPane renders a heading and respects scroll offset", () => {
   const view = render(
      <StyledLinesPane
         height={4}
         lines={[
            { text: "first line" },
            { text: "second line" },
            { text: "third line" }
         ]}
         offset={1}
         title="Demo"
         width={20}
      />
   );

   const frame = view.lastFrame() ?? "";
   view.unmount();

   assert.match(frame, /DEMO/);
   assert.doesNotMatch(frame, /first line/);
   assert.match(frame, /second line/);
});

test("renderTopMarkdown keeps headings and list items readable", () => {
   const lines = renderTopMarkdown("# Title\n- alpha\n1. beta", 20);

   assert.deepEqual(
      lines.map((line) => ({
         style: line.style ?? "plain",
         text: line.text
      })),
      [
         { style: "accent", text: "Title" },
         { style: "plain", text: "• alpha" },
         { style: "plain", text: "1. beta" }
      ]
   );
});

test("AppHeader keeps hotkeys aligned without collapsing key labels", () => {
   const view = render(
      <AppHeader
         hotkeys={[
            { key: "g", label: "home" },
            { key: "a", label: "agents" },
            { key: "enter", label: "open" },
            { key: "esc", label: "back" }
         ]}
         version="v0.1.0"
      />
   );

   const frame = view.lastFrame() ?? "";
   view.unmount();

   assert.ok(!frame.startsWith("\n"));
   assert.match(frame, /g\s+home/);
   assert.match(frame, /enter\s+open/);
   assert.doesNotMatch(frame, /enteropen/);
   assert.doesNotMatch(frame, /PROJECT/);
   assert.doesNotMatch(frame, /KEYS/);
   assert.doesNotMatch(frame, /Letters switch views/);
});

test("AppHeader wraps hotkeys onto a new row after 35 columns", () => {
   const view = render(
      <AppHeader
         hotkeys={[
            { key: "g", label: "home" },
            { key: "a", label: "agents" },
            { key: "t", label: "task" },
            { key: "r", label: "runs" },
            { key: "q", label: "exit" },
            { key: "esc", label: "back" }
         ]}
         version="v0.1.0"
      />
   );

   const frame = view.lastFrame() ?? "";
   view.unmount();

   assert.match(frame, /g home\s+a agents\s+t task\s+r runs/);
   assert.match(frame, /r runs\n\s+.*q exit\s+esc back/);
});

test("main app global navigation uses letters instead of numbers", () => {
   assert.deepEqual(getGlobalViewHotkey("g"), { view: "home" });
   assert.deepEqual(getGlobalViewHotkey("a"), {
      focus: "profile",
      view: "agents"
   });
   assert.deepEqual(getGlobalViewHotkey("t"), {
      focus: "task",
      view: "agents"
   });
   assert.deepEqual(getGlobalViewHotkey("r"), { view: "history" });
   assert.equal(getGlobalViewHotkey("1"), undefined);
   assert.equal(getGlobalViewHotkey("2"), undefined);
   assert.equal(getGlobalViewHotkey("3"), undefined);
});

test("buildHomeHeroLines renders the branded home screen actions", () => {
   const texts = buildHomeHeroLines({
      contentHeight: 16,
      hasAgentsMd: true,
      projectTitle: "demo repo",
      totalAgents: 3,
      totalSkills: 7,
      width: 80
   }).map((line) => line.text.trim());

   assert.ok(texts.includes("agent workbench for focused local runs"));
   assert.ok(texts.includes("PROJECT  demo repo"));
   assert.ok(texts.includes("AGENTS   3   SKILLS   7"));
   assert.ok(texts.includes("CONTEXT  AGENTS.md loaded"));
   assert.ok(!texts.includes("FLEET METRICS"));
   assert.ok(!texts.some((text) => text.includes("___ __  __")));
   assert.ok(!texts.includes("[a] choose agent   [t] write task"));
   assert.ok(!texts.includes("[r] browse runs    [q] quit"));
   assert.notEqual(texts[0], "");
});
