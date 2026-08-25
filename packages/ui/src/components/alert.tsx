import type { ReactNode } from "react";

import { cn } from "../lib/cn";

const TONES = {
  info: "border-border bg-muted text-foreground",
  warn: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  success: "border-inflow/40 bg-inflow/10 text-inflow",
} as const;

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("rounded-md border px-3 py-2 text-sm", TONES[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}
