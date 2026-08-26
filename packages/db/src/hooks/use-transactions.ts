import { useQuery } from "@tanstack/react-query";

import type { DbClient } from "../client";
import {
  listTransactions,
  listUnreconciledTransactions,
  type TransactionFilters,
} from "../queries/transactions";
import { queryKeys } from "../query-keys";

export function useTransactions(client: DbClient, companyId: string, filters?: TransactionFilters) {
  return useQuery({
    queryKey: queryKeys.transactions(companyId, filters),
    queryFn: () => listTransactions(client, companyId, filters),
  });
}

export function useUnreconciledTransactions(client: DbClient, companyId: string) {
  return useQuery({
    queryKey: queryKeys.unreconciledTransactions(companyId),
    queryFn: () => listUnreconciledTransactions(client, companyId),
  });
}
