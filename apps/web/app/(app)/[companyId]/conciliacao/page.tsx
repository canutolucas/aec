import {
  type BankAccount,
  type Category,
  hasRole,
  type MatchingRule,
  type StatementLine,
  type Transaction,
} from "@aec/db";
import { type BalanceCheck as BalanceCheckResult, checkBalance, fromDb } from "@aec/domain";

import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert } from "@/lib/ui/components";

import { ReconciliationClient } from "./conciliacao-client";

export const metadata = { title: "Conciliacao — Controle Bancario" };

/** checkBalance's own result, plus the account name the screen displays it under. */
export interface BalanceCheck extends BalanceCheckResult {
  readonly accountName: string;
}

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await requireAdvancedAccess(companyId);
  const supabase = await createServerSupabase();

  const [
    accountsResult,
    linesResult,
    reconciledLinesResult,
    transactionsResult,
    categoriesResult,
    rulesResult,
    importsResult,
    realizedResult,
  ] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("statement_lines")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "pendente")
      .order("posted_at", { ascending: false })
      .limit(500),
    // Linhas ja tratadas recentemente: e o que permite desfazer uma
    // conciliacao feita por engano, sem ter que ir procurar no lancamento.
    supabase
      .from("statement_lines")
      .select("*")
      .eq("company_id", companyId)
      .in("status", ["conciliada", "criada"])
      .order("matched_at", { ascending: false })
      .limit(50),
    supabase
      .from("transactions")
      .select("*")
      .eq("company_id", companyId)
      .eq("reconciliation", "nao_conciliado")
      .eq("status", "realizado")
      .order("booking_date", { ascending: false })
      .limit(2_000),
    supabase
      .from("categories")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("matching_rules")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("priority"),
    // Uma linha por conta: a que prova o saldo e a que declara o balanço MAIS
    // RECENTE, nao a importacao mais recente. Alguem pode importar um
    // extrato antigo (um backfill de marco) depois de ja ter importado um
    // mais novo (maio) — nesse caso created_at do backfill e maior, mas
    // statement_balance_date dele e menor, e e essa data que importa aqui.
    supabase
      .from("statement_imports")
      .select("bank_account_id, statement_balance, statement_balance_date, created_at")
      .eq("company_id", companyId)
      .not("statement_balance", "is", null)
      .order("statement_balance_date", { ascending: false })
      .order("created_at", { ascending: false }),
    // So o necessario para reconstruir o saldo: sem isso, a prova do saldo
    // do extrato contra o saldo do sistema nao teria como ser feita.
    supabase
      .from("transactions")
      .select("bank_account_id, booking_date, amount, status")
      .eq("company_id", companyId)
      .eq("status", "realizado"),
  ]);

  for (const result of [
    accountsResult,
    linesResult,
    reconciledLinesResult,
    transactionsResult,
    categoriesResult,
    rulesResult,
    importsResult,
    realizedResult,
  ]) {
    if (result.error) throw result.error;
  }

  const canEdit = hasRole(session.role, "assistente");
  const accounts = (accountsResult.data ?? []) as BankAccount[];

  const latestImportByAccount = new Map<string, { balance: string; date: string }>();
  for (const row of importsResult.data ?? []) {
    // Both columns are nullable in the schema — a statement import can, in
    // principle, declare one without the other. The balance check needs both
    // to mean anything, so an import missing either is skipped rather than
    // treated as "no declared balance at all" for the account.
    if (
      !latestImportByAccount.has(row.bank_account_id) &&
      row.statement_balance &&
      row.statement_balance_date
    ) {
      latestImportByAccount.set(row.bank_account_id, {
        balance: row.statement_balance,
        date: row.statement_balance_date,
      });
    }
  }

  const entriesByAccount = new Map<
    string,
    { bookingDate: string; amount: number; status: "previsto" | "realizado" }[]
  >();
  for (const row of realizedResult.data ?? []) {
    const list = entriesByAccount.get(row.bank_account_id) ?? [];
    list.push({ bookingDate: row.booking_date, amount: fromDb(row.amount), status: row.status });
    entriesByAccount.set(row.bank_account_id, list);
  }

  const balanceChecks: BalanceCheck[] = accounts.flatMap((account) => {
    const declared = latestImportByAccount.get(account.id);
    if (!declared) return [];

    const result = checkBalance(
      {
        openingBalance: fromDb(account.opening_balance),
        openingBalanceDate: account.opening_balance_date,
      },
      entriesByAccount.get(account.id) ?? [],
      { bankAccountId: account.id, balance: fromDb(declared.balance), date: declared.date },
    );

    return [{ ...result, accountName: account.name }];
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Conciliação bancária</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Compare o extrato com os lançamentos. O sistema sugere; você confirma cada combinação.
        </p>
      </div>

      {!canEdit && (
        <Alert tone="info">
          Seu perfil permite consultar a conciliação, mas apenas assistentes, contadores e
          responsáveis podem importar ou confirmar movimentos.
        </Alert>
      )}

      <ReconciliationClient
        companyId={companyId}
        accounts={accounts}
        pendingLines={(linesResult.data ?? []) as StatementLine[]}
        reconciledLines={(reconciledLinesResult.data ?? []) as StatementLine[]}
        transactions={(transactionsResult.data ?? []) as Transaction[]}
        categories={(categoriesResult.data ?? []) as Category[]}
        matchingRules={(rulesResult.data ?? []) as MatchingRule[]}
        balanceChecks={balanceChecks}
        canEdit={canEdit}
      />
    </div>
  );
}
