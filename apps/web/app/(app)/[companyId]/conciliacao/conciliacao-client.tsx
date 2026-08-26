"use client";

import type { BankAccount, StatementLine, Transaction } from "@aec/db";
import { formatBRL, fromDb, type Match, matchStatement } from "@aec/domain";
import {
  type CanonicalStatement,
  detectMapping,
  parseOfx,
  parseStatementCsv,
  toMatchableLines,
} from "@aec/statements";
import { Alert, Button, Card, CardHeader, EmptyState, Field, Select } from "@aec/ui";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { confirmMatch, importStatement } from "./actions";

interface SuggestedMatch extends Match {
  readonly line: StatementLine;
  readonly transaction: Transaction;
}

export function ReconciliationClient({
  companyId,
  accounts,
  pendingLines,
  transactions,
  canEdit,
}: {
  companyId: string;
  accounts: readonly BankAccount[];
  pendingLines: readonly StatementLine[];
  transactions: readonly Transaction[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [statement, setStatement] = useState<CanonicalStatement | null>(null);
  const [fileName, setFileName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const suggestions = useMemo(() => {
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
    return [...result.matched, ...result.suggested].flatMap((match): SuggestedMatch[] => {
      const line = lineById.get(match.lineId);
      const transaction = transactionById.get(match.transactionId);
      return line && transaction ? [{ ...match, line, transaction }] : [];
    });
  }, [accountId, pendingLines, transactions]);

  async function readFile(file: File | undefined) {
    if (!file) return;
    setMessage(null);
    setStatement(null);
    setFileName(file.name);

    try {
      const content = await file.text();
      const isOfx = /\.(ofx|qfx)$/i.test(file.name) || content.includes("<OFX>");
      if (isOfx) {
        setStatement(parseOfx(content));
        return;
      }

      const detected = detectMapping(content);
      if (!detected.mapping) {
        setMessage(
          `${detected.problems.join(" ")} Exporte em OFX ou use um CSV com Data, Historico e Valor.`,
        );
        return;
      }
      setStatement(parseStatementCsv(content, detected.mapping));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nao foi possivel ler este arquivo.");
    }
  }

  function importPreview() {
    if (!statement || !accountId) return;
    startTransition(async () => {
      const result = await importStatement({
        companyId,
        bankAccountId: accountId,
        fileName,
        payload: JSON.stringify({
          source: statement.source,
          periodStart: statement.periodStart,
          periodEnd: statement.periodEnd,
          ledgerBalance: statement.ledgerBalance,
          ledgerBalanceDate: statement.ledgerBalanceDate,
          lines: statement.lines.map((line) => ({
            postedAt: line.postedAt,
            amount: line.amount,
            memo: line.memo,
            fitid: line.fitid,
            dedupKey: line.dedupKey,
          })),
        }),
      });
      setMessage(
        result.ok ? "Extrato importado. Revise os pareamentos abaixo." : (result.error ?? null),
      );
      if (result.ok) {
        setStatement(null);
        router.refresh();
      }
    });
  }

  function acceptMatch(match: SuggestedMatch) {
    startTransition(async () => {
      const result = await confirmMatch({
        companyId,
        statementLineId: match.line.id,
        transactionId: match.transaction.id,
      });
      setMessage(result.ok ? "Lancamento conciliado." : (result.error ?? null));
      if (result.ok) router.refresh();
    });
  }

  const previewMatch = statement
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
    : null;

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
      {message && (
        <Alert
          tone={
            message.includes("importado") || message.includes("conciliado") ? "success" : "error"
          }
        >
          {message}
        </Alert>
      )}

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
            label="Arquivo OFX, QFX ou CSV"
            hint="CSV precisa ter colunas de data, historico e valor."
          >
            <input
              type="file"
              accept=".ofx,.qfx,.csv,text/csv,application/x-ofx"
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

      <Card>
        <CardHeader title={`Sugestões de conciliação (${suggestions.length})`} />
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
    </div>
  );
}
