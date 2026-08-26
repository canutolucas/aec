import { useQuery } from "@tanstack/react-query";

import type { DbClient } from "../client";
import { listMatchingRules } from "../queries/matching-rules";
import { queryKeys } from "../query-keys";

export function useMatchingRules(client: DbClient, companyId: string) {
  return useQuery({
    queryKey: queryKeys.matchingRules(companyId),
    queryFn: () => listMatchingRules(client, companyId),
  });
}
