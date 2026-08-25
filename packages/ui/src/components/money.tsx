import { type Cents, formatBRL } from "@aec/domain";

import { cn } from "../lib/cn";

/**
 * Monetary value, colored by direction and set in tabular figures so a
 * column of amounts lines up on the decimal comma without reading digit by
 * digit.
 */
export function Money({ cents, className }: { cents: Cents; className?: string }) {
  const tone = cents > 0 ? "text-inflow" : cents < 0 ? "text-outflow" : "text-muted-foreground";
  return <span className={cn("tabular-money", tone, className)}>{formatBRL(cents)}</span>;
}
