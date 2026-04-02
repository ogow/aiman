import type { ReactNode } from "react";

import { Alert, Badge, StatusMessage } from "@inkjs/ui";
import { Box, Text } from "ink";

import {
   getScrollWindow,
   type StyledLine,
   type StyledLineTone
} from "./text.js";

const aimanWordmark = [
   String.raw`   ___   ___ __  __   _   _`,
   String.raw`  / _ | / _ \  \/  | /_\ | |`,
   String.raw` /_/ |_|/_/ /_|\__/ /_/ \_\_|`
];

const hotkeyWrapWidth = 35;

type HeaderHotkey = {
   key: string;
   label: string;
};

function getHotkeyCellWidth(hotkey: HeaderHotkey): number {
   return hotkey.key.length + hotkey.label.length + 1;
}

function wrapHotkeys(hotkeys: HeaderHotkey[]): HeaderHotkey[][] {
   const rows: HeaderHotkey[][] = [];
   let currentRow: HeaderHotkey[] = [];
   let currentWidth = 0;

   for (const hotkey of hotkeys) {
      const cellWidth = getHotkeyCellWidth(hotkey);
      const nextWidth =
         currentRow.length === 0 ? cellWidth : currentWidth + 2 + cellWidth;

      if (currentRow.length > 0 && nextWidth > hotkeyWrapWidth) {
         rows.push(currentRow);
         currentRow = [hotkey];
         currentWidth = cellWidth;
         continue;
      }

      currentRow.push(hotkey);
      currentWidth = nextWidth;
   }

   if (currentRow.length > 0) {
      rows.push(currentRow);
   }

   return rows;
}

export function toneToVariant(
   tone: StyledLineTone | undefined
): "error" | "info" | "success" | "warning" {
   switch (tone) {
      case "error":
         return "error";
      case "success":
         return "success";
      case "warning":
         return "warning";
      default:
         return "info";
   }
}

export function StatusBadge(input: {
   label: string;
   tone: StyledLineTone | undefined;
}): React.JSX.Element {
   const color =
      input.tone === "error"
         ? "red"
         : input.tone === "success"
           ? "green"
           : input.tone === "warning"
             ? "yellow"
             : "cyan";

   return <Badge color={color}>{input.label}</Badge>;
}

export function NoticeBanner(input: {
   tone: StyledLineTone | undefined;
   children: ReactNode;
}): React.JSX.Element {
   const variant = toneToVariant(input.tone);
   return <Alert title="Notice" variant={variant}>{input.children}</Alert>;
}

export function InlineNotice(input: {
   tone: StyledLineTone | undefined;
   children: ReactNode;
}): React.JSX.Element {
   const variant = toneToVariant(input.tone);
   return <StatusMessage variant={variant}>{input.children}</StatusMessage>;
}

function StyledLineText(input: {
   line: StyledLine;
}): React.JSX.Element {
   switch (input.line.style) {
      case "accent":
         return (
            <Text bold color="cyan">
               {input.line.text}
            </Text>
         );
      case "brand":
         return (
            <Text bold color="yellow">
               {input.line.text}
            </Text>
         );
      case "dim":
         return <Text dimColor>{input.line.text}</Text>;
      case "error":
         return <Text color="red">{input.line.text}</Text>;
      case "selected":
         return (
            <Box backgroundColor="cyan" width="100%">
               <Text bold color="black">
                  {input.line.text}
               </Text>
            </Box>
         );
      case "success":
         return <Text color="green">{input.line.text}</Text>;
      case "warning":
         return <Text color="yellow">{input.line.text}</Text>;
      default:
         return <Text>{input.line.text}</Text>;
   }
}

