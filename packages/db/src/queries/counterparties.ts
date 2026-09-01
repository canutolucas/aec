import type { DbClient } from "../client";
import type { Counterparty } from "../types";
import { unwrap } from "./helpers";

export async function listCounterparties(
  client: DbClient,
  companyId: string,
  options: { includeInactive?: boolean } = {},
): Promise<Counterparty[]> {
  let query = client.from("counterparties").select("*").eq("company_id", companyId);
  if (!options.includeInactive) query = query.eq("is_active", true);
  const result = await query.order("name");
  return unwrap(result);
}
