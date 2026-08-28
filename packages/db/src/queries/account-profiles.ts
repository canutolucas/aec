import type { DbClient } from "../client";
import type { AccountProfile } from "../types";
import { unwrap } from "./helpers";

/** Um perfil com as contas que ele agrupa hoje. */
export type AccountProfileWithAccounts = AccountProfile & {
  readonly bankAccountIds: readonly string[];
};

export async function listAccountProfiles(
  client: DbClient,
  companyId: string,
): Promise<AccountProfileWithAccounts[]> {
  const result = await client
    .from("account_profiles")
    .select("*, account_profile_accounts (bank_account_id)")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  const rows = unwrap(result);
  return rows.map(({ account_profile_accounts, ...profile }) => ({
    ...profile,
    bankAccountIds: account_profile_accounts.map((row) => row.bank_account_id),
  }));
}
