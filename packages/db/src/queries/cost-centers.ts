import type { DbClient } from "../client";
import type { CostCenter } from "../types";
import { unwrap } from "./helpers";

export async function listCostCenters(
  client: DbClient,
  companyId: string,
  options: { includeInactive?: boolean } = {},
): Promise<CostCenter[]> {
  let query = client.from("cost_centers").select("*").eq("company_id", companyId);
  if (!options.includeInactive) query = query.eq("is_active", true);
  const result = await query.order("name");
  return unwrap(result);
}
