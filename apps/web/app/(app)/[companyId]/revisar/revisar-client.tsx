"use client";

/**
 * A fila: um item por vez, tela cheia, com contador de progresso e atalhos
 * de teclado. Reaproveita a mesma logica de dominio que /conciliacao usa
 * (matchStatement, categorize) — so a apresentacao e diferente: em vez de
 * um paredao com todas as linhas de uma vez, uma decisao por tela.
 */

import type { BankAccount, Category, MatchingRule, StatementLine, Transaction } from "@aec/db";
import {
  type Categorization,
  categorize,
  directionOf,
  formatBRL,
  fromDb,
  type Match,
  matchStatement,
  suggestRuleText,
} from "@aec/domain";
import { Alert, Button, Card, CardHeader, Checkbox, Field, Select } from "@aec/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

import { formatDate } from "@/lib/ui/format";

import {
  createMatchingRule,
  createTransactionFromLine,
  ignoreLine,
  reconcileLine,
} from "../conciliacao/actions";
import { toCategorizationRule } from "../conciliacao/categorization";

interface MatchItem {
  readonly kind: "match";
  readonly key: string;
  readonly line: StatementLine;
  readonly transaction: Transaction;
  readonly match: Match;
}

interface CategorizeItem {
  readonly kind: "categorize";
  readonly key: string;
  readonly line: StatementLine;
  readonly suggestion: Categorization;
}

type QueueItem = MatchItem | CategorizeItem;

