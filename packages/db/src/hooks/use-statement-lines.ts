import { useQuery } from "@tanstack/react-query";

import type { DbClient } from "../client";
import { listStatementLines } from "../queries/statement-lines";
import { queryKeys } from "../query-keys";
import type { StatementLineStatus } from "../types";

export function useStatementLines(
  client: DbClient,
  companyId: string,
  statuses: readonly StatementLineStatus[],
  limit?: number,
) {
  return useQuery({
    queryKey: queryKeys.statementLines(companyId, statuses.join(",")),
    queryFn: () => listStatementLines(client, companyId, statuses, limit),
  });
}
