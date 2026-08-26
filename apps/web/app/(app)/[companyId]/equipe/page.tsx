import { hasRole, type Membership, type Profile } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { EquipeClient } from "./equipe-client";

export const metadata = { title: "Equipe — Controle Bancario" };

export interface MembershipWithProfile extends Membership {
  readonly profiles: Pick<Profile, "full_name" | "email"> | null;
}

export default async function EquipePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("memberships")
    .select("*, profiles (full_name, email)")
    .eq("company_id", companyId)
    .order("role")
    .order("created_at");

  if (error) throw error;

  return (
    <EquipeClient
      companyId={companyId}
      currentUserId={session.userId}
      members={data ?? []}
      canManage={hasRole(session.role, "owner")}
    />
  );
}