export function RevisarClient({
  companyId,
  accounts,
  pendingLines,
  transactions,
  categories,
  matchingRules,
  canEdit,
}: {
  companyId: string;
  accounts: readonly BankAccount[];
  pendingLines: readonly StatementLine[];
  transactions: readonly Transaction[];
  categories: readonly Category[];
  matchingRules: readonly MatchingRule[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    text: string;
    tone: "success" | "warn" | "error";
  } | null>(null);

  const rules = useMemo(() => matchingRules.map(toCategorizationRule), [matchingRules]);

  // A mesma computacao que /conciliacao faz — so o formato de saida muda: em
  // vez de duas listas renderizadas ao mesmo tempo, uma fila unica ordenada
  // por data, um item por vez.
  const filaInicial = useMemo<QueueItem[]>(() => {
    const result = matchStatement(
      pendingLines.map((line) => ({
        id: line.id,
        postedAt: line.posted_at,
        amount: fromDb(line.amount),
        memo: line.memo,
      })),
      transactions.map((t) => ({
        id: t.id,
        bookingDate: t.booking_date,
        amount: fromDb(t.amount),
        description: t.description,
        documentNumber: t.document_number ?? undefined,
      })),
    );

    const lineById = new Map(pendingLines.map((line) => [line.id, line]));
    const transactionById = new Map(transactions.map((t) => [t.id, t]));

    const matchItems: MatchItem[] = [...result.matched, ...result.suggested].flatMap((match) => {
      const line = lineById.get(match.lineId);
      const transaction = transactionById.get(match.transactionId);
      return line && transaction
        ? [{ kind: "match" as const, key: line.id, line, transaction, match }]
        : [];
    });

    const categorizeItems: CategorizeItem[] = result.unmatchedLines.flatMap((unmatched) => {
      const line = lineById.get(unmatched.id);
      if (!line) return [];
      const suggestion = categorize(
        { memo: line.memo, amount: fromDb(line.amount), bankAccountId: line.bank_account_id },
        rules,
      );
      return [{ kind: "categorize" as const, key: line.id, line, suggestion }];
    });

    return [...matchItems, ...categorizeItems].sort((a, b) =>
      a.line.posted_at < b.line.posted_at ? -1 : a.line.posted_at > b.line.posted_at ? 1 : 0,
    );
  }, [pendingLines, transactions, rules]);

  const [fila, setFila] = useState(filaInicial);
  const [total] = useState(filaInicial.length);
  const [resumo, setResumo] = useState({ confirmados: 0, ignorados: 0 });

  // categoryDrafts/saveRuleDrafts sao "rascunho" do item atual, reiniciados
  // a cada mudanca de item (useState com key evita perder o valor entre
  // re-renders do mesmo item, mas zera ao trocar de item via a key abaixo).
  const atual = fila[0];

  const avancar = useCallback(() => {
    setFila((prev) => prev.slice(1));
  }, []);

  const pular = useCallback(() => {
    // Vai pro fim da fila local, nao desaparece — continua pendente no
    // banco, so nao trava a pessoa numa decisao que ela nao quer tomar
    // agora.
    setFila((prev) => (prev.length > 1 ? [...prev.slice(1), prev[0]!] : prev));
  }, []);

  const confirmarPareamento = useCallback(
    (item: MatchItem) => {
      startTransition(async () => {
        const result = await reconcileLine({
          companyId,
          statementLineId: item.line.id,
          transactionId: item.transaction.id,
        });
        if (!result.ok) {
          setFeedback({ text: result.error ?? "Não foi possível conciliar.", tone: "error" });
          return;
        }
        setResumo((prev) => ({ ...prev, confirmados: prev.confirmados + 1 }));
        avancar();
        router.refresh();
      });
    },
    [companyId, router, avancar],
  );

  function confirmarCategoria(
    item: CategorizeItem,
    categoryId: string | null,
    salvarRegra: boolean,
  ) {
    startTransition(async () => {
      const ruleId =
        categoryId !== null && categoryId === item.suggestion.categoryId
          ? item.suggestion.appliedRuleId
          : null;

      const result = await createTransactionFromLine({
        companyId,
        statementLineId: item.line.id,
        categoryId,
        ruleId,
      });
      if (!result.ok) {
        setFeedback({
          text: result.error ?? "Não foi possível criar o lançamento.",
          tone: "error",
        });
        return;
      }

      if (salvarRegra && categoryId && !ruleId) {
        const matchText = suggestRuleText(item.line.memo);
        if (matchText) {
          await createMatchingRule({
            companyId,
            matchText,
            categoryId,
            bankAccountId: item.line.bank_account_id,
            direction: directionOf(fromDb(item.line.amount)),
          });
        }
      }

      setResumo((prev) => ({ ...prev, confirmados: prev.confirmados + 1 }));
      avancar();
      router.refresh();
    });
  }

  function ignorar(item: CategorizeItem, motivo: string) {
    if (!motivo.trim()) {
      setFeedback({ text: "Informe o motivo para ignorar esta linha.", tone: "error" });
      return;
    }
    startTransition(async () => {
      const result = await ignoreLine({ companyId, statementLineId: item.line.id, reason: motivo });
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Não foi possível ignorar a linha.", tone: "error" });
        return;
      }
      setResumo((prev) => ({ ...prev, ignorados: prev.ignorados + 1 }));
      avancar();
      router.refresh();
    });
  }

  // Atalhos de teclado — so quando o foco nao esta num campo de texto/select,
  // pra nao atrapalhar quem esta digitando um motivo ou escolhendo categoria.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (!atual || isPending) return;

      if (event.key === "Enter" && atual.kind === "match") {
        event.preventDefault();
        confirmarPareamento(atual);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        pular();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [atual, isPending, confirmarPareamento, pular]);

  if (accounts.length === 0) {
    return (
      <Alert tone="warn">
        Cadastre uma conta antes de revisar — a conciliação sempre acontece dentro de uma conta
        bancária.
      </Alert>
    );
  }

  if (!atual) {
    return (
      <Card>
        <div className="flex flex-col items-center gap-2 p-12 text-center">
          <p className="text-lg font-semibold">Fila vazia</p>
          <p className="text-muted-foreground text-sm">
            {total > 0
              ? `${resumo.confirmados} confirmado(s), ${resumo.ignorados} ignorado(s) nesta sessão.`
              : "Não há nada esperando revisão agora — o sistema já resolveu tudo que tinha certeza."}
          </p>
        </div>
      </Card>
    );
  }

  const progresso = total - fila.length + 1;

  return (
    <div className="space-y-4">
      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      <div className="space-y-1.5">
        <p className="text-muted-foreground text-xs">
          {progresso} de {total}
        </p>
        <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-primary h-full rounded-full transition-all"
            style={{ width: `${(progresso / total) * 100}%` }}
          />
        </div>
      </div>

      {atual.kind === "match" ? (
        <PareamentoCard
          key={atual.key}
          item={atual}
          disabled={!canEdit || isPending}
          onConfirmar={() => confirmarPareamento(atual)}
          onPular={pular}
        />
      ) : (
        <CategorizacaoCard
          key={atual.key}
          item={atual}
          categories={categories}
          disabled={!canEdit || isPending}
          onConfirmar={(categoryId, salvarRegra) =>
            confirmarCategoria(atual, categoryId, salvarRegra)
          }
          onIgnorar={(motivo) => ignorar(atual, motivo)}
          onPular={pular}
        />
      )}
    </div>
  );
}

