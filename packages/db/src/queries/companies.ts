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
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError) throw new Error(userError.message);
  if (!userData.user) return [];

  // The user_id filter is not just an optimization: RLS on memberships only
  // requires being a member of the SAME company, not owning the row — so
  // without it, a company with an owner and an assistant returns one
  // membership row per PERSON in the company, not one per company the
  // caller belongs to. `.find()`-style lookups downstream would then risk
  // resolving to a DIFFERENT member's role instead of the caller's own.
  const result = await client
    .from("memberships")
    .select("role, companies (*)")
    .eq("user_id", userData.user.id)
    .order("created_at", { ascending: true });

  const rows = unwrap(result);
  return rows.flatMap((row) =>
    row.companies && row.companies.is_active ? [{ ...row.companies, role: row.role }] : [],
  );
}
