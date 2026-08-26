import type { DbClient } from "../client";
import type { Counterparty } from "../types";
import { unwrap } from "./helpers";

export async function listCounterparties(
  client: DbClient,
  companyId: string,
): Promise<Counterparty[]> {
  const result = await client
    .from("counterparties")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  return unwrap(result);
}
