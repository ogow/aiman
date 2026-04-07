import { formatDuration } from "../lib/pretty.js";

const activityWidth = 10;

function clampFrameIndex(frameIndex: number): number {
   return Number.isFinite(frameIndex) ? Math.max(0, Math.floor(frameIndex)) : 0;
}

export function renderActivityBar(frameIndex: number): string {
   const activeIndex = clampFrameIndex(frameIndex) % activityWidth;

   return Array.from({ length: activityWidth }, (_, index) =>
      index === activeIndex ? "=" : "-"
   ).join("");
}

export function renderActivityLine(input: {
   agent: string;
   frameIndex: number;
   runId: string;
   startedAt: string;
}): string {
   const elapsedMs = Math.max(0, Date.now() - Date.parse(input.startedAt));
   const elapsed = formatDuration(elapsedMs);

   return `Working [${renderActivityBar(input.frameIndex)}] ${elapsed}  ${input.agent}  ${input.runId}`;
}

export function createActivityRenderer(input: {
   agent: string;
   runId: string;
   startedAt: string;
   stream?: NodeJS.WriteStream;
   tickMs?: number;
}): { start(): void; stop(): void } {
   const stream = input.stream ?? process.stderr;
   const tickMs = input.tickMs ?? 120;
   let interval: NodeJS.Timeout | undefined;
   let frameIndex = 0;

   const render = () => {
      stream.write(
         `\r\x1b[2K${renderActivityLine({
            agent: input.agent,
            frameIndex,
            runId: input.runId,
            startedAt: input.startedAt
         })}`
      );
      frameIndex += 1;
   };

   return {
      start() {
         render();
         interval = setInterval(render, tickMs);
      },
      stop() {
         if (interval) {
            clearInterval(interval);
            interval = undefined;
         }

         stream.write("\r\x1b[2K");
      }
   };
}
