import { access } from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";

export async function resolveExecutable(
   command: string
): Promise<string | undefined> {
   const pathValue = process.env.PATH;

   if (typeof pathValue !== "string" || pathValue.length === 0) {
      return undefined;
   }

   for (const segment of pathValue.split(path.delimiter)) {
      const candidate = path.join(segment, command);

      try {
         await access(candidate, constants.X_OK);
         return candidate;
      } catch {}
   }

   return undefined;
}
