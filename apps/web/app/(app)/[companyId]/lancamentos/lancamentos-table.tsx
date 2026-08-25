"use client";

import type { Transaction } from "@aec/db";
import { fromDb } from "@aec/domain";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";

import { Badge, Money } from "@/lib/ui/components";
import { formatDate } from "@/lib/ui/format";

import { AcoesLancamento } from "./acoes-lancamento";

export interface LancamentoRow extends Transaction {
  readonly contaNome: string;
  readonly categoriaNome: string | null;
}

const columnHelper = createColumnHelper<LancamentoRow>();

/**
 * The transactions grid, via TanStack Table. Row actions (settle a
 * forecast, delete) stay in their own client component so each row keeps
 * independent pending/error state without threading it through the table.
 */
export function LancamentosTable({
  companyId,
  lancamentos,
  podeEditar,
}: {
  companyId: string;
  lancamentos: readonly LancamentoRow[];
  podeEditar: boolean;
}) {
  const columns = [
    columnHelper.accessor("booking_date", {
      header: "Data",
      cell: (info) => (
        <span className="tabular-money text-muted-foreground whitespace-nowrap">
          {formatDate(info.getValue())}
        </span>
      ),
    }),
    columnHelper.accessor("description", {
      header: "Descricao",
      cell: (info) => (
        <div>
          <p className="font-medium">{info.getValue()}</p>
          {info.row.original.document_number && (
            <p className="text-muted-foreground text-xs">
              Doc. {info.row.original.document_number}
            </p>
          )}
        </div>
      ),
    }),
    columnHelper.accessor("contaNome", {
      header: "Conta",
      cell: (info) => (
        <span className="text-muted-foreground whitespace-nowrap">{info.getValue()}</span>
      ),
    }),
    columnHelper.display({
      id: "categoria",
      header: "Categoria",
      cell: ({ row }) => {
        const lancamento = row.original;
        if (lancamento.is_transfer) return <span className="text-xs italic">transferencia</span>;
        return lancamento.categoriaNome ?? <span className="text-xs italic">sem categoria</span>;
      },
    }),
    columnHelper.accessor("amount", {
      header: "Valor",
      cell: (info) => <Money cents={fromDb(info.getValue())} />,
      meta: { align: "right" as const },
    }),
    columnHelper.display({
      id: "situacao",
      header: "Situacao",
      cell: ({ row }) => {
        const lancamento = row.original;
        return (
          <div className="flex flex-wrap gap-1">
            {lancamento.status === "previsto" && <Badge tone="warn">previsto</Badge>}
            {lancamento.reconciliation === "conciliado" && <Badge tone="success">conciliado</Badge>}
            {lancamento.is_transfer && <Badge tone="info">transferencia</Badge>}
          </div>
        );
      },
    }),
    columnHelper.display({
      id: "acoes",
      header: "",
      cell: ({ row }) => (
        <AcoesLancamento companyId={companyId} lancamento={row.original} podeEditar={podeEditar} />
      ),
      meta: { align: "right" as const },
    }),
  ];

  const table = useReactTable({
    data: lancamentos as LancamentoRow[],
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return (
    <table className="w-full text-sm">
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr
            key={headerGroup.id}
            className="border-border text-muted-foreground border-b text-left text-xs"
          >
            {headerGroup.headers.map((header) => (
              <th
                key={header.id}
                className={`px-4 py-2 font-medium ${header.column.columnDef.meta?.align === "right" ? "text-right" : ""}`}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(header.column.columnDef.header, header.getContext())}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody className="divide-border divide-y">
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getVisibleCells().map((cell) => (
              <td
                key={cell.id}
                className={`px-4 py-2 ${cell.column.columnDef.meta?.align === "right" ? "text-right" : ""}`}
              >
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
