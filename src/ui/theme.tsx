import type { ReactNode } from "react";

import {
   ThemeProvider,
   defaultTheme,
   extendTheme,
   type ComponentTheme
} from "@inkjs/ui";
import type { TextProps } from "ink";

const colorByVariant = {
   error: "red",
   info: "cyan",
   success: "green",
   warning: "yellow"
} as const;

function getVariantColor(
   input: {
      variant?: keyof typeof colorByVariant;
   } | undefined
): (typeof colorByVariant)[keyof typeof colorByVariant] {
   const variant = input?.variant ?? "info";
   return colorByVariant[variant];
}

const alertTheme = {
   styles: {
      icon: (
         input:
            | {
                 variant?: keyof typeof colorByVariant;
              }
            | undefined
      ): TextProps => ({
         color: getVariantColor(input)
      }),
      title: (
         input:
            | {
                 variant?: keyof typeof colorByVariant;
              }
            | undefined
      ): TextProps => ({
         bold: true,
         color: getVariantColor(input)
      })
   }
} satisfies ComponentTheme;

const statusMessageTheme = {
   styles: {
      icon: (
         input:
            | {
                 variant?: keyof typeof colorByVariant;
              }
            | undefined
      ): TextProps => ({
         color: getVariantColor(input)
      })
   }
} satisfies ComponentTheme;

const spinnerTheme = {
   styles: {
      frame: (): TextProps => ({
         color: "cyan"
      }),
      label: (): TextProps => ({
         color: "cyan"
      })
   }
} satisfies ComponentTheme;

const badgeTheme = {
   styles: {
      container: (): TextProps => ({
         bold: true
      })
   }
} satisfies ComponentTheme;

const listTheme = {
   config: () => ({
      marker: "•"
   })
} satisfies ComponentTheme;

export const aimanTheme = extendTheme(defaultTheme, {
   components: {
      Alert: alertTheme,
      Badge: badgeTheme,
      Spinner: spinnerTheme,
      StatusMessage: statusMessageTheme,
      UnorderedList: listTheme
   }
});

export function AimanThemeProvider(input: {
   children: ReactNode;
}): React.JSX.Element {
   return <ThemeProvider theme={aimanTheme}>{input.children}</ThemeProvider>;
}
