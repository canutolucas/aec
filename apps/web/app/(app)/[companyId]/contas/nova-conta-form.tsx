"use client";

/**
 * Formulario de nova conta, via TanStack Form.
 *
 * Diferente do lancamento rapido (que fica sem controle de campo de proposito,
 * para nao atrapalhar quem lanca varios seguidos), aqui vale a pena validar
 * antes de submeter: cadastrar conta e raro, e errar o saldo inicial custa caro
 * de corrigir depois.
 */

import { ACCOUNT_KIND_LABELS, type BankAccountKind } from "@aec/db";
import { todayInBrazil } from "@aec/domain";
import { useForm } from "@tanstack/react-form";
import { useTransition } from "react";

import { criarConta } from "@/lib/db/accounts";
import { Alert, Button, Field, Input, Select } from "@/lib/ui/components";

export function NovaContaForm({ companyId }: { companyId: string }) {
  const [pendente, iniciar] = useTransition();

  const form = useForm({
    defaultValues: {
      name: "",
      kind: "corrente" as BankAccountKind,
      bankName: "",
      branch: "",
      accountNumber: "",
      minimumBalance: "",
      openingBalance: "",
      openingBalanceDate: todayInBrazil(),
    },
    onSubmit: async ({ value, formApi }) => {
      const resultado = await criarConta({ companyId, ...value });
      if (!resultado.ok) {
        formApi.setErrorMap({ onSubmit: resultado.error ?? "Nao foi possivel cadastrar." });
        return;
      }
      formApi.reset();
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        iniciar(() => form.handleSubmit());
      }}
      className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(erro) =>
          erro ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <Alert tone="error">{String(erro)}</Alert>
            </div>
          ) : null
        }
      </form.Subscribe>

      <form.Field
        name="name"
        validators={{
          onChange: ({ value }) => (value.trim() ? undefined : "Informe o nome da conta"),
        }}
      >
        {(field) => (
          <Field
            label="Nome da conta"
            hint={field.state.meta.errors[0] ? String(field.state.meta.errors[0]) : undefined}
          >
            <Input
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              placeholder="Itau Corrente"
              required
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="kind">
        {(field) => (
          <Field label="Tipo">
            <Select
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value as BankAccountKind)}
            >
              {Object.entries(ACCOUNT_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form.Field>

      <form.Field name="bankName">
        {(field) => (
          <Field label="Banco">
            <Input
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="Banco Itau"
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="branch">
        {(field) => (
          <Field label="Agencia">
            <Input
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="accountNumber">
        {(field) => (
          <Field label="Conta">
            <Input
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="minimumBalance">
        {(field) => (
          <Field label="Saldo minimo" hint="Opcional. Alerta quando o saldo cair abaixo disso.">
            <Input
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </Field>
        )}
      </form.Field>

      <form.Field
        name="openingBalance"
        validators={{
          onChange: ({ value }) => (value.trim() ? undefined : "Informe o saldo inicial"),
        }}
      >
        {(field) => (
          <Field
            label="Saldo inicial"
            hint={
              field.state.meta.errors[0]
                ? String(field.state.meta.errors[0])
                : "O saldo da conta na data abaixo, como esta no extrato."
            }
          >
            <Input
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              required
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="openingBalanceDate">
        {(field) => (
          <Field
            label="Data do saldo inicial"
            hint="Lancamentos anteriores a esta data sao recusados: o saldo inicial ja os contem."
          >
            <Input
              type="date"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              required
            />
          </Field>
        )}
      </form.Field>

      <div className="flex items-end">
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" disabled={pendente || isSubmitting}>
              {pendente || isSubmitting ? "Cadastrando..." : "Cadastrar conta"}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}
