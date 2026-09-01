"use client";

/**
 * Um dialogo, dois modos: dar baixa (previsto -> realizado) e voltar para
 * previsto (desfazer baixa, ou corrigir "lancei como realizado sem o
 * dinheiro ter caido"). Os dois campos (data, valor) vem pre-preenchidos
 * com o que o lancamento ja tem, editaveis — e mostram a diferenca ao vivo
 * quando algo muda, pro caso real ("previsto R$1.000 pro dia 5, caiu
 * R$1.012,30 no dia 8") ficar visivel antes de confirmar.
 */

import type { Transaction } from "@aec/db";
import { formatAmount, fromDb, parseUserInput } from "@aec/domain";
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, Field, Input } from "@aec/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { darBaixa, desfazerBaixa } from "@/lib/db/transactions";
import { formatDate, friendlyError } from "@/lib/ui/format";

export function BaixaDialog({
  companyId,
  lancamento,
  modo,
  open,
  onOpenChange,
}: {
  companyId: string;
  lancamento: Transaction;
  modo: "baixar" | "previsto";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const valorOriginal = Math.abs(fromDb(lancamento.amount));
  const [data, setData] = useState(lancamento.booking_date);
  const [valor, setValor] = useState(formatAmount(valorOriginal));
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const diferenca = useMemo(() => {
    let valorNovo: number;
    try {
      valorNovo = Math.abs(parseUserInput(valor));
    } catch {
      return null;
    }
    const mudouData = data !== lancamento.booking_date;
    const mudouValor = valorNovo !== valorOriginal;
    if (!mudouData && !mudouValor) return null;

    const diffCentavos = valorNovo - valorOriginal;
    const rotuloDiff =
      diffCentavos === 0
        ? ""
        : ` (${formatAmount(Math.abs(diffCentavos))} ${diffCentavos > 0 ? "a mais" : "a menos"})`;

    return (
      `Previsto era ${formatAmount(valorOriginal)} em ${formatDate(lancamento.booking_date)} — ` +
      `está registrando ${formatAmount(valorNovo)} em ${formatDate(data)}${rotuloDiff}.`
    );
  }, [data, valor, valorOriginal, lancamento.booking_date]);

  function confirmar(event: React.FormEvent) {
    event.preventDefault();
    setErro(null);
    startTransition(async () => {
      const acao = modo === "baixar" ? darBaixa : desfazerBaixa;
      const resultado = await acao({
        companyId,
        transactionId: lancamento.id,
        bookingDate: data,
        amount: valor,
      });
      if (!resultado.ok) {
        setErro(friendlyError(resultado.error, "Não foi possível salvar."));
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  const sentido = fromDb(lancamento.amount) < 0 ? "Saída" : "Entrada";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={modo === "baixar" ? "Dar baixa" : "Voltar para previsto"}
          description={
            modo === "baixar"
              ? "Registre a data e o valor que de fato caíram — não precisam ser os mesmos do previsto."
              : "A data e o valor da baixa sobrescreveram o previsto original. Corrija aqui se precisar, ou deixe como está."
          }
        />
        <form onSubmit={confirmar} className="grid gap-4">
          <p className="text-muted-foreground text-sm">
            {lancamento.description} · <span className="font-medium">{sentido}</span>
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Data">
              <Input
                type="date"
                value={data}
                onChange={(event) => setData(event.target.value)}
                required
              />
            </Field>
            <Field label="Valor">
              <Input
                value={valor}
                onChange={(event) => setValor(event.target.value)}
                inputMode="decimal"
                className="tabular-money"
                required
              />
            </Field>
          </div>
          {diferenca && <p className="text-muted-foreground text-xs">{diferenca}</p>}
          {erro && <p className="text-destructive text-sm">{erro}</p>}
          <DialogFooter>
            <Button type="submit" loading={isPending}>
              {modo === "baixar" ? "Confirmar baixa" : "Voltar para previsto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
