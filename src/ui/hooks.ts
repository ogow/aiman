import { useEffect, useState } from "react";

import { useStdout } from "ink";

export function useTerminalSize(): {
   height: number;
   width: number;
} {
   const { stdout } = useStdout();
   const [size, setSize] = useState({
      height:
         "rows" in stdout && typeof stdout.rows === "number" ? stdout.rows : 24,
      width:
         "columns" in stdout && typeof stdout.columns === "number"
            ? stdout.columns
            : 80
   });

   useEffect(() => {
      const updateSize = () => {
         const nextSize = {
            height:
               "rows" in stdout && typeof stdout.rows === "number"
                  ? stdout.rows
                  : 24,
            width:
               "columns" in stdout && typeof stdout.columns === "number"
                  ? stdout.columns
                  : 80
         };

         setSize((currentSize) =>
            currentSize.height === nextSize.height &&
            currentSize.width === nextSize.width
               ? currentSize
               : nextSize
         );
      };

      updateSize();
      stdout.on("resize", updateSize);

      return () => {
         stdout.off("resize", updateSize);
      };
   }, [stdout]);

   return size;
}
