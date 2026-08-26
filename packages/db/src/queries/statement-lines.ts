import type { DbClient } from "../client";
import type { StatementLine, StatementLineStatus } from "../types";
import { unwrap } from "./helpers";

export async function listStatementLines(
  client: DbClient,
  companyId: string,
  statuses: readonly StatementLineStatus[],
  limit = 500,
): Promise<StatementLine[]> {
  const result = await client
    .from("statement_lines")
    .select("*")
    .eq("company_id", companyId)
    .in("status", statuses)
    .order("posted_at", { ascending: false })
    .limit(limit);
  return unwrap(result);
}
