import type { DbClient } from "../client";
import type { Transaction } from "../types";
import { unwrap } from "./helpers";

export interface TransactionFilters {
  readonly month?: string;
  readonly accountId?: string;
}

export async function listTransactions(
  client: DbClient,
  companyId: string,
  filters: TransactionFilters = {},
): Promise<Transaction[]> {
  let query = client
    .from("transactions")
    .select("*")
    .eq("company_id", companyId)
    .order("booking_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters.month) {
    const [year, month] = filters.month.split("-").map(Number);
    const start = `${filters.month}-01`;
    const nextMonth =
      month === 12 ? `${year! + 1}-01-01` : `${year}-${String(month! + 1).padStart(2, "0")}-01`;
    query = query.gte("booking_date", start).lt("booking_date", nextMonth);
  }
  if (filters.accountId) {
    query = query.eq("bank_account_id", filters.accountId);
  }

  const result = await query;
  // `direction` and `is_transfer` are generated columns Postgres reports as
  // nullable; Transaction narrows them, see ../types.ts.
  return unwrap(result) as unknown as Transaction[];
}

/** Realized transactions still waiting to be matched against a statement. */
export async function listUnreconciledTransactions(
  client: DbClient,
  companyId: string,
): Promise<Transaction[]> {
  const result = await client
    .from("transactions")
    .select("*")
    .eq("company_id", companyId)
    .eq("reconciliation", "nao_conciliado")
    .eq("status", "realizado")
    .order("booking_date", { ascending: false })
    .limit(2_000);
  return unwrap(result) as unknown as Transaction[];
}
