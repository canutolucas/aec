import type { ReactNode } from "react";

import { cn } from "../lib/cn";

const TONES = {
  neutral: "bg-muted text-muted-foreground border-border",
  warn: "bg-warning/10 text-warning border-warning/30",
  success: "bg-inflow/10 text-inflow border-inflow/30",
  info: "bg-primary/10 text-primary border-primary/30",
  error: "bg-destructive/10 text-destructive border-destructive/30",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-xs", TONES[tone])}
    >
      {children}
    </span>
  );
}
