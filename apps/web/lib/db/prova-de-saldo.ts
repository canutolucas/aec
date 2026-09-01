/**
 * Prova o saldo do sistema contra o saldo que o próprio banco declarou no
 * extrato — a pergunta central de um fechamento de mês para uma contadora
 * ("o saldo bate?"). Extraído de `/conciliacao`, onde já rodava, para
 * `/hoje` (leva da carteira) poder usar exatamente o mesmo cálculo, em vez
 * de uma segunda versão que pudesse divergir.
 */

import type { BankAccount } from "@aec/db";
import { type BalanceCheck as DomainBalanceCheck, checkBalance, fromDb } from "@aec/domain";

import { createServerSupabase } from "./supabase";

type SupabaseServerClient = Awaited<ReturnType<typeof createServerSupabase>>;

/** checkBalance's own result, plus the account name the screen displays it under. */
export interface BalanceCheck extends DomainBalanceCheck {
  readonly accountName: string;
}

export async function calcularProvaDeSaldo(
  supabase: SupabaseServerClient,
  companyId: string,
  accounts: readonly Pick<
    BankAccount,
    "id" | "name" | "opening_balance" | "opening_balance_date"
  >[],
): Promise<BalanceCheck[]> {
  const [importsResult, realizedResult] = await Promise.all([
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
  if (importsResult.error) throw importsResult.error;
  if (realizedResult.error) throw realizedResult.error;

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

  return accounts.flatMap((account) => {
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
}
