/**
 * Numero em destaque (KPI) — antes desta leva, reinventado 4 vezes
 * (painel, relatorios, inicio, faturamento), cada um com tipografia
 * diferente.
 */
import type { ReactNode } from "react";

import { cn } from "../lib/cn";

export function StatTile({
  label,
  value,
  tone = "default",
  size = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "positive" | "negative";
  size?: "default" | "lg";
}) {
  return (
    <div className="bg-card border-border rounded-lg border p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p
        className={cn(
          "mt-1 font-semibold tabular-nums",
          size === "lg" ? "text-2xl" : "text-lg",
          tone === "positive" && "text-inflow",
          tone === "negative" && "text-outflow",
        )}
      >
        {value}
      </p>
    </div>
  );
}
