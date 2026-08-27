/**
 * A esteira do mes: mostra em que estagio do ciclo mensal a pessoa esta.
 * E o "onde eu estou" que nao existia em nenhuma tela do app antes desta
 * leva — cada tela so respondia "o que tem aqui", nunca "o que falta".
 */

import { Check } from "lucide-react";

import { cn } from "../lib/cn";

export interface StepperStep {
  readonly key: string;
  readonly label: string;
  /** Numero a mostrar junto do rotulo (ex.: quantidade pendente). Omitido quando 0/undefined. */
  readonly count?: number;
  readonly status: "done" | "current" | "upcoming";
}

export function Stepper({ steps }: { steps: readonly StepperStep[] }) {
  return (
    <ol className="flex items-stretch gap-1 overflow-x-auto">
      {steps.map((step, index) => (
        <li key={step.key} className="flex min-w-0 flex-1 items-center gap-1">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                step.status === "done" && "border-inflow bg-inflow text-primary-foreground",
                step.status === "current" && "border-primary bg-primary text-primary-foreground",
                step.status === "upcoming" && "border-border bg-card text-muted-foreground",
              )}
            >
              {step.status === "done" ? <Check className="size-3.5" aria-hidden /> : index + 1}
            </span>
            <span
              className={cn(
                "truncate text-xs leading-tight font-medium",
                step.status === "upcoming" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {step.label}
              {typeof step.count === "number" && step.count > 0 ? ` (${step.count})` : ""}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              className={cn(
                "mb-4 h-px w-4 shrink-0 sm:w-8",
                step.status === "done" ? "bg-inflow" : "bg-border",
              )}
              aria-hidden
            />
          )}
        </li>
      ))}
    </ol>
  );
}
