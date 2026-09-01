import type { DbClient } from "../client";
import type { Recurrence } from "../types";
import { unwrap } from "./helpers";

export async function listRecurrences(
  client: DbClient,
  companyId: string,
  options: { includeInactive?: boolean } = {},
): Promise<Recurrence[]> {
  let query = client.from("recurrences").select("*").eq("company_id", companyId);
  if (!options.includeInactive) query = query.eq("is_active", true);
  const result = await query.order("description");
  return unwrap(result);
}
