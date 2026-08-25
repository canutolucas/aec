"use client";

import { useState, useTransition } from "react";
import { darBaixa, excluirLancamento } from "@/lib/db/lancamentos";
import type { Transaction } from "@/lib/db/types";
import { fromDb } from "@/lib/domain/money";
import { Badge, Money } from "@/lib/ui/components";
import { formatDate } from "@/lib/ui/format";

export function LinhaLancamento({
  companyId,
  lancamento,
  contaNome,
  categoriaNome,
  podeEditar,
}: {
  companyId: string;
  lancamento: Transaction;
  contaNome: string;
  categoriaNome: string | null;
  podeEditar: boolean;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function excluir() {
    // Exclusao de lancamento e irreversivel para quem opera (a trilha de
    // auditoria guarda, mas a tela nao desfaz), entao confirma antes.
    if (!confirm(`Excluir "${lancamento.description}"?`)) return;

    iniciar(async () => {
      const resultado = await excluirLancamento(companyId, lancamento.id);
      if (!resultado.ok) setErro(resultado.error ?? "Nao foi possivel excluir.");
    });
  }

  function baixar() {
    iniciar(async () => {
      const resultado = await darBaixa(companyId, lancamento.id);
      if (!resultado.ok) setErro(resultado.error ?? "Nao foi possivel dar baixa.");
    });
  }

  return (
    <>
      <tr className={pendente ? "opacity-50" : undefined}>
        <td className="numero whitespace-nowrap px-4 py-2 text-[--color-tinta-fraca]">
          {formatDate(lancamento.booking_date)}
        </td>

        <td className="px-4 py-2">
          <p className="font-medium">{lancamento.description}</p>
          {lancamento.document_number && (
            <p className="text-xs text-[--color-tinta-fraca]">
              Doc. {lancamento.document_number}
            </p>
          )}
        </td>

        <td className="whitespace-nowrap px-4 py-2 text-[--color-tinta-fraca]">{contaNome}</td>

        <td className="px-4 py-2 text-[--color-tinta-fraca]">
          {lancamento.is_transfer ? (
            <span className="text-xs italic">transferencia</span>
          ) : (
            (categoriaNome ?? <span className="text-xs italic">sem categoria</span>)
          )}
        </td>

        <td className="whitespace-nowrap px-4 py-2 text-right">
          <Money cents={fromDb(lancamento.amount)} />
        </td>

        <td className="px-4 py-2">
          <div className="flex flex-wrap gap-1">
            {lancamento.status === "previsto" && <Badge tone="warn">previsto</Badge>}
            {lancamento.reconciliation === "conciliado" && <Badge tone="success">conciliado</Badge>}
            {lancamento.is_transfer && <Badge tone="info">transferencia</Badge>}
          </div>
        </td>

        <td className="px-4 py-2 text-right">
          {podeEditar && (
            <div className="flex justify-end gap-2">
              {lancamento.status === "previsto" && (
                <button
                  type="button"
                  onClick={baixar}
                  disabled={pendente}
                  className="text-xs text-[--color-marca] underline-offset-2 hover:underline"
                >
                  dar baixa
                </button>
              )}
              <button
                type="button"
                onClick={excluir}
                disabled={pendente}
                className="text-xs text-[--color-tinta-fraca] underline-offset-2 hover:text-[--color-saida] hover:underline"
              >
                excluir
              </button>
            </div>
          )}
        </td>
      </tr>

      {erro && (
        <tr>
          <td colSpan={7} className="bg-red-50 px-4 py-2 text-xs text-red-900">
            {erro}
          </td>
        </tr>
      )}
    </>
  );
}
