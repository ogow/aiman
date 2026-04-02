type LabelValue = {
   label: string;
   value: string;
};

export function truncateText(value: string, maxLength: number): string {
   if (value.length <= maxLength) {
      return value;
   }

   if (maxLength <= 3) {
      return ".".repeat(Math.max(0, maxLength));
   }

   return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}

function padCells(cells: string[], widths: number[]): string {
   return cells
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ");
}

export function renderLabelValueBlock(entries: LabelValue[]): string {
   const visibleEntries = entries.filter((entry) => entry.value.length > 0);

   if (visibleEntries.length === 0) {
      return "";
   }

   const labelWidth = Math.max(
      ...visibleEntries.map((entry) => entry.label.length)
   );

   return visibleEntries
      .map((entry) => `${entry.label.padEnd(labelWidth)}  ${entry.value}`)
      .join("\n");
}

export function renderTable(headers: string[], rows: string[][]): string {
   const widths = headers.map((header, index) =>
      Math.max(
         header.length,
         ...rows.map((row) => {
            const value = row[index];
            return value === undefined ? 0 : value.length;
         })
      )
   );
   const divider = widths.map((width) => "-".repeat(width));

   return [
      padCells(headers, widths),
      padCells(divider, widths),
      ...rows.map((row) => padCells(row, widths))
   ].join("\n");
}

export function formatDuration(durationMs: number): string {
   if (durationMs < 1000) {
      return `${durationMs}ms`;
   }

   if (durationMs < 60_000) {
      const seconds = durationMs / 1000;
      return `${seconds % 1 === 0 ? seconds.toFixed(0) : seconds.toFixed(1)}s`;
   }

   const totalSeconds = Math.floor(durationMs / 1000);
   const minutes = Math.floor(totalSeconds / 60);
   const seconds = totalSeconds % 60;

   if (minutes < 60) {
      return `${minutes}m ${seconds}s`;
   }

   const hours = Math.floor(minutes / 60);
   const remainingMinutes = minutes % 60;

   return `${hours}h ${remainingMinutes}m`;
}

export function renderSection(title: string, content: string): string {
   return `${title}\n\n${content}`;
}
