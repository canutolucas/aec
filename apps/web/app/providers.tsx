"use client";

import { ToastProvider, TooltipProvider } from "@aec/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";

/**
 * One QueryClient per browser session, not per render: creating it in
 * `useState`'s initializer means it survives re-renders but still gets a
 * fresh instance per client, which matters under React's strict mode and
 * server-side rendering alike.
 *
 * `ThemeProvider` liga o modo escuro — os tokens ja existiam prontos em
 * theme.css desde a primeira leva e nunca tinham sido ativados. `attribute
 * class` bate com o seletor `.dark` que o CSS ja usa; `defaultTheme
 * "system"` respeita o SO da pessoa por padrao.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <ToastProvider>{children}</ToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
