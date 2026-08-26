import type { DbClient } from "../client";
import type { AccountBalance, BankAccount } from "../types";
import { unwrap } from "./helpers";

export async function listBankAccounts(
  client: DbClient,
  companyId: string,
): Promise<BankAccount[]> {
  const result = await client
    .from("bank_accounts")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  return unwrap(result);
}

/** Balances derived from movement, never a stored field — see v_account_balances. */
export async function listAccountBalances(
  client: DbClient,
  companyId: string,
): Promise<AccountBalance[]> {
  const result = await client
    .from("v_account_balances")
    .select("*")
    .eq("company_id", companyId)
    .order("name");
  // The generated view Row marks every column nullable (Postgres can't prove
  // the view's own COALESCE never returns null); AccountBalance asserts what
  // we already know is true — see the type's own comment in ../types.ts.
  return unwrap(result) as unknown as AccountBalance[];
}
