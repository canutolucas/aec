/**
 * Single factory for every TanStack Query key this app uses.
 *
 * Centralized on purpose: a mutation that invalidates `["bank-accounts", companyId]`
 * has to match the exact key shape a query used, or the invalidation silently
 * does nothing and the screen shows stale data until the next full reload.
 * One factory, shared by every query and every mutation, makes that
 * mismatch a type error instead of a runtime mystery.
 */
export const queryKeys = {
  bankAccounts: (companyId: string) => ["bank-accounts", companyId] as const,
  accountBalances: (companyId: string) => ["account-balances", companyId] as const,
  categories: (companyId: string) => ["categories", companyId] as const,
  transactions: (companyId: string, filters?: { month?: string; accountId?: string }) =>
    ["transactions", companyId, filters ?? {}] as const,
  unreconciledTransactions: (companyId: string) =>
    ["unreconciled-transactions", companyId] as const,
  statementLines: (companyId: string, status: string) =>
    ["statement-lines", companyId, status] as const,
  matchingRules: (companyId: string) => ["matching-rules", companyId] as const,
};
