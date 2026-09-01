"use client";

/**
 * Formulario de recorrencia — usado tanto para criar quanto para editar
 * (com `recorrencia` preenchido). Mesmo padrao de campo controlado que
 * lancamento-rapido.tsx: aqui compensa mais um form simples que TanStack,
 * ja que a maioria dos campos e select, nao texto validado ao vivo.
 */

import {
  type BankAccount,
  type Category,
  type CostCenter,
  type Counterparty,
  type Recurrence,
  RECURRENCE_FREQUENCY_LABELS,
  type RecurrenceFrequency,
} from "@aec/db";
import { formatAmount, fromDb, todayInBrazil } from "@aec/domain";
import { useState, useTransition } from "react";

import { criarRecorrencia, editarRecorrencia } from "@/lib/db/recorrencias";
import { Alert, Button, Field, Input, Select } from "@/lib/ui/components";

export function RecorrenciaForm({
  companyId,
  contas,
  categorias,
  contrapartes,
  centrosDeCusto,
  recorrencia,
  onSalvo,
}: {
  companyId: string;
  contas: readonly BankAccount[];
  categorias: readonly Category[];
  contrapartes: readonly Counterparty[];
  centrosDeCusto: readonly CostCenter[];
  recorrencia?: Recurrence;
  onSalvo: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const [description, setDescription] = useState(recorrencia?.description ?? "");
  const [direction, setDirection] = useState<"entrada" | "saida">(
    recorrencia ? (fromDb(recorrencia.amount) < 0 ? "saida" : "entrada") : "saida",
  );
  const [amount, setAmount] = useState(
    recorrencia ? formatAmount(Math.abs(fromDb(recorrencia.amount))) : "",
  );
  const [bankAccountId, setBankAccountId] = useState(
    recorrencia?.bank_account_id ?? contas[0]?.id ?? "",
  );
  const [categoryId, setCategoryId] = useState(recorrencia?.category_id ?? "");
  const [counterpartyId, setCounterpartyId] = useState(recorrencia?.counterparty_id ?? "");
  const [costCenterId, setCostCenterId] = useState(recorrencia?.cost_center_id ?? "");
  const [frequency, setFrequency] = useState<RecurrenceFrequency>(
    recorrencia?.frequency ?? "mensal",
  );
  const [dayOfMonth, setDayOfMonth] = useState(
    recorrencia?.day_of_month ? String(recorrencia.day_of_month) : "",
  );
  const [startDate, setStartDate] = useState(recorrencia?.start_date ?? todayInBrazil());
  const [endDate, setEndDate] = useState(recorrencia?.end_date ?? "");

  const categoriasDoSentido = categorias.filter(
    (categoria) => categoria.kind === "ambos" || categoria.kind === direction,
  );
  const usaDiaDoMes = frequency === "mensal" || frequency === "anual";

  function salvar(event: React.FormEvent) {
    event.preventDefault();
    setErro(null);

    iniciar(async () => {
      const input = {
        companyId,
        bankAccountId,
        categoryId: categoryId || undefined,
        counterpartyId: counterpartyId || undefined,
        costCenterId: costCenterId || undefined,
        description,
        amount,
        direction,
        frequency,
        dayOfMonth: usaDiaDoMes && dayOfMonth ? Number(dayOfMonth) : undefined,
        startDate,
        endDate: endDate || undefined,
      };

      const resultado = recorrencia
        ? await editarRecorrencia({ ...input, id: recorrencia.id })
        : await criarRecorrencia(input);

      if (!resultado.ok) {
        setErro(resultado.error ?? "Nao foi possivel salvar.");
        return;
      }

      onSalvo();
    });
  }

  return (
    <form onSubmit={salvar} className="space-y-4 p-4">
      {erro && <Alert tone="error">{erro}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Descrição">
          <Input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Ex.: Aluguel da sala"
            required
          />
        </Field>

        <Field label="Conta">
          <Select
            value={bankAccountId}
            onChange={(event) => setBankAccountId(event.target.value)}
            required
          >
            {contas.map((conta) => (
              <option key={conta.id} value={conta.id}>
                {conta.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Sentido">
          <Select
            value={direction}
            onChange={(event) => setDirection(event.target.value as "entrada" | "saida")}
          >
            <option value="saida">Saída</option>
            <option value="entrada">Entrada</option>
          </Select>
        </Field>

        <Field label="Valor">
          <Input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            required
            className="tabular-money"
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Categoria (opcional)">
          <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
            <option value="">Sem categoria</option>
            {categoriasDoSentido.map((categoria) => (
              <option key={categoria.id} value={categoria.id}>
                {categoria.name}
              </option>
            ))}
          </Select>
        </Field>

        {contrapartes.length > 0 && (
          <Field label="Cliente ou fornecedor (opcional)">
            <Select
              value={counterpartyId}
              onChange={(event) => setCounterpartyId(event.target.value)}
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
          <Field label="Centro de custo (opcional)">
            <Select value={costCenterId} onChange={(event) => setCostCenterId(event.target.value)}>
              <option value="">Não informado</option>
              {centrosDeCusto.map((centro) => (
                <option key={centro.id} value={centro.id}>
                  {centro.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label="Frequência">
          <Select
            value={frequency}
            onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}
          >
            {Object.entries(RECURRENCE_FREQUENCY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {usaDiaDoMes && (
          <Field
            label="Dia do vencimento"
            hint="1 a 31. Cai no último dia do mês quando não existir."
          >
            <Input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(event) => setDayOfMonth(event.target.value)}
              placeholder="Ex.: 5"
            />
          </Field>
        )}

        <Field label="Começa em">
          <Input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            required
          />
        </Field>

        <Field label="Termina em (opcional)" hint="Deixe em branco para repetir sem data final.">
          <Input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </Field>

        <div className="flex items-end gap-2">
          <Button type="submit" size="sm" disabled={pendente}>
            {pendente ? "Salvando..." : recorrencia ? "Salvar alterações" : "Cadastrar recorrência"}
          </Button>
          {recorrencia && (
            <Button type="button" size="sm" variant="ghost" onClick={onSalvo} disabled={pendente}>
              Cancelar
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}
