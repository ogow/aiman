import type { ProviderId, RunStatus } from "../lib/types.js";

type ActivityEntry = {
   label: string;
   text: string;
};

type StreamContent = {
   stderr: string;
   stdout: string;
};

const activityLabelWidth = 10;

function toRecord(value: unknown): Record<string, unknown> | undefined {
   return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
}

function getStringProperty(
   record: Record<string, unknown> | undefined,
   key: string
): string | undefined {
   const value = record?.[key];
   return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
}

function extractText(value: unknown): string {
   if (typeof value === "string") {
      return value.trim();
   }

   if (Array.isArray(value)) {
      return value
         .map((entry) => extractText(entry))
         .filter((entry) => entry.length > 0)
         .join("\n")
         .trim();
   }

   const record = toRecord(value);
   if (record === undefined) {
      return "";
   }

   return [
      extractText(record["content"]),
      extractText(record["text"]),
      extractText(record["summary"]),
      extractText(record["message"])
   ]
      .filter((entry) => entry.length > 0)
      .join("\n")
      .trim();
}

function splitNonEmptyLines(content: string): string[] {
   return content
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.trim().length > 0);
}

function humanizeEventType(value: string): string {
   const normalized = value.replace(/[._]+/g, " ").trim().toLowerCase();
   return normalized.length > 0
      ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
      : "Event";
}

function findToolName(record: Record<string, unknown>): string | undefined {
   for (const key of [
      "name",
      "toolName",
      "tool_name",
      "callName",
      "call_name"
   ]) {
      const value = getStringProperty(record, key);
      if (value !== undefined) {
         return value;
      }
   }

   for (const key of ["tool", "toolCall", "tool_call"]) {
      const nested = toRecord(record[key]);
      if (nested !== undefined) {
         const nestedName = findToolName(nested);
         if (nestedName !== undefined) {
            return nestedName;
         }
      }
   }

   return undefined;
}

function renderEntry(entry: ActivityEntry): string {
   const prefix = entry.label.padEnd(activityLabelWidth, " ");
   const continuation = " ".repeat(activityLabelWidth);
   const lines = entry.text.trim().split("\n");

   return lines
      .map((line, index) => `${index === 0 ? prefix : continuation}${line}`)
      .join("\n");
}

function renderRawEntries(label: string, content: string): ActivityEntry[] {
   return splitNonEmptyLines(content).map((line) => ({
      label,
      text: line
   }));
}

function summarizeCodexEvent(value: unknown): ActivityEntry[] {
   const event = toRecord(value);
   if (event === undefined) {
      return [];
   }

   const eventType = getStringProperty(event, "type");
   const message = toRecord(event["message"]);
   const role = getStringProperty(message, "role");
   const messageText = extractText(message?.["content"]);

   if (role === "assistant" && messageText.length > 0) {
      return [{ label: "assistant", text: messageText }];
   }

   const toolName = findToolName(event);
   const eventText = [
      extractText(event["text"]),
      extractText(event["summary"]),
      extractText(event["content"])
   ]
      .filter((entry) => entry.length > 0)
      .join("\n")
      .trim();

   if ((eventType?.includes("tool") ?? false) || toolName !== undefined) {
      const title = toolName ?? humanizeEventType(eventType ?? "tool");
      return [
         {
            label: "tool",
            text: eventText.length > 0 ? `${title}: ${eventText}` : title
         }
      ];
   }

   const errorRecord = toRecord(event["error"]);
   const errorText =
      getStringProperty(errorRecord, "message") ??
      (eventType?.includes("error") === true
         ? extractText(event["message"])
         : "");

   if (typeof errorText === "string" && errorText.length > 0) {
      return [{ label: "error", text: errorText }];
   }

   if (eventText.length > 0) {
      return [
         {
            label: eventType?.includes("reason") === true ? "reason" : "event",
            text:
               eventType !== undefined
                  ? `${humanizeEventType(eventType)}: ${eventText}`
                  : eventText
         }
      ];
   }

   if (eventType !== undefined) {
      return [{ label: "event", text: humanizeEventType(eventType) }];
   }

   return [];
}

function parseCodexStdout(stdout: string): ActivityEntry[] {
   const entries: ActivityEntry[] = [];

   for (const line of splitNonEmptyLines(stdout)) {
      try {
         entries.push(...summarizeCodexEvent(JSON.parse(line) as unknown));
      } catch {
         entries.push({ label: "stdout", text: line });
      }
   }

   return entries;
}

