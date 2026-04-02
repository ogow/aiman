import type { ReactElement } from "react";

import { render } from "ink";

const alternateScreenOn = "\u001b[?1049h\u001b[2J\u001b[H\u001b[?25l";
const alternateScreenOff = "\u001b[?25h\u001b[?1049l";

export async function runInkScreen(node: ReactElement): Promise<void> {
   process.stdout.write(alternateScreenOn);

   try {
      const instance = render(node, {
         exitOnCtrlC: false,
         maxFps: 20,
         patchConsole: false
      });

      await instance.waitUntilExit();
   } finally {
      process.stdout.write(alternateScreenOff);
   }
}
