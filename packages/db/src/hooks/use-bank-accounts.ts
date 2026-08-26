import { useQuery } from "@tanstack/react-query";

import type { DbClient } from "../client";
import { listAccountBalances, listBankAccounts } from "../queries/bank-accounts";
import { queryKeys } from "../query-keys";

export function useBankAccounts(
  client: DbClient,
  companyId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.bankAccounts(companyId),
    queryFn: () => listBankAccounts(client, companyId),
    enabled: (options.enabled ?? true) && companyId !== "",
  });
}

export function useAccountBalances(
  client: DbClient,
  companyId: string,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.accountBalances(companyId),
    queryFn: () => listAccountBalances(client, companyId),
    enabled: (options.enabled ?? true) && companyId !== "",
  });
}