function PareamentoCard({
  item,
  disabled,
  onConfirmar,
  onPular,
}: {
  item: MatchItem;
  disabled: boolean;
  onConfirmar: () => void;
  onPular: () => void;
}) {
  return (
    <Card>
      <CardHeader
        title={item.match.confidence === "exact" ? "Coincidência exata" : "Pareamento sugerido"}
      />
      <div className="grid gap-4 p-6">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="border-border rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">No extrato</p>
            <p className="mt-1 text-sm font-medium">
              {item.line.memo || "Movimento sem histórico"}
            </p>
            <p className="text-muted-foreground text-sm">
              {formatDate(item.line.posted_at)} · {formatBRL(fromDb(item.line.amount))}
            </p>
          </div>
          <div className="border-border rounded-lg border p-3">
            <p className="text-muted-foreground text-xs">Lançamento candidato</p>
            <p className="mt-1 text-sm font-medium">{item.transaction.description}</p>
            <p className="text-muted-foreground text-sm">
              {formatDate(item.transaction.booking_date)} ·{" "}
              {formatBRL(fromDb(item.transaction.amount))}
            </p>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">Motivo: {item.match.reason}</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" disabled={disabled} onClick={onConfirmar}>
            Confirmar
          </Button>
          <Button variant="ghost" disabled={disabled} onClick={onPular}>
            Pular
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          Atalho: <kbd className="bg-muted rounded px-1">Enter</kbd> confirma,{" "}
          <kbd className="bg-muted rounded px-1">→</kbd> pula.
        </p>
      </div>
    </Card>
  );
}

function CategorizacaoCard({
  item,
  categories,
  disabled,
  onConfirmar,
  onIgnorar,
  onPular,
}: {
  item: CategorizeItem;
  categories: readonly Category[];
  disabled: boolean;
  onConfirmar: (categoryId: string | null, salvarRegra: boolean) => void;
  onIgnorar: (motivo: string) => void;
  onPular: () => void;
}) {
  const [categoryId, setCategoryId] = useState(item.suggestion.categoryId ?? "");
  const [salvarRegra, setSalvarRegra] = useState(true);
  const [ignorando, setIgnorando] = useState(false);
  const [motivo, setMotivo] = useState("");

  return (
    <Card>
      <CardHeader title="Escolher categoria" />
      <div className="grid gap-4 p-6">
        <div className="border-border rounded-lg border p-3">
          <p className="text-sm font-medium">{item.line.memo || "Movimento sem histórico"}</p>
          <p className="text-muted-foreground text-sm">
            {formatDate(item.line.posted_at)} · {formatBRL(fromDb(item.line.amount))}
          </p>
        </div>

        <Field label="Categoria">
          <Select
            value={categoryId}
            disabled={disabled}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Sem categoria</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <Checkbox
            checked={salvarRegra}
            disabled={disabled || !categoryId}
            onCheckedChange={(checked) => setSalvarRegra(checked === true)}
            className="mt-0.5"
          />
          <span>
            Salvar como regra automática — da próxima vez que um movimento parecido aparecer, já vem
            categorizado sozinho. Você pode desligar isso depois em Regras.
          </span>
        </label>

        {ignorando ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Field label="Motivo para ignorar">
              <input
                type="text"
                autoFocus
                placeholder="Ex.: já lançada na conta Bradesco"
                value={motivo}
                onChange={(event) => setMotivo(event.target.value)}
                className="border-input bg-card w-full rounded-md border px-3 py-2 text-sm"
              />
            </Field>
            <Button
              variant="ghost"
              disabled={disabled}
              onClick={() => onIgnorar(motivo)}
              className="self-end"
            >
              Confirmar ignorar
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="flex-1"
              disabled={disabled}
              onClick={() => onConfirmar(categoryId || null, salvarRegra)}
            >
              Criar lançamento
            </Button>
            <Button variant="ghost" disabled={disabled} onClick={onPular}>
              Pular
            </Button>
            <Button variant="ghost" disabled={disabled} onClick={() => setIgnorando(true)}>
              Ignorar
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
