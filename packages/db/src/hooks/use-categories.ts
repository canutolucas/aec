import { useQuery } from "@tanstack/react-query";

import type { DbClient } from "../client";
import { listCategories } from "../queries/categories";
import { queryKeys } from "../query-keys";

export function useCategories(client: DbClient, companyId: string) {
  return useQuery({
    queryKey: queryKeys.categories(companyId),
    queryFn: () => listCategories(client, companyId),
  });
}