export function StyledLinesPane(input: {
   emptyText?: string;
   height: number;
   isFocused?: boolean;
   lines: StyledLine[];
   noBorder?: boolean;
   offset?: number;
   title?: string;
   width: number;
}): React.JSX.Element {
   const noBorder = input.noBorder ?? true;
   const contentLines =
      input.lines.length === 0
         ? [
              {
                 style: "dim" as const,
                 text: input.emptyText ?? "Nothing to show."
              }
           ]
         : input.lines;

   const viewportHeight = Math.max(1, input.height - (noBorder ? 2 : 4));
   const viewport = getScrollWindow(
      contentLines.length,
      viewportHeight,
      input.offset ?? 0
   );
   const visibleLines = contentLines.slice(
      viewport.offset,
      viewport.offset + viewportHeight
   );

   return (
      <Box
         borderColor={input.isFocused === true ? "cyan" : "gray"}
         borderStyle={noBorder ? undefined : "round"}
         flexDirection="column"
         height={input.height}
         paddingX={noBorder ? 0 : 1}
         width={input.width}
      >
         {typeof input.title === "string" ? (
            <Box marginTop={noBorder ? 0 : -1} marginBottom={noBorder ? 1 : 0}>
               <Text bold color={input.isFocused === true ? "cyan" : "gray"}>
                  {noBorder ? input.title.toUpperCase() : ` ${input.title.toUpperCase()} `}
               </Text>
            </Box>
         ) : undefined}
         <Box flexDirection="column" flexGrow={1} marginY={noBorder ? 0 : 1}>
            {visibleLines.map((line, index) => (
               <StyledLineText
                  key={`line-${viewport.offset + index}`}
                  line={line}
               />
            ))}
         </Box>
      </Box>
   );
}

export function AppHeader(props: {
   hotkeys: { key: string; label: string }[];
   version?: string;
   legendHint?: string;
}): React.JSX.Element {
   const hotkeyRows = wrapHotkeys(props.hotkeys);

   return (
      <Box flexDirection="row" marginBottom={1} paddingX={1} gap={2}>
         <Box flexDirection="column" width={32}>
            {aimanWordmark.map((line) => (
               <Text key={line} bold color="yellow">
                  {line}
               </Text>
            ))}
            {typeof props.version === "string" ? (
               <Box>
                  <Text dimColor>{props.version}</Text>
               </Box>
            ) : undefined}
         </Box>
         <Box flexDirection="column" flexGrow={1}>
            {hotkeyRows.map((row, index) => (
               <Box key={`row-${index}`} flexDirection="row">
                  {row.map((hotkey, hotkeyIndex) => (
                     <Box
                        key={`${hotkey.key}-${hotkey.label}`}
                        marginRight={hotkeyIndex === row.length - 1 ? 0 : 2}
                     >
                        <Text bold color="cyan">
                           {hotkey.key}
                        </Text>
                        <Text>{` ${hotkey.label}`}</Text>
                     </Box>
                  ))}
               </Box>
            ))}
            {typeof props.legendHint === "string" ? (
               <Box marginTop={1}>
                  <Text dimColor>{props.legendHint}</Text>
               </Box>
            ) : undefined}
         </Box>
      </Box>
   );
}

export function Breadcrumbs(props: {
   items: string[];
}): React.JSX.Element {
   return (
      <Box paddingX={1} marginBottom={1} gap={1}>
         <Box borderStyle="single" borderColor="gray" paddingX={1}>
            {props.items.map((item, i) => (
               <Box key={i} gap={1}>
                  {i > 0 ? <Text dimColor>/</Text> : undefined}
                  <Text color={i === props.items.length - 1 ? "white" : "cyan"} bold={i === props.items.length - 1}>
                     {item}
                  </Text>
               </Box>
            ))}
         </Box>
      </Box>
   );
}

export function AppStatusLine(props: {
   message: string | undefined;
   tone: StyledLineTone | undefined;
}): React.JSX.Element {
   if (!props.message) return <Box height={1} />;

   const color =
      props.tone === "error"
         ? "red"
         : props.tone === "success"
           ? "green"
           : props.tone === "warning"
             ? "yellow"
             : "cyan";

   return (
      <Box paddingX={1} paddingY={0}>
         <Text bold color={color}>
            ●
         </Text>
         <Text> {props.message}</Text>
      </Box>
   );
}

export function HotkeyFooter(input: { text: string }): React.JSX.Element {
   return (
      <Box paddingX={1}>
         <Text dimColor>{input.text}</Text>
      </Box>
   );
}

export function AppLayout(props: {
   children: ReactNode;
   footer?: ReactNode;
   header: ReactNode;
   notice?: ReactNode;
}): React.JSX.Element {
   return (
      <Box flexDirection="column" height="100%" paddingX={0} paddingTop={0} paddingBottom={0}>
         <Box marginTop={0} paddingX={0}>{props.header}</Box>
         {props.notice}
         <Box flexDirection="column" flexGrow={1} marginX={1}>
            {props.children}
         </Box>
         {props.footer}
      </Box>
   );
}
