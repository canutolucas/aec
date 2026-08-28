"use client";

/**
 * Transferencia entre contas — criarTransferencia (lib/db/transactions.ts)
 * ja existia e cria os dois lados atomicamente via a RPC create_transfer,
 * mas nenhuma tela chamava. A badge "transferencia" aparecia na tabela de
 * lancamentos sem que fosse possivel produzi-la por aqui.
 */

import type { BankAccount } from "@aec/db";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
  Field,
  Input,
  Select,
} from "@aec/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { criarTransferencia } from "@/lib/db/transactions";

export function TransferenciaDialog({
  companyId,
  contas,
  hoje,
}: {
  companyId: string;
  contas: readonly BankAccount[];
  hoje: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [origemId, setOrigemId] = useState(contas[0]?.id ?? "");
  const [destinoId, setDestinoId] = useState(contas[1]?.id ?? contas[0]?.id ?? "");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hoje);
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function limpar() {
    setValor("");
    setDescricao("");
    setErro(null);
  }

  function salvar(event: React.FormEvent) {
    event.preventDefault();
    setErro(null);
    startTransition(async () => {
      const resultado = await criarTransferencia({
        companyId,
        fromAccountId: origemId,
        toAccountId: destinoId,
        amount: valor,
        bookingDate: data,
        description: descricao,
      });
      if (!resultado.ok) {
        setErro(resultado.error ?? "Não foi possível transferir.");
        return;
      }
      setOpen(false);
      limpar();
      router.refresh();
    });
  }

  if (contas.length < 2) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) limpar();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="secondary">
          Transferência entre contas
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader
          title="Transferência entre contas"
          description="Cria os dois lados (saída na origem, entrada no destino) numa única operação — não conta como receita nem despesa."
        />
        <form onSubmit={salvar} className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="De">
              <Select value={origemId} onChange={(event) => setOrigemId(event.target.value)}>
                {contas.map((conta) => (
                  <option key={conta.id} value={conta.id}>
                    {conta.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Para">
              <Select value={destinoId} onChange={(event) => setDestinoId(event.target.value)}>
                {contas.map((conta) => (
                  <option key={conta.id} value={conta.id}>
                    {conta.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Valor">
              <Input
                value={valor}
                onChange={(event) => setValor(event.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                required
                className="tabular-money"
              />
            </Field>
            <Field label="Data">
              <Input
                type="date"
                value={data}
                onChange={(event) => setData(event.target.value)}
                required
              />
            </Field>
          </div>
          <Field label="Descrição (opcional)">
            <Input
              value={descricao}
              onChange={(event) => setDescricao(event.target.value)}
              placeholder="Ex.: Reforço de caixa"
            />
          </Field>
          {erro && <p className="text-destructive text-sm">{erro}</p>}
          <DialogFooter>
            <Button type="submit" loading={isPending} disabled={origemId === destinoId}>
              Transferir
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
