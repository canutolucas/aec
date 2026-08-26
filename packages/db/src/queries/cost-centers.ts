import type { DbClient } from "../client";
import type { CostCenter } from "../types";
import { unwrap } from "./helpers";

export async function listCostCenters(client: DbClient, companyId: string): Promise<CostCenter[]> {
  const result = await client
    .from("cost_centers")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  return unwrap(result);
}
