"use client";

/**
 * Trilha de auditoria — quem mudou o que, quando. audit_log e preenchido so
 * por trigger (app.write_audit_log(), ver 20250101000500_recorrencias_anexos.sql
 * e 20250101002100_audit_triggers_restantes.sql); esta tela e a primeira
 * leitura dela — a RLS ja liberava contador+ desde a primeira migration,
 * mas nunca existiu tela nenhuma que consultasse.
 */

import type { AuditLog } from "@aec/db";
import {
  Badge,
  Button,
  DataTable,
  type DataTableColumn,
  Dialog,
  DialogContent,
  DialogHeader,
} from "@aec/ui";
import { useState } from "react";

import { formatDateTime } from "@/lib/ui/format";

const ACTION_LABEL: Record<AuditLog["action"], string> = {
  INSERT: "Criado",
  UPDATE: "Atualizado",
  DELETE: "Removido",
};

const ACTION_TONE: Record<AuditLog["action"], "success" | "info" | "error"> = {
  INSERT: "success",
  UPDATE: "info",
  DELETE: "error",
};

export interface AuditLogRow extends Omit<AuditLog, "id"> {
  /** DataTable exige id string — audit_log.id e bigint (number) no banco. */
  readonly id: string;
  readonly tableLabel: string;
  readonly actorName: string;
}

/** Campos que mudaram entre o estado antigo e o novo (chaves iguais nos dois lados). */
function diffFields(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
): { field: string; before: unknown; after: unknown }[] {
  const keys = new Set([...Object.keys(oldData ?? {}), ...Object.keys(newData ?? {})]);
  keys.delete("updated_at");
  const result: { field: string; before: unknown; after: unknown }[] = [];
  for (const field of keys) {
    const before = oldData?.[field];
    const after = newData?.[field];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    result.push({ field, before, after });
  }
  return result;
}

function valorLegivel(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function AuditoriaClient({ linhas }: { linhas: readonly AuditLogRow[] }) {
  const [selecionada, setSelecionada] = useState<AuditLogRow | null>(null);

  const columns: DataTableColumn<AuditLogRow>[] = [
    {
      key: "changed_at",
      header: "Quando",
      render: (linha) => (
        <span className="whitespace-nowrap tabular-nums">{formatDateTime(linha.changed_at)}</span>
      ),
    },
    { key: "table", header: "O que", render: (linha) => linha.tableLabel },
    {
      key: "action",
      header: "Ação",
      render: (linha) => (
        <Badge tone={ACTION_TONE[linha.action]}>{ACTION_LABEL[linha.action]}</Badge>
      ),
    },
    { key: "actor", header: "Quem", render: (linha) => linha.actorName },
    {
      key: "detalhes",
      header: "",
      align: "right",
      render: (linha) => (
        <Button type="button" variant="secondary" size="sm" onClick={() => setSelecionada(linha)}>
          Ver detalhes
        </Button>
      ),
    },
  ];

  const detalhes = selecionada
    ? diffFields(
        selecionada.old_data as Record<string, unknown> | null,
        selecionada.new_data as Record<string, unknown> | null,
      )
    : [];

  return (
    <>
      <DataTable
        columns={columns}
        rows={linhas}
        emptyTitle="Nada por aqui"
        emptyDescription="Nenhuma alteração registrada neste período com este filtro."
      />

      <Dialog open={selecionada !== null} onOpenChange={(open) => !open && setSelecionada(null)}>
        <DialogContent>
          {selecionada && (
            <>
              <DialogHeader
                title={`${selecionada.tableLabel} — ${ACTION_LABEL[selecionada.action]}`}
                description={`${formatDateTime(selecionada.changed_at)} · ${selecionada.actorName}`}
              />
              {detalhes.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  {selecionada.action === "INSERT"
                    ? "Registro criado — sem estado anterior para comparar."
                    : "Nenhum campo com valor diferente para mostrar."}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-border text-muted-foreground border-b text-left text-xs">
                        <th className="py-2 pr-3 font-medium">Campo</th>
                        {selecionada.action !== "INSERT" && (
                          <th className="py-2 pr-3 font-medium">Antes</th>
                        )}
                        {selecionada.action !== "DELETE" && (
                          <th className="py-2 font-medium">Depois</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-border divide-y">
                      {detalhes.map(({ field, before, after }) => (
                        <tr key={field}>
                          <td className="py-2 pr-3 font-mono text-xs">{field}</td>
                          {selecionada.action !== "INSERT" && (
                            <td className="text-destructive py-2 pr-3 break-all">
                              {valorLegivel(before)}
                            </td>
                          )}
                          {selecionada.action !== "DELETE" && (
                            <td className="text-inflow py-2 break-all">{valorLegivel(after)}</td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
