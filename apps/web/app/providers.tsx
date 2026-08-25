"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * One QueryClient per browser session, not per render: creating it in
 * `useState`'s initializer means it survives re-renders but still gets a
 * fresh instance per client, which matters under React's strict mode and
 * server-side rendering alike.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
