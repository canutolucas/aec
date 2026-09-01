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
 * daqui pra frente sem tocar no que ja existe — e, ate esta leva, era uma
 * porta so de ida: nao havia como reativar nem como so ver o que estava
 * inativo sem consultar o banco direto.
 */

import {
  type Category,
  CATEGORY_KIND_LABELS,
  type CategoryKind,
  type CostCenter,
  type Counterparty,
  type MatchingRule,
} from "@aec/db";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Input, Select } from "@aec/ui";
import { useRouter } from "next/navigation";
import { type ReactNode, useState, useTransition } from "react";

import {
  criarCategoria,
  criarCentroCusto,
  criarContraparte,
  definirCategoriaAtiva,
  definirCentroCustoAtivo,
  definirContraparteAtiva,
  desativarRegra,
  editarCategoria,
  editarCentroCusto,
  editarContraparte,
} from "@/lib/db/cadastros";
import { routes, withQuery } from "@/lib/ui/routes";

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
  mostrarInativos,
  canEditChartOfAccounts,
  canEditOperational,
}: {
  companyId: string;
  categories: readonly Category[];
  costCenters: readonly CostCenter[];
  counterparties: readonly Counterparty[];
  matchingRules: readonly MatchingRule[];
  mostrarInativos: boolean;
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
      <div className="flex items-center justify-between gap-3">
        {feedback ? (
          <div className="flex-1">
            <Alert tone={feedback.tone}>{feedback.text}</Alert>
          </div>
        ) : (
          <span />
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            router.push(
              withQuery(routes.registries(companyId), {
                inativos: mostrarInativos ? undefined : "1",
              }),
            )
          }
        >
          {mostrarInativos ? "Ocultar inativos" : "Ver inativos"}
        </Button>
      </div>

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
              {!category.is_active && <Badge>inativa</Badge>}
            </>
          )}
          renderForm={(category, onFechar) => (
            <EditarCategoriaForm companyId={companyId} categoria={category} onSalvo={onFechar} />
          )}
          onToggleActive={(category) =>
            runAction(
              () => definirCategoriaAtiva(companyId, category.id, !category.is_active),
              `Categoria "${category.name}" ${category.is_active ? "desativada" : "reativada"}.`,
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
          renderRow={(item) => (
            <>
              <span className="font-medium">{item.name}</span>
              {!item.is_active && <Badge>inativo</Badge>}
            </>
          )}
          renderForm={(item, onFechar) => (
            <EditarCentroCustoForm companyId={companyId} item={item} onSalvo={onFechar} />
          )}
          onToggleActive={(item) =>
            runAction(
              () => definirCentroCustoAtivo(companyId, item.id, !item.is_active),
              `Centro de custo "${item.name}" ${item.is_active ? "desativado" : "reativado"}.`,
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
        <CardHeader title={`Clientes e fornecedores (${counterparties.length})`} />
        <RecordTable
          items={counterparties}
          disabled={isPending}
          canEdit={canEditOperational}
          emptyTitle="Nenhum cliente ou fornecedor cadastrado"
          emptyDescription="Fornecedores e clientes recorrentes — útil para relatório e para a regra de categorização."
          renderRow={(item) => (
            <>
              <span className="font-medium">{item.name}</span>
              {item.tax_id && <span className="text-muted-foreground text-xs">{item.tax_id}</span>}
              {!item.is_active && <Badge>inativo</Badge>}
            </>
          )}
          renderForm={(item, onFechar) => (
            <EditarContraparteForm companyId={companyId} item={item} onSalvo={onFechar} />
          )}
          onToggleActive={(item) =>
            runAction(
              () => definirContraparteAtiva(companyId, item.id, !item.is_active),
              `"${item.name}" ${item.is_active ? "desativado(a)" : "reativado(a)"}.`,
            )
          }
        />
        {canEditOperational && (
          <NewCounterpartyForm
            disabled={isPending}
            onSubmit={(name, taxId) =>
              runAction(
                () => criarContraparte({ companyId, name, taxId }),
                `"${name}" cadastrado(a).`,
              )
            }
          />
        )}
      </Card>

      <Card>
        <CardHeader title={`Regras de categorização aprendidas (${matchingRules.length})`} />
        <RegrasList
          companyId={companyId}
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

function RecordTable<T extends { id: string; is_active: boolean }>({
  items,
  disabled,
  canEdit,
  emptyTitle,
  emptyDescription,
  renderRow,
  renderForm,
  onToggleActive,
}: {
  items: readonly T[];
  disabled: boolean;
  canEdit: boolean;
  emptyTitle: string;
  emptyDescription: string;
  renderRow: (item: T) => ReactNode;
  renderForm: (item: T, onFechar: () => void) => ReactNode;
  onToggleActive: (item: T) => void;
}) {
  const [editandoId, setEditandoId] = useState<string | null>(null);

  if (items.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <div className="divide-border divide-y">
      {items.map((item) => {
        const emEdicao = editandoId === item.id;
        return (
          <div key={item.id} className={item.is_active ? undefined : "opacity-60"}>
            <div className="flex items-center justify-between gap-3 p-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">{renderRow(item)}</div>
              {canEdit && (
                <div className="flex shrink-0 gap-2">
                  {item.is_active && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => setEditandoId(emEdicao ? null : item.id)}
                    >
                      {emEdicao ? "Fechar" : "Editar"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => onToggleActive(item)}
                  >
                    {item.is_active ? "Desativar" : "Reativar"}
                  </Button>
                </div>
              )}
            </div>
            {emEdicao && (
              <div className="bg-muted/30 px-4 pb-4">
                {renderForm(item, () => setEditandoId(null))}
              </div>
            )}
          </div>
        );
      })}
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
      <Field label="Nome do cliente ou fornecedor">
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
          placeholder="Somente números"
          disabled={disabled}
        />
      </Field>
      <Button type="submit" size="sm" disabled={disabled || !name.trim()}>
        Cadastrar
      </Button>
    </form>
  );
}

function EditarCategoriaForm({
  companyId,
  categoria,
  onSalvo,
}: {
  companyId: string;
  categoria: Category;
  onSalvo: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(categoria.name);
  const [kind, setKind] = useState<CategoryKind>(categoria.kind);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function salvar() {
    startTransition(async () => {
      const resultado = await editarCategoria({ companyId, id: categoria.id, name, kind });
      if (!resultado.ok) {
        setErro(resultado.error ?? "Nao foi possivel salvar.");
        return;
      }
      setErro(null);
      router.refresh();
      onSalvo();
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
      {erro && (
        <div className="sm:col-span-4">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}
      <Field label="Nome">
        <Input value={name} onChange={(event) => setName(event.target.value)} disabled={pending} />
      </Field>
      <Field label="Vale para">
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as CategoryKind)}
          disabled={pending}
        >
          {Object.entries(CATEGORY_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>
      <Button size="sm" disabled={pending || !name.trim()} onClick={salvar}>
        {pending ? "Salvando..." : "Salvar"}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onSalvo}>
        Cancelar
      </Button>
    </div>
  );
}

function EditarCentroCustoForm({
  companyId,
  item,
  onSalvo,
}: {
  companyId: string;
  item: CostCenter;
  onSalvo: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(item.name);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function salvar() {
    startTransition(async () => {
      const resultado = await editarCentroCusto({ companyId, id: item.id, name });
      if (!resultado.ok) {
        setErro(resultado.error ?? "Nao foi possivel salvar.");
        return;
      }
      setErro(null);
      router.refresh();
      onSalvo();
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
      {erro && (
        <div className="sm:col-span-3">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}
      <Field label="Nome">
        <Input value={name} onChange={(event) => setName(event.target.value)} disabled={pending} />
      </Field>
      <Button size="sm" disabled={pending || !name.trim()} onClick={salvar}>
        {pending ? "Salvando..." : "Salvar"}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onSalvo}>
        Cancelar
      </Button>
    </div>
  );
}

function EditarContraparteForm({
  companyId,
  item,
  onSalvo,
}: {
  companyId: string;
  item: Counterparty;
  onSalvo: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(item.name);
  const [taxId, setTaxId] = useState(item.tax_id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function salvar() {
    startTransition(async () => {
      const resultado = await editarContraparte({
        companyId,
        id: item.id,
        name,
        taxId: taxId.trim() || undefined,
      });
      if (!resultado.ok) {
        setErro(resultado.error ?? "Nao foi possivel salvar.");
        return;
      }
      setErro(null);
      router.refresh();
      onSalvo();
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto] sm:items-end">
      {erro && (
        <div className="sm:col-span-4">
          <Alert tone="error">{erro}</Alert>
        </div>
      )}
      <Field label="Nome">
        <Input value={name} onChange={(event) => setName(event.target.value)} disabled={pending} />
      </Field>
      <Field label="CPF ou CNPJ (opcional)">
        <Input
          value={taxId}
          onChange={(event) => setTaxId(event.target.value)}
          placeholder="Somente números"
          disabled={pending}
        />
      </Field>
      <Button size="sm" disabled={pending || !name.trim()} onClick={salvar}>
        {pending ? "Salvando..." : "Salvar"}
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={onSalvo}>
        Cancelar
      </Button>
    </div>
  );
}
