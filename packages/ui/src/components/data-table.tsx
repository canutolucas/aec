/**
 * Tabela generica e responsiva — antes desta leva, 5 telas montavam a
 * propria `<table>` com o mesmo boilerplate (contas, painel x2, relatorios,
 * faturamento). `lancamentos-table.tsx` continua em TanStack Table por
 * conta da ordenacao/selecao especifica dela; este componente cobre o caso
 * comum de "lista simples com colunas fixas".
 */
import type { ReactNode } from "react";

import { cn } from "../lib/cn";
import { EmptyState } from "./empty-state";

export interface DataTableColumn<T> {
  readonly key: string;
  readonly header: ReactNode;
  readonly render: (row: T) => ReactNode;
  readonly align?: "left" | "right";
  readonly className?: string;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  footer,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: {
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  footer?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
}) {
  if (rows.length === 0 && emptyTitle && emptyDescription) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border text-muted-foreground border-b text-left text-xs">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  "px-4 py-2 font-medium",
                  column.align === "right" && "text-right",
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "px-4 py-2",
                    column.align === "right" && "text-right",
                    column.className,
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer}
      </table>
    </div>
  );
}
