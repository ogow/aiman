export type StyledLineTone =
   | "accent"
   | "brand"
   | "dim"
   | "error"
   | "selected"
   | "success"
   | "warning";

export type StyledLine = {
   style?: StyledLineTone;
   text: string;
};

export function clamp(value: number, min: number, max: number): number {
   return Math.max(min, Math.min(max, value));
}

export function truncateText(value: string, width: number): string {
   if (width <= 0) {
      return "";
   }

   if (value.length <= width) {
      return value;
   }

   if (width === 1) {
      return value[0] ?? "";
   }

   return `${value.slice(0, width - 1)}…`;
}

export function padText(value: string, width: number): string {
   return truncateText(value, width).padEnd(width);
}

export function centerText(value: string, width: number): string {
   if (width <= 0) return "";
   if (value.length >= width) return truncateText(value, width);
   const leftPad = Math.floor((width - value.length) / 2);
   return " ".repeat(leftPad) + value;
}

function splitWrappedLine(
   value: string,
   width: number
): {
   current: string;
   rest: string;
} {
   if (width <= 0) {
      return {
         current: "",
         rest: value
      };
   }

   if (value.length <= width) {
      return {
         current: value,
         rest: ""
      };
   }

   const slice = value.slice(0, width + 1);
   const splitIndex = slice.lastIndexOf(" ");
   const breakIndex = splitIndex > Math.floor(width / 2) ? splitIndex : width;

   return {
      current: value.slice(0, breakIndex).trimEnd(),
      rest: value.slice(breakIndex).trimStart()
   };
}

export function wrapLine(value: string, width: number): string[] {
   if (width <= 0) {
      return [""];
   }

   if (value.length === 0) {
      return [""];
   }

   const lines: string[] = [];
   let remaining = value;

   while (remaining.length > width) {
      const wrapped = splitWrappedLine(remaining, width);
      lines.push(wrapped.current);
      remaining = wrapped.rest;
   }

   lines.push(remaining);
   return lines;
}

export function wrapText(text: string, width: number): StyledLine[] {
   return text.split("\n").flatMap((line) =>
      wrapLine(line, width).map((wrapped) => ({
         text: wrapped
      }))
   );
}

export function wrapPrefixedLine(
   value: string,
   width: number,
   prefix: string,
   continuationPrefix = " ".repeat(prefix.length)
): string[] {
   const safeWidth = Math.max(1, width);
   const safePrefix = truncateText(prefix, safeWidth);
   const safeContinuationPrefix = truncateText(continuationPrefix, safeWidth);
   const firstLineWidth = Math.max(1, safeWidth - safePrefix.length);
   const continuationWidth = Math.max(
      1,
      safeWidth - safeContinuationPrefix.length
   );
   const lines: string[] = [];

   if (value.length === 0) {
      return [safePrefix.trimEnd()];
   }

   let remaining = value;
   let activePrefix = safePrefix;
   let activeWidth = firstLineWidth;

   while (remaining.length > 0) {
      const wrapped = splitWrappedLine(remaining, activeWidth);
      lines.push(`${activePrefix}${wrapped.current}`);

      if (wrapped.rest.length === 0) {
         break;
      }

      remaining = wrapped.rest;
      activePrefix = safeContinuationPrefix;
      activeWidth = continuationWidth;
   }

   return lines;
}

export function renderMarkdownLines(text: string, width: number): StyledLine[] {
   const lines: StyledLine[] = [];
   let inCodeFence = false;

   for (const rawLine of text.split("\n")) {
      const fenceMatch = rawLine.match(/^```([\w-]+)?\s*$/);
      if (fenceMatch !== null) {
         if (!inCodeFence && typeof fenceMatch[1] === "string") {
            lines.push({
               style: "dim",
               text: `[${fenceMatch[1]}]`
            });
         }

         inCodeFence = !inCodeFence;
         continue;
      }

      if (inCodeFence) {
         lines.push(
            ...wrapPrefixedLine(rawLine, width, "  ").map((line) => ({
               text: line
            }))
         );
         continue;
      }

      const headingMatch = rawLine.match(/^(#{1,6})\s+(.*)$/);
      if (headingMatch !== null) {
         lines.push(
            ...wrapLine(headingMatch[2] ?? "", width).map(
               (line): StyledLine => ({
                  style: "accent",
                  text: line
               })
            )
         );
         continue;
      }

      const orderedListMatch = rawLine.match(/^(\d+)\.\s+(.*)$/);
      if (orderedListMatch !== null) {
         lines.push(
            ...wrapPrefixedLine(
               orderedListMatch[2] ?? "",
               width,
               `${orderedListMatch[1]}. `
            ).map((line) => ({
               text: line
            }))
         );
         continue;
      }

      const bulletListMatch = rawLine.match(/^[-*+]\s+(.*)$/);
      if (bulletListMatch !== null) {
         lines.push(
            ...wrapPrefixedLine(bulletListMatch[1] ?? "", width, "• ").map(
               (line) => ({
                  text: line
               })
            )
         );
         continue;
      }

      const quoteMatch = rawLine.match(/^>\s?(.*)$/);
      if (quoteMatch !== null) {
         lines.push(
            ...wrapPrefixedLine(quoteMatch[1] ?? "", width, "| ").map(
               (line): StyledLine => ({
                  style: "dim",
                  text: line
               })
            )
         );
         continue;
      }

      if (/^([-*_])(?:\s*\1){2,}\s*$/.test(rawLine.trim())) {
         lines.push({
            style: "dim",
            text: "─".repeat(Math.max(1, width))
         });
         continue;
      }

      lines.push(...wrapText(rawLine, width));
   }

   return lines;
}

export function renderPaneHeading(title: string, width: number): string {
   if (width <= 0) {
      return "";
   }

   const baseTitle = ` ${title} `;

   if (baseTitle.length >= width) {
      return truncateText(baseTitle.trim(), width);
   }

   return `${baseTitle}${"─".repeat(width - baseTitle.length)}`;
}

export function renderSeparator(width: number): string {
   return "─".repeat(Math.max(0, width));
}

export function getScrollWindow(
   lineCount: number,
   viewportHeight: number,
   offset: number
): {
   maxOffset: number;
   offset: number;
} {
   const safeViewportHeight = Math.max(1, Math.floor(viewportHeight));
   const maxOffset = Math.max(0, lineCount - safeViewportHeight);

   return {
      maxOffset,
      offset: clamp(Math.floor(offset), 0, maxOffset)
   };
}
