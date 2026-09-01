"use client";

/**
 * Formulario de edicao de um lancamento existente. Ate esta leva, corrigir
 * qualquer coisa (valor errado, categoria trocada, data digitada errada)
 * exigia excluir e relancar — impossivel se o mes ja estivesse fechado.
 *
 * `editLocks` (@aec/domain) decide o que fica travado: um lancamento
 * conciliado ou com baixa de nota fiscal trava valor/data/conta (o que
 * sustenta a prova de saldo e o rateio da nota); uma perna de transferencia
 * so libera texto. Cada campo travado mostra o motivo — nunca fica cinza
 * sem explicacao. A mesma regra roda de novo no servidor antes de escrever:
 * desabilitar aqui e so conveniencia.
 */

import {
  type BankAccount,
  type Category,
  type CostCenter,
  type Counterparty,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@aec/db";
import { editLocks, formatAmount, fromDb, type TransactionState } from "@aec/domain";
import { Button, Field, Input, Select, Textarea } from "@aec/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { editarLancamento } from "@/lib/db/transactions";
import { friendlyError } from "@/lib/ui/format";

import type { LancamentoRow } from "./lancamentos-table";

const LOCK_HINT: Record<string, string> = {
  conciliado: "Já foi conciliado com o extrato — desfaça a conciliação em Conciliação primeiro.",
  baixaDeNota: "Já tem baixa de nota fiscal — desfaça a baixa em Recebimentos primeiro.",
  transferencia: "É uma perna de transferência — só o texto pode ser corrigido aqui.",
};

export function EditarLancamentoForm({
  companyId,
  lancamento,
  contas,
  categorias,
  contrapartes,
  centrosDeCusto,
  onSaved,
}: {
  companyId: string;
  lancamento: LancamentoRow;
  contas: readonly BankAccount[];
  categorias: readonly Category[];
  contrapartes: readonly Counterparty[];
  centrosDeCusto: readonly CostCenter[];
  onSaved: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const valorOriginal = Math.abs(fromDb(lancamento.amount));
  const [descricao, setDescricao] = useState(lancamento.description);
  const [valor, setValor] = useState(formatAmount(valorOriginal));
  const [data, setData] = useState(lancamento.booking_date);
  const [contaId, setContaId] = useState(lancamento.bank_account_id);
  const [categoriaId, setCategoriaId] = useState(lancamento.category_id ?? "");
  const [contraparteId, setContraparteId] = useState(lancamento.counterparty_id ?? "");
  const [centroDeCustoId, setCentroDeCustoId] = useState(lancamento.cost_center_id ?? "");
  const [documento, setDocumento] = useState(lancamento.document_number ?? "");
  const [formaPagamento, setFormaPagamento] = useState(lancamento.payment_method ?? "");
  const [notas, setNotas] = useState(lancamento.notes ?? "");

  const state: TransactionState = {
    status: lancamento.status,
    reconciled: lancamento.reconciliation === "conciliado",
    hasInvoiceSettlement: lancamento.temBaixaDeNota,
    isTransfer: lancamento.is_transfer,
    // O mes fechado ja e filtrado antes deste formulario existir (o painel
    // que abre este dialogo so aparece com `podeEditar`, que ja considera
    // mesFechado) — nao ha necessidade de recomputar aqui.
    periodLocked: false,
  };
  const locks = editLocks(state);
  const ehSaida = fromDb(lancamento.amount) < 0;
  const categoriasDoSentido = categorias.filter(
    (categoria) => categoria.kind === "ambos" || categoria.kind === (ehSaida ? "saida" : "entrada"),
  );

  function salvar(event: React.FormEvent) {
    event.preventDefault();
    setErro(null);
    startTransition(async () => {
      const resultado = await editarLancamento({
        companyId,
        transactionId: lancamento.id,
        description: descricao,
        amount: valor,
        bookingDate: data,
        bankAccountId: contaId,
        categoryId: categoriaId || null,
        counterpartyId: contraparteId || null,
        costCenterId: centroDeCustoId || null,
        documentNumber: documento || null,
        paymentMethod: (formaPagamento || null) as PaymentMethod | null,
        notes: notas || null,
      });
      if (!resultado.ok) {
        setErro(friendlyError(resultado.error, "Não foi possível salvar."));
        return;
      }
      onSaved();
      router.refresh();
    });
  }

  return (
    <form onSubmit={salvar} className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Descrição">
          <Input
            value={descricao}
            onChange={(event) => setDescricao(event.target.value)}
            required
          />
        </Field>
        <Field label="Documento">
          <Input
            value={documento}
            onChange={(event) => setDocumento(event.target.value)}
            placeholder="NF, boleto..."
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label={`Valor (${ehSaida ? "saída" : "entrada"})`}
          hint={locks.amount[0] && LOCK_HINT[locks.amount[0]]}
        >
          <Input
            value={valor}
            onChange={(event) => setValor(event.target.value)}
            disabled={locks.amount.length > 0}
            inputMode="decimal"
            className="tabular-money"
            required
          />
        </Field>
        <Field label="Data" hint={locks.bookingDate[0] && LOCK_HINT[locks.bookingDate[0]]}>
          <Input
            type="date"
            value={data}
            onChange={(event) => setData(event.target.value)}
            disabled={locks.bookingDate.length > 0}
            required
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Conta" hint={locks.bankAccountId[0] && LOCK_HINT[locks.bankAccountId[0]]}>
          <Select
            value={contaId}
            onChange={(event) => setContaId(event.target.value)}
            disabled={locks.bankAccountId.length > 0}
            required
          >
            {contas.map((conta) => (
              <option key={conta.id} value={conta.id}>
                {conta.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Categoria" hint={locks.categoryId[0] && LOCK_HINT[locks.categoryId[0]]}>
          <Select
            value={categoriaId}
            onChange={(event) => setCategoriaId(event.target.value)}
            disabled={locks.categoryId.length > 0}
          >
            <option value="">Sem categoria</option>
            {categoriasDoSentido.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {(contrapartes.length > 0 || centrosDeCusto.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {contrapartes.length > 0 && (
            <Field label="Cliente ou fornecedor">
              <Select
                value={contraparteId}
                onChange={(event) => setContraparteId(event.target.value)}
              >
                <option value="">Não informado</option>
                {contrapartes.map((contraparte) => (
                  <option key={contraparte.id} value={contraparte.id}>
                    {contraparte.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {centrosDeCusto.length > 0 && (
            <Field label="Centro de custo">
              <Select
                value={centroDeCustoId}
                onChange={(event) => setCentroDeCustoId(event.target.value)}
              >
                <option value="">Não informado</option>
                {centrosDeCusto.map((centro) => (
                  <option key={centro.id} value={centro.id}>
                    {centro.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}

      <Field label="Forma de pagamento">
        <Select value={formaPagamento} onChange={(event) => setFormaPagamento(event.target.value)}>
          <option value="">Não informado</option>
          {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Observações"
        hint="Anote aqui do que se trata, pra não precisar lembrar depois."
      >
        <Textarea
          value={notas}
          onChange={(event) => setNotas(event.target.value)}
          rows={3}
          placeholder="Ex.: Pix referente ao aluguel de março"
        />
      </Field>

      {erro && <p className="text-destructive text-sm">{erro}</p>}

      <Button type="submit" loading={isPending}>
        Salvar alterações
      </Button>
    </form>
  );
}