function formatParameters(params: unknown): string {
   if (typeof params !== "object" || params === null) {
      return String(params);
   }
   const entries = Object.entries(params as Record<string, unknown>);
   if (entries.length === 0) return "";
   return entries
      .map(
         ([k, v]) =>
            `${k}: ${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`
      )
      .join(", ");
}

function parseGeminiStdout(stdout: string): ActivityEntry[] {
   const entries: ActivityEntry[] = [];
   let assistantText = "";

   const flushAssistant = () => {
      const trimmed = assistantText.trim();
      if (trimmed.length > 0) {
         entries.push({ label: "assistant", text: trimmed });
         assistantText = "";
      }
   };

   for (const line of splitNonEmptyLines(stdout)) {
      try {
         const payload = JSON.parse(line) as Record<string, unknown>;
         let handled = false;

         if (payload["type"] === "message" && payload["role"] === "assistant") {
            const content = payload["content"];
            if (typeof content === "string") {
               if (payload["delta"] === true) {
                  assistantText += content;
               } else {
                  flushAssistant();
                  assistantText = content;
               }
               handled = true;
            }
         }

         if (!handled) {
            flushAssistant();

            if (payload["type"] === "tool_use") {
               const toolName =
                  getStringProperty(payload, "tool_name") ?? "tool";
               const parameters = payload["parameters"];
               const paramString = formatParameters(parameters);
               entries.push({
                  label: "tool",
                  text:
                     paramString.length > 0
                        ? `${toolName}(${paramString})`
                        : toolName
               });
               handled = true;
            } else if (payload["type"] === "tool_result") {
               const status = getStringProperty(payload, "status") ?? "success";
               const output = extractText(payload["output"]);
               const summary =
                  output.length > 120
                     ? `${output.slice(0, 120).replace(/\n/g, " ")}...`
                     : output.replace(/\n/g, " ");
               entries.push({
                  label: "result",
                  text:
                     summary.length > 0
                        ? `[${status}] ${summary}`
                        : `[${status}]`
               });
               handled = true;
            } else if (payload["type"] === "error") {
               const error = toRecord(payload["error"]);
               const message =
                  getStringProperty(error, "message") ??
                  getStringProperty(payload, "message") ??
                  "Unknown error";
               entries.push({ label: "error", text: message });
               handled = true;
            } else if (
               payload["type"] === "init" ||
               (payload["type"] === "message" && payload["role"] === "user")
            ) {
               // Silent in activity view (metadata)
               handled = true;
            }
         }

         // If it's JSON but not one of our handled types, we omit it from Activity (it's in Raw)
         if (!handled) {
            // Check if it's one of the known noise lines from Gemini CLI
            const isNoise =
               line.startsWith("YOLO mode") ||
               line.startsWith("Prompt with name") ||
               line.startsWith("Tool with name");

            if (!isNoise && !line.startsWith("{")) {
               entries.push({ label: "stdout", text: line });
            }
         }
      } catch {
         // Not JSON
         flushAssistant();
         const isNoise =
            line.startsWith("YOLO mode") ||
            line.startsWith("Prompt with name") ||
            line.startsWith("Tool with name");

         if (!isNoise) {
            entries.push({ label: "stdout", text: line });
         }
      }
   }

   flushAssistant();

   return entries;
}

function buildActivityEntries(input: {
   provider: ProviderId;
   stderr: string;
   stdout: string;
}): ActivityEntry[] {
   const providerEntries =
      input.provider === "codex"
         ? parseCodexStdout(input.stdout)
         : parseGeminiStdout(input.stdout);

   return [...providerEntries, ...renderRawEntries("stderr", input.stderr)];
}

export function renderOutputSections(input: StreamContent): string {
   const sections: string[] = [];

   if (input.stdout.trim().length > 0) {
      sections.push(`Stdout\n\n${input.stdout.trimEnd()}`);
   }

   if (input.stderr.trim().length > 0) {
      sections.push(`Stderr\n\n${input.stderr.trimEnd()}`);
   }

   return sections.join("\n\n");
}

export function renderRunActivity(input: {
   provider: ProviderId;
   status: RunStatus;
   stderr: string;
   stdout: string;
}): string {
   const entries = buildActivityEntries(input);

   if (entries.length === 0) {
      return input.status === "running"
         ? "Waiting for provider activity…"
         : "No provider activity was recorded.";
   }

   return entries.map((entry) => renderEntry(entry)).join("\n");
}
