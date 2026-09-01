"use client";

/**
 * Lista as baixas de uma nota e permite desfazer cada uma — reusado por
 * /faturamento (onde a pessoa esbarra no bloqueio de "ja tem recebimento
 * registrado") e por /recebimentos (pra onde `cancelarNota` e
 * `undo_transaction_from_line` mandam a mensagem "desfaca a baixa em
 * Recebimentos primeiro"). Ate esta leva essa acao nao existia em NENHUMA
 * tela — a mensagem apontava pra um lugar que nao tinha o que ela prometia.
 */

import { fromDb } from "@aec/domain";
import { ConfirmDialog, Dialog, DialogContent, DialogHeader, Money } from "@aec/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { unsettleInvoiceAction } from "@/lib/db/faturamento";
import { formatDate, friendlyError } from "@/lib/ui/format";

export interface BaixaDaNota {
  readonly id: string;
  /** Valor numeric do banco, como string — mesma convencao de todo o app. */
  readonly amount: string;
  readonly createdAt: string;
  readonly transactionDescription: string | null;
  readonly transactionBookingDate: string | null;
  readonly bankAccountName: string | null;
}

export function BaixasDaNota({
  companyId,
  invoiceNumber,
  baixas,
  podeDesfazer,
  open,
  onOpenChange,
}: {
  companyId: string;
  invoiceNumber: string;
  baixas: readonly BaixaDaNota[];
  podeDesfazer: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [desfazendoId, setDesfazendoId] = useState<string | null>(null);

  async function desfazer() {
    if (!desfazendoId) return;
    const resultado = await unsettleInvoiceAction(companyId, desfazendoId);
    if (!resultado.ok) {
      setErro(friendlyError(resultado.error, "Não foi possível desfazer."));
      return;
    }
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={`Baixas da nota ${invoiceNumber}`}
          description="Cada lançamento que já quitou (parte d)esta nota. Desfazer devolve a nota para em aberto ou parcial — o lançamento continua existindo, só deixa de estar vinculado a ela."
        />
        {erro && <p className="text-destructive text-sm">{erro}</p>}
        {baixas.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma baixa registrada.</p>
        ) : (
          <div className="divide-border divide-y">
            {baixas.map((baixa) => (
              <div key={baixa.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <Money cents={fromDb(baixa.amount)} className="font-medium" />
                  <p className="text-muted-foreground text-xs">
                    {baixa.transactionBookingDate && formatDate(baixa.transactionBookingDate)}
                    {baixa.transactionDescription && ` · ${baixa.transactionDescription}`}
                    {baixa.bankAccountName && ` · ${baixa.bankAccountName}`}
                  </p>
                </div>
                {podeDesfazer && (
                  <button
                    type="button"
                    onClick={() => setDesfazendoId(baixa.id)}
                    className="text-muted-foreground hover:text-destructive text-xs underline-offset-2 hover:underline"
                  >
                    Desfazer
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <ConfirmDialog
          open={desfazendoId !== null}
          onOpenChange={(open) => !open && setDesfazendoId(null)}
          title="Desfazer esta baixa?"
          description="A nota volta para em aberto (ou parcial, se ainda tiver outras baixas). O lançamento continua existindo."
          confirmLabel="Desfazer baixa"
          tone="danger"
          onConfirm={desfazer}
        />
      </DialogContent>
    </Dialog>
  );
}
