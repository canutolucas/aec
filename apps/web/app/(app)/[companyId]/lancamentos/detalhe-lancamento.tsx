"use client";

/**
 * Painel de detalhe de um lancamento — pedido direto da usuaria final: "nao
 * consigo lembrar do que se refere aquele valor". Mostra o historico
 * original do banco (statement_lines.memo, ja buscado em lote por
 * page.tsx) e uma observacao livre editavel (transactions.notes, campo que
 * existia desde a primeira leva e nenhuma tela jamais expunha).
 */

import { PAYMENT_METHOD_LABELS } from "@aec/db";
import { fromDb } from "@aec/domain";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  Field,
  Money,
  Textarea,
} from "@aec/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { atualizarObservacoes } from "@/lib/db/transactions";
import { formatDate } from "@/lib/ui/format";

import type { LancamentoRow } from "./lancamentos-table";

export function DetalheLancamento({
  companyId,
  lancamento,
  podeEditar,
  open,
  onOpenChange,
}: {
  companyId: string;
  lancamento: LancamentoRow | null;
  podeEditar: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notes, setNotes] = useState(lancamento?.notes ?? "");
  const [salvo, setSalvo] = useState(false);

  if (!lancamento) return null;

  function salvarObservacoes() {
    if (!lancamento) return;
    startTransition(async () => {
      const result = await atualizarObservacoes(companyId, lancamento.id, notes);
      if (result.ok) {
        setSalvo(true);
        router.refresh();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={lancamento.description}
          description={`${formatDate(lancamento.booking_date)} · ${lancamento.contaNome}`}
        />

        <div className="grid gap-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-sm">Valor</span>
            <Money cents={fromDb(lancamento.amount)} className="text-lg font-semibold" />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {lancamento.status === "previsto" && <Badge tone="warn">previsto</Badge>}
            {lancamento.reconciliation === "conciliado" && <Badge tone="success">conciliado</Badge>}
            {lancamento.is_transfer && <Badge tone="info">transferência</Badge>}
            {lancamento.categoriaNome && <Badge tone="neutral">{lancamento.categoriaNome}</Badge>}
            {lancamento.payment_method && (
              <Badge tone="neutral">{PAYMENT_METHOD_LABELS[lancamento.payment_method]}</Badge>
            )}
          </div>

          {lancamento.memoExtrato && (
            <div className="bg-muted rounded-md p-3">
              <p className="text-muted-foreground text-xs">Histórico original do banco</p>
              <p className="mt-1 text-sm">{lancamento.memoExtrato}</p>
            </div>
          )}

          {lancamento.document_number && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Documento</span>
              <span>{lancamento.document_number}</span>
            </div>
          )}

          <Field
            label="Observações"
            hint="Anote aqui do que se trata, pra não precisar lembrar depois."
          >
            <Textarea
              value={notes}
              disabled={!podeEditar || isPending}
              onChange={(event) => {
                setNotes(event.target.value);
                setSalvo(false);
              }}
              rows={3}
              placeholder="Ex.: Pix referente ao aluguel de março"
            />
          </Field>

          {podeEditar && (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                loading={isPending}
                disabled={notes === (lancamento.notes ?? "")}
                onClick={salvarObservacoes}
              >
                Salvar observação
              </Button>
              {salvo && <span className="text-inflow text-xs">Salvo.</span>}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
