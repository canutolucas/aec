import type { DbClient } from "../client";
import type { Category } from "../types";
import { unwrap } from "./helpers";

export async function listCategories(client: DbClient, companyId: string): Promise<Category[]> {
  const result = await client
    .from("categories")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  return unwrap(result);
}
