import type { DbClient } from "../client";
import type { Category } from "../types";
import { unwrap } from "./helpers";

export async function listCategories(
  client: DbClient,
  companyId: string,
  options: { includeInactive?: boolean } = {},
): Promise<Category[]> {
  let query = client.from("categories").select("*").eq("company_id", companyId);
  if (!options.includeInactive) query = query.eq("is_active", true);
  const result = await query.order("name");
  return unwrap(result);
}
