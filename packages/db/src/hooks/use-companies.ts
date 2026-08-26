import { useQuery } from "@tanstack/react-query";

import type { DbClient } from "../client";
import { listMyCompanies } from "../queries/companies";

export function useMyCompanies(client: DbClient) {
  return useQuery({
    queryKey: ["my-companies"] as const,
    queryFn: () => listMyCompanies(client),
  });
}
