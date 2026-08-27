"use client";

/**
 * Cadastros: categorias, centros de custo, contrapartes e regras de
 * categorizacao aprendidas.
 *
 * Regras nao tem formulario de criacao aqui de proposito — elas nascem no
 * fluxo de conciliacao (app/(app)/[companyId]/conciliacao), no momento em
 * que a categoria certa ja esta escolhida na tela. Esta tela so lista o que
 * existe e deixa desativar o que parou de fazer sentido (fornecedor mudou
 * de nome no extrato, categoria criada por engano).
 *
 * Desativar, nao excluir: todas essas tabelas sao referenciadas por
 * lancamentos e regras existentes (chave composta com company_id), e
 * apagar quebraria esse historico. `is_active = false` tira do que aparece
 * daqui pra frente sem tocar no que ja existe.
 */

import {
  type Category,
  CATEGORY_KIND_LABELS,
  type CategoryKind,
  type CostCenter,
  type Counterparty,
  type MatchingRule,
} from "@aec/db";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@aec/ui";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  criarCategoria,
  criarCentroCusto,
  criarContraparte,
  desativarCategoria,
  desativarCentroCusto,
  desativarContraparte,
  desativarRegra,
} from "@/lib/db/cadastros";

import { RegrasList } from "./regras-list";

interface Feedback {
  readonly text: string;
  readonly tone: "success" | "error";
}

export function CadastrosClient({
  companyId,
  categories,
  costCenters,
  counterparties,
  matchingRules,
  canEditChartOfAccounts,
  canEditOperational,
}: {
  companyId: string;
  categories: readonly Category[];
  costCenters: readonly CostCenter[];
  counterparties: readonly Counterparty[];
  matchingRules: readonly MatchingRule[];
  canEditChartOfAccounts: boolean;
  canEditOperational: boolean;
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAction(action: () => Promise<{ ok: boolean; error?: string }>, successText: string) {
    startTransition(async () => {
      const result = await action();
      setFeedback(
        result.ok
          ? { text: successText, tone: "success" }
          : { text: result.error ?? "Nao foi possivel completar a acao.", tone: "error" },
      );
      if (result.ok) router.refresh();
    });
  }

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <div className="space-y-6">
      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      <Card>
        <CardHeader title={`Categorias (${categories.length})`} />
        <RecordTable
          items={categories}
          disabled={isPending}
          canEdit={canEditChartOfAccounts}
          emptyTitle="Nenhuma categoria cadastrada"
          emptyDescription="Categorias organizam entradas e saidas para relatorio e para a regra de categorizacao aprender."
          renderRow={(category) => (
            <>
              <span className="font-medium">{category.name}</span>
              <span className="text-muted-foreground text-xs">
                {CATEGORY_KIND_LABELS[category.kind]}
              </span>
            </>
          )}
          onDeactivate={(category) =>
            runAction(
              () => desativarCategoria(companyId, category.id),
              `Categoria "${category.name}" desativada.`,
            )
          }
        />
        {canEditChartOfAccounts && (
          <NewCategoryForm
            disabled={isPending}
            onSubmit={(name, kind) =>
              runAction(
                () => criarCategoria({ companyId, name, kind }),
                `Categoria "${name}" cadastrada.`,
              )
            }
          />
        )}
      </Card>

      <Card>
        <CardHeader title={`Centros de custo (${costCenters.length})`} />
        <RecordTable
          items={costCenters}
          disabled={isPending}
          canEdit={canEditChartOfAccounts}
          emptyTitle="Nenhum centro de custo cadastrado"
          emptyDescription="Opcional: use para separar resultado por obra, filial ou projeto."
          renderRow={(item) => <span className="font-medium">{item.name}</span>}
          onDeactivate={(item) =>
            runAction(
              () => desativarCentroCusto(companyId, item.id),
              `Centro de custo "${item.name}" desativado.`,
            )
          }
        />
        {canEditChartOfAccounts && (
          <SimpleNameForm
            disabled={isPending}
            placeholder="Ex.: Obra Copacabana"
            submitLabel="Cadastrar centro de custo"
            onSubmit={(name) =>
              runAction(
                () => criarCentroCusto({ companyId, name }),
                `Centro de custo "${name}" cadastrado.`,
              )
            }
          />
        )}
      </Card>

      <Card>
        <CardHeader title={`Contrapartes (${counterparties.length})`} />
        <RecordTable
          items={counterparties}
          disabled={isPending}
          canEdit={canEditOperational}
          emptyTitle="Nenhuma contraparte cadastrada"
          emptyDescription="Fornecedores e clientes recorrentes — util para relatorio e para a regra de categorizacao."
          renderRow={(item) => (
            <>
              <span className="font-medium">{item.name}</span>
              {item.tax_id && <span className="text-muted-foreground text-xs">{item.tax_id}</span>}
            </>
          )}
          onDeactivate={(item) =>
            runAction(
              () => desativarContraparte(companyId, item.id),
              `Contraparte "${item.name}" desativada.`,
            )
          }
        />
        {canEditOperational && (
          <NewCounterpartyForm
            disabled={isPending}
            onSubmit={(name, taxId) =>
              runAction(
                () => criarContraparte({ companyId, name, taxId }),
                `Contraparte "${name}" cadastrada.`,
              )
            }
          />
        )}
      </Card>

      <Card>
        <CardHeader title={`Regras de categorizacao aprendidas (${matchingRules.length})`} />
        <RegrasList
          matchingRules={matchingRules}
          categoryNameById={categoryNameById}
          canEdit={canEditOperational}
          disabled={isPending}
          onDeactivate={(rule) =>
            runAction(() => desativarRegra(companyId, rule.id), "Regra desativada.")
          }
        />
      </Card>
    </div>
  );
}

