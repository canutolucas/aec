import type { DbClient } from "../client";
import type { Company, MemberRole } from "../types";
import { unwrap } from "./helpers";

export interface CompanyMembership extends Company {
  readonly role: MemberRole;
}

/**
 * Companies the signed-in user belongs to, each with the role they hold —
 * the same query `apps/web/lib/db/session.ts` runs server-side, shared here
 * so the mobile app (no Server Components to run it in) doesn't need its
 * own copy.
 */
export async function listMyCompanies(client: DbClient): Promise<CompanyMembership[]> {
  const result = await client
    .from("memberships")
    .select("role, companies (*)")
    .order("created_at", { ascending: true });

  const rows = unwrap(result);
  return rows.flatMap((row) => {
    const company = row.companies as unknown as Company | null;
    return company && company.is_active ? [{ ...company, role: row.role }] : [];
  });
}
