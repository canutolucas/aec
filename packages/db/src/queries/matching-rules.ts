import type { DbClient } from "../client";
import type { MatchingRule } from "../types";
import { unwrap } from "./helpers";

export async function listMatchingRules(
  client: DbClient,
  companyId: string,
): Promise<MatchingRule[]> {
  const result = await client
    .from("matching_rules")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("priority");
  return unwrap(result);
}
