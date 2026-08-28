import { hasRole, type Membership, type Profile } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { SubNav } from "../sub-nav";
import { EquipeClient } from "./equipe-client";

export const metadata = { title: "Equipe — Controle Bancario" };

export interface MembershipWithProfile extends Membership {
  readonly profiles: Pick<Profile, "full_name" | "email"> | null;
}

/**
 * requireCompany, nao requireAdvancedAccess (que desde a Fase 2b e um
 * alias do proprio requireCompany — ver session.ts). E aqui que mora o
 * unico jeito de desligar o modo simples (alternarModoSimples, abaixo); a
 * aba "Equipe" dentro de Ajustes (nav-groups.ts) so aparece pra quem tem
 * papel de owner, mas a URL continua acessivel na mao pra qualquer membro
 * — so ve a lista, sem controles de gerenciar (canManage = owner abaixo).
 */
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
    <div className="space-y-6">
      <SubNav group="ajustes" active="equipe" companyId={companyId} session={session} />

      <EquipeClient
        companyId={companyId}
        currentUserId={session.userId}
        members={data ?? []}
        canManage={hasRole(session.role, "owner")}
      />
    </div>
  );
}
