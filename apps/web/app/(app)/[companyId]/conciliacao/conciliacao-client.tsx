"use client";

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
import { type CanonicalStatement, toMatchableLines } from "@aec/statements";
import { Alert, Badge, Button, Card, CardHeader, EmptyState, Field, Select } from "@aec/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import {
  autoApplyReconciliation,
  createMatchingRule,
  createTransactionFromLine,
  ignoreLine,
  importStatement,
  reconcileLine,
  unreconcileLine,
} from "./actions";
import { toCategorizationRule } from "./categorization";
import type { BalanceCheck } from "./page";
import { parseStatementFile, statementToImportPayload } from "./parse-file";

interface SuggestedMatch extends Match {
  readonly line: StatementLine;
  readonly transaction: Transaction;
}

export function ReconciliationClient({
  companyId,
  accounts,
  pendingLines,
  reconciledLines,
  transactions,
  categories,
  matchingRules,
  balanceChecks,
  canEdit,
}: {
  companyId: string;
  accounts: readonly BankAccount[];
  pendingLines: readonly StatementLine[];
  reconciledLines: readonly StatementLine[];
  transactions: readonly Transaction[];
  categories: readonly Category[];
  matchingRules: readonly MatchingRule[];
  balanceChecks: readonly BalanceCheck[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [statement, setStatement] = useState<CanonicalStatement | null>(null);
  const [fileName, setFileName] = useState("");
  // Tone travels with the message instead of being guessed back from its
  // text (matching against substrings like "criado" broke the moment a
  // message needed to report a partial failure inside an otherwise
  // successful action — see createFromLine below).
  const [feedback, setFeedback] = useState<{
    text: string;
    tone: "success" | "warn" | "error";
  } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Draft state for the divergence panel: one category choice, one ignore
  // reason and one "save as rule" toggle per pending line, keyed by line id.
  const [categoryDrafts, setCategoryDrafts] = useState<Record<string, string>>({});
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({});
  const [saveRuleDrafts, setSaveRuleDrafts] = useState<Record<string, boolean>>({});

  const rules = useMemo(() => matchingRules.map(toCategorizationRule), [matchingRules]);

  const { suggestions, unmatchedLines, unmatchedTransactions } = useMemo(() => {
    const selectedLines = pendingLines.filter((line) => line.bank_account_id === accountId);
    const selectedTransactions = transactions.filter(
      (transaction) => transaction.bank_account_id === accountId,
    );
    const result = matchStatement(
      selectedLines.map((line) => ({
        id: line.id,
        postedAt: line.posted_at,
        amount: fromDb(line.amount),
        memo: line.memo,
      })),
      selectedTransactions.map((transaction) => ({
        id: transaction.id,
        bookingDate: transaction.booking_date,
        amount: fromDb(transaction.amount),
        description: transaction.description,
        documentNumber: transaction.document_number ?? undefined,
      })),
    );
    const lineById = new Map(selectedLines.map((line) => [line.id, line]));
    const transactionById = new Map(
      selectedTransactions.map((transaction) => [transaction.id, transaction]),
    );
    const suggestions = [...result.matched, ...result.suggested].flatMap(
      (match): SuggestedMatch[] => {
        const line = lineById.get(match.lineId);
        const transaction = transactionById.get(match.transactionId);
        return line && transaction ? [{ ...match, line, transaction }] : [];
      },
    );
    const unmatchedLines = result.unmatchedLines.flatMap((line) => {
      const full = lineById.get(line.id);
      return full ? [full] : [];
    });
    const unmatchedTransactions = result.unmatchedTransactions.flatMap((transaction) => {
      const full = transactionById.get(transaction.id);
      return full ? [full] : [];
    });
    return { suggestions, unmatchedLines, unmatchedTransactions };
  }, [accountId, pendingLines, transactions]);

  const reconciledForAccount = reconciledLines.filter((line) => line.bank_account_id === accountId);
  const balanceCheck = balanceChecks.find((check) => check.bankAccountId === accountId);

  // Computed once per [unmatchedLines, rules] change instead of inline in the
  // render loop below — categorize() walks the whole rules set per line, so
  // recomputing it for every line on every keystroke in an unrelated draft
  // input (a category pick, an ignore reason) scales with lines × rules for
  // no reason once there are hundreds of unmatched lines pending review.
  const suggestionByLineId = useMemo(() => {
    const map = new Map<string, Categorization>();
    for (const line of unmatchedLines) {
      map.set(
        line.id,
        categorize(
          { memo: line.memo, amount: fromDb(line.amount), bankAccountId: line.bank_account_id },
          rules,
        ),
      );
    }
    return map;
  }, [unmatchedLines, rules]);

  async function readFile(file: File | undefined) {
    if (!file) return;
    setFeedback(null);
    setStatement(null);
    setFileName(file.name);

    const result = await parseStatementFile(companyId, file);
    if (!result.ok) {
      setFeedback({ text: result.error, tone: "error" });
      return;
    }
    setStatement(result.statement);
  }

  function importPreview() {
    if (!statement || !accountId) return;
    startTransition(async () => {
      const result = await importStatement({
        companyId,
        bankAccountId: accountId,
        fileName,
        payload: statementToImportPayload(statement),
      });
      if (!result.ok) {
        setFeedback({
          text: result.error ?? "Nao foi possivel importar o extrato.",
          tone: "error",
        });
        return;
      }
      setStatement(null);

      // Sem isto, toda linha do extrato (mesmo pareamento exato ou regra ja
      // aprendida com categoria) ficava esperando um clique manual de
      // "Confirmar"/"Criar lancamento" uma por uma — o mesmo
      // autoApplyReconciliation que o modo simples ja usa resolve sozinho o
      // que o sistema ja tem certeza; so sobra revisao manual pro que
      // realmente precisa de decisao humana.
      const applied = await autoApplyReconciliation({ companyId, bankAccountId: accountId });
      const parts: string[] = [];
      if (applied.ok) {
        if ((applied.reconciled ?? 0) > 0) {
          parts.push(`${applied.reconciled} pareamento(s) confirmado(s) automaticamente`);
        }
        if ((applied.created ?? 0) > 0) {
          parts.push(`${applied.created} lançamento(s) criado(s) automaticamente`);
        }
      }
      const suffix = parts.length > 0 ? ` ${parts.join(" e ")}.` : "";
      setFeedback({
        text: `Extrato importado.${suffix} Revise o que sobrou abaixo.`,
        tone: "success",
      });
      router.refresh();
    });
  }

  function runAutoApply() {
    startTransition(async () => {
      const result = await autoApplyReconciliation({ companyId, bankAccountId: accountId });
      if (!result.ok) {
        setFeedback({
          text: result.error ?? "Nao foi possivel aplicar automaticamente.",
          tone: "error",
        });
        return;
      }
      const parts: string[] = [];
      if ((result.reconciled ?? 0) > 0) {
        parts.push(`${result.reconciled} pareamento(s) confirmado(s)`);
      }
      if ((result.created ?? 0) > 0) parts.push(`${result.created} lançamento(s) criado(s)`);
      const failedCount = result.exceptions?.failed.length ?? 0;
      setFeedback({
        text:
          parts.length > 0
            ? `Aplicado automaticamente: ${parts.join(" e ")}.` +
              (failedCount > 0 ? ` ${failedCount} não pôde(pôderam) ser aplicado(s).` : "")
            : "Nada que o sistema já tenha certeza para aplicar agora.",
        tone: failedCount > 0 ? "warn" : "success",
      });
      router.refresh();
    });
  }

  function acceptMatch(match: SuggestedMatch) {
    startTransition(async () => {
      const result = await reconcileLine({
        companyId,
        statementLineId: match.line.id,
        transactionId: match.transaction.id,
      });
      setFeedback(
        result.ok
          ? { text: "Lancamento conciliado.", tone: "success" }
          : { text: result.error ?? "Nao foi possivel conciliar.", tone: "error" },
      );
      if (result.ok) router.refresh();
    });
  }

  function undoMatch(line: StatementLine) {
    startTransition(async () => {
      const result = await unreconcileLine({ companyId, statementLineId: line.id });
      setFeedback(
        result.ok
          ? { text: "Conciliacao desfeita.", tone: "success" }
          : { text: result.error ?? "Nao foi possivel desfazer.", tone: "error" },
      );
      if (result.ok) router.refresh();
    });
  }

  function createFromLine(
    line: StatementLine,
    categoryId: string | null,
    suggestion: Categorization,
  ) {
    const saveRule = saveRuleDrafts[line.id] ?? false;
    // The rule only gets credit for a hit when the category actually being
    // submitted is still the one it suggested — if the person picked a
    // different category by hand, this creation didn't come from the rule.
    const ruleId =
      categoryId !== null && categoryId === suggestion.categoryId ? suggestion.appliedRuleId : null;

    startTransition(async () => {
      const result = await createTransactionFromLine({
        companyId,
        statementLineId: line.id,
        categoryId,
        ruleId,
      });
      if (!result.ok) {
        setFeedback({
          text: result.error ?? "Nao foi possivel criar o lancamento.",
          tone: "error",
        });
        return;
      }

      let ruleMessage = "";
      let ruleFailed = false;
      if (saveRule && categoryId) {
        const matchText = suggestRuleText(line.memo);
        if (matchText) {
          const ruleResult = await createMatchingRule({
            companyId,
            matchText,
            categoryId,
            bankAccountId: line.bank_account_id,
            direction: directionOf(fromDb(line.amount)),
          });
          // The transaction is already created at this point — a failed rule
          // save is a real but secondary problem, so it's appended to the
          // success message (with a warn tone) rather than reported as if
          // the whole action had failed.
          if (!ruleResult.ok) {
            ruleFailed = true;
            ruleMessage = ` A regra de categorização não foi salva: ${ruleResult.error ?? "erro desconhecido"}.`;
          }
        }
      }

      setFeedback({
        text: `Lancamento criado a partir do extrato.${ruleMessage}`,
        tone: ruleFailed ? "warn" : "success",
      });
      router.refresh();
    });
  }

  function ignoreFromLine(line: StatementLine) {
    const reason = (reasonDrafts[line.id] ?? "").trim();
    if (!reason) {
      setFeedback({ text: "Informe o motivo para ignorar esta linha.", tone: "error" });
      return;
    }
    startTransition(async () => {
      const result = await ignoreLine({ companyId, statementLineId: line.id, reason });
      setFeedback(
        result.ok
          ? { text: "Linha ignorada.", tone: "success" }
          : { text: result.error ?? "Nao foi possivel ignorar a linha.", tone: "error" },
      );
      if (result.ok) router.refresh();
    });
  }

  // Memoized: without it, every keystroke in an unrelated draft input
  // (a category pick, an ignore reason) re-renders this component and
  // reruns matchStatement over the whole preview statement again — visible
  // input lag once a statement has a few thousand lines.
  const previewMatch = useMemo(
    () =>
      statement
        ? matchStatement(
            toMatchableLines(statement),
            transactions
              .filter((transaction) => transaction.bank_account_id === accountId)
              .map((transaction) => ({
                id: transaction.id,
                bookingDate: transaction.booking_date,
                amount: fromDb(transaction.amount),
                description: transaction.description,
                documentNumber: transaction.document_number ?? undefined,
              })),
          )
        : null,
    [statement, accountId, transactions],
  );

  if (accounts.length === 0) {
    return (
      <EmptyState
        title="Cadastre uma conta antes de importar"
        description="A conciliacao sempre acontece dentro de uma conta bancaria, para nao misturar movimentacoes de bancos diferentes."
      />
    );
  }

  return (
    <div className="space-y-6">
      {feedback && <Alert tone={feedback.tone}>{feedback.text}</Alert>}

      <Card>
        <CardHeader title="Importar extrato" />
        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Field label="Conta bancaria">
            <Select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              disabled={!canEdit}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                  {account.bank_name ? ` — ${account.bank_name}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Arquivo OFX, QFX, CSV ou PDF do Cora"
            hint="CSV precisa ter colunas de data, historico e valor."
          >
            <input
              type="file"
              // Extension-only, deliberately: `application/x-ofx` isn't a
              // real registered MIME type (there's no standard one for
              // OFX), and mixing it into `accept` alongside real ones is a
              // known WebKit/iOS bug — Safari on iPhone/iPad doesn't just
              // ignore the type it can't recognize, it degrades the whole
              // input's file-type filtering, greying out CSV too and
              // leaving only PDF (a type iOS is certain about) selectable.
              // Extensions alone match reliably everywhere, and the file is
              // identified by name/content after selection regardless (see
              // readFile below), never by the browser-reported MIME type.
              accept=".ofx,.qfx,.csv,.pdf"
              disabled={!canEdit || isPending}
              onChange={(event) => void readFile(event.target.files?.[0])}
              className="border-input bg-card block w-full rounded-md border px-3 py-2 text-sm"
            />
          </Field>
        </div>

        {statement && (
          <div className="border-border border-t p-4">
            <p className="font-medium">
              Prévia: {statement.lines.length} movimentações encontradas
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {previewMatch?.matched.length ?? 0} pareamentos exatos e{" "}
              {previewMatch?.suggested.length ?? 0} sugestões. A confirmação continua manual.
            </p>
            {statement.integrity && !statement.integrity.ok && (
              <Alert tone="warn" title="Confira o arquivo antes de importar">
                {statement.integrity.problems.join(" ")}
              </Alert>
            )}
            {statement.warnings.length > 0 && (
              <p className="text-warning mt-3 text-sm">{statement.warnings.join(" ")}</p>
            )}
            <div className="mt-4">
              <Button onClick={importPreview} disabled={isPending || !canEdit}>
                {isPending ? "Importando..." : "Importar e revisar"}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {balanceCheck && (
        <Card>
          <CardHeader title="Conferência de saldo" />
          <div className="grid gap-4 p-4 sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground text-xs">
                Saldo do extrato em {balanceCheck.declaredDate}
              </p>
              <p className="font-mono text-lg font-semibold tabular-nums">
                {formatBRL(balanceCheck.declaredBalance)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Saldo calculado pelo sistema</p>
              <p className="font-mono text-lg font-semibold tabular-nums">
                {formatBRL(balanceCheck.computedBalance)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Diferença</p>
              <p
                className={
                  "font-mono text-lg font-semibold tabular-nums " +
                  (balanceCheck.diff === 0 ? "text-inflow" : "text-outflow")
                }
              >
                {formatBRL(balanceCheck.diff)}
              </p>
            </div>
          </div>
          {balanceCheck.diff !== 0 && (
            <div className="px-4 pb-4">
              <Alert tone="warn">
                O saldo do sistema nao bate com o saldo declarado pelo extrato. Confira as
                divergências abaixo antes de considerar o mês fechado.
              </Alert>
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader
          title={`Sugestões de conciliação (${suggestions.length})`}
          action={
            (suggestions.length > 0 || unmatchedLines.length > 0) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={runAutoApply}
                disabled={!canEdit || isPending}
              >
                Aplicar automaticamente
              </Button>
            )
          }
        />
        {(suggestions.length > 0 || unmatchedLines.length > 0) && (
          <p className="text-muted-foreground px-4 pt-3 text-xs">
            Confirma pareamento exato e cria lançamento onde já existe regra com categoria — nas
            duas seções abaixo. Só fica pra revisar na mão o que o sistema não tem certeza.
          </p>
        )}
        {suggestions.length === 0 ? (
          <EmptyState
            title="Nenhuma sugestão pendente"
            description="Importe um extrato ou lance os movimentos para que o sistema encontre valores e datas correspondentes."
          />
        ) : (
          <div className="divide-border divide-y">
            {suggestions.map((match) => (
              <div
                key={match.line.id}
                className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
              >
                <div className="grid gap-1 text-sm">
                  <p className="font-medium">{match.line.memo || "Movimento sem historico"}</p>
                  <p className="text-muted-foreground">
                    Extrato: {match.line.posted_at} · {formatBRL(fromDb(match.line.amount))}
                  </p>
                  <p className="text-muted-foreground">
                    Lançamento: {match.transaction.booking_date} · {match.transaction.description} ·{" "}
                    {formatBRL(fromDb(match.transaction.amount))}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {match.confidence === "exact" ? "Coincidência exata" : "Sugestão"}:{" "}
                    {match.reason}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={match.confidence === "exact" ? "primary" : "secondary"}
                  onClick={() => acceptMatch(match)}
                  disabled={!canEdit || isPending}
                >
                  {isPending ? "Salvando..." : "Confirmar"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={`No extrato, sem lançamento (${unmatchedLines.length})`} />
        {unmatchedLines.length === 0 ? (
          <EmptyState
            title="Nenhuma linha sem par"
            description="Toda linha pendente do extrato encontrou uma sugestão de pareamento acima."
          />
        ) : (
          <div className="divide-border divide-y">
            {unmatchedLines.map((line) => {
              // Always present: suggestionByLineId is built from this same
              // unmatchedLines array, one entry per line, right above.
              const suggested = suggestionByLineId.get(line.id)!;
              const categoryId = categoryDrafts[line.id] ?? suggested.categoryId ?? "";

              return (
                <div key={line.id} className="grid gap-3 p-4">
                  <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                    <div>
                      <p className="font-medium">{line.memo || "Movimento sem historico"}</p>
                      <p className="text-muted-foreground text-sm">
                        {line.posted_at} · {formatBRL(fromDb(line.amount))}
                      </p>
                    </div>
                    {suggested.appliedRuleId && (
                      <Badge tone="info">Categoria sugerida por regra</Badge>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                    <Field label="Categoria (opcional)">
                      <Select
                        value={categoryId}
                        disabled={!canEdit || isPending}
                        onChange={(event) =>
                          setCategoryDrafts((prev) => ({ ...prev, [line.id]: event.target.value }))
                        }
                      >
                        <option value="">Sem categoria</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={saveRuleDrafts[line.id] ?? false}
                        disabled={!canEdit || isPending || !categoryId}
                        onChange={(event) =>
                          setSaveRuleDrafts((prev) => ({
                            ...prev,
                            [line.id]: event.target.checked,
                          }))
                        }
                      />
                      Salvar como regra
                    </label>

                    <Button
                      size="sm"
                      onClick={() => createFromLine(line, categoryId || null, suggested)}
                      disabled={!canEdit || isPending}
                    >
                      Criar lançamento
                    </Button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <Field label="Motivo para ignorar">
                      <input
                        type="text"
                        placeholder="Ex.: ja lancada na conta Bradesco"
                        value={reasonDrafts[line.id] ?? ""}
                        disabled={!canEdit || isPending}
                        onChange={(event) =>
                          setReasonDrafts((prev) => ({ ...prev, [line.id]: event.target.value }))
                        }
                        className="border-input bg-card w-full rounded-md border px-3 py-2 text-sm"
                      />
                    </Field>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => ignoreFromLine(line)}
                      disabled={!canEdit || isPending}
                    >
                      Ignorar
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {unmatchedTransactions.length > 0 && (
        <Card>
          <CardHeader title={`Lançado, sem extrato (${unmatchedTransactions.length})`} />
          <Alert tone="info">
            Esses lançamentos não têm linha correspondente no extrato importado. Costuma ser erro de
            digitação ou lançamento em conta errada — vale conferir.
          </Alert>
          <div className="divide-border divide-y">
            {unmatchedTransactions.map((transaction) => (
              <div key={transaction.id} className="p-4 text-sm">
                <p className="font-medium">{transaction.description}</p>
                <p className="text-muted-foreground">
                  {transaction.booking_date} · {formatBRL(fromDb(transaction.amount))}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {reconciledForAccount.length > 0 && (
        <Card>
          <CardHeader title="Conciliadas recentemente" />
          <div className="divide-border divide-y">
            {reconciledForAccount.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-3 p-4 text-sm">
                <div>
                  <p className="font-medium">{line.memo || "Movimento sem historico"}</p>
                  <p className="text-muted-foreground">
                    {line.posted_at} · {formatBRL(fromDb(line.amount))} ·{" "}
                    {line.status === "criada" ? "lançamento criado" : "conciliada"}
                  </p>
                </div>
                {/* Uma linha "criada" gerou um lançamento novo, que continua existindo:
                    desfazer aqui deixaria a linha pendente apontando para nada. Quem
                    quiser reverter isso exclui o lançamento na tela de Lançamentos. */}
                {line.status === "conciliada" ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => undoMatch(line)}
                    disabled={!canEdit || isPending}
                  >
                    Desfazer
                  </Button>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    Para desfazer, exclua o lançamento em Lançamentos
                  </span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