function RecordTable<T extends { id: string }>({
  items,
  disabled,
  canEdit,
  emptyTitle,
  emptyDescription,
  renderRow,
  onDeactivate,
}: {
  items: readonly T[];
  disabled: boolean;
  canEdit: boolean;
  emptyTitle: string;
  emptyDescription: string;
  renderRow: (item: T) => React.ReactNode;
  onDeactivate: (item: T) => void;
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="divide-border divide-y">
      {items.map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">{renderRow(item)}</div>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => onDeactivate(item)}
            >
              Desativar
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

function SimpleNameForm({
  disabled,
  placeholder,
  submitLabel,
  onSubmit,
}: {
  disabled: boolean;
  placeholder: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onSubmit(trimmed);
        setName("");
      }}
      className="border-border grid gap-3 border-t p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
    >
      <Field label="Nome">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
        />
      </Field>
      <Button type="submit" size="sm" disabled={disabled || !name.trim()}>
        {submitLabel}
      </Button>
    </form>
  );
}

function NewCategoryForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (name: string, kind: CategoryKind) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CategoryKind>("ambos");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onSubmit(trimmed, kind);
        setName("");
      }}
      className="border-border grid gap-3 border-t p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end"
    >
      <Field label="Nome">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex.: Honorarios"
          disabled={disabled}
        />
      </Field>
      <Field label="Vale para">
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as CategoryKind)}
          disabled={disabled}
        >
          {Object.entries(CATEGORY_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Button type="submit" size="sm" disabled={disabled || !name.trim()}>
        Cadastrar categoria
      </Button>
    </form>
  );
}

function NewCounterpartyForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (name: string, taxId: string | undefined) => void;
}) {
  const [name, setName] = useState("");
  const [taxId, setTaxId] = useState("");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) return;
        onSubmit(trimmed, taxId.trim() || undefined);
        setName("");
        setTaxId("");
      }}
      className="border-border grid gap-3 border-t p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
    >
      <Field label="Nome">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex.: Fornecedor Ltda"
          disabled={disabled}
        />
      </Field>
      <Field label="CPF ou CNPJ (opcional)">
        <Input
          value={taxId}
          onChange={(event) => setTaxId(event.target.value)}
          placeholder="Somente numeros"
          disabled={disabled}
        />
      </Field>
      <Button type="submit" size="sm" disabled={disabled || !name.trim()}>
        Cadastrar contraparte
      </Button>
    </form>
  );
}
