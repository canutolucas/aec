import { hasRole, type Membership, type Profile } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { EquipeClient } from "./equipe-client";

export const metadata = { title: "Equipe — Controle Bancario" };

export interface MembershipWithProfile extends Membership {
  readonly profiles: Pick<Profile, "full_name" | "email"> | null;
}

/**
 * Deliberadamente requireCompany, NAO requireAdvancedAccess: e aqui que
 * mora o unico jeito de desligar o modo simples (alternarModoSimples,
 * abaixo). Se esta pagina fosse gateada por simpleMode como as outras 6
 * telas avancadas, um owner que ligasse o modo simples em si mesmo ficaria
 * trancado para sempre — redirecionado de volta pra /inicio ao tentar
 * chegar na unica tela que desfaria isso. Um assistente em modo simples
 * ainda pode abrir esta URL, mas so ve a lista (sem controles de gerenciar,
 * ja restritos a canManage = owner abaixo) — inofensivo, e o preco de
 * manter a porta de saida sempre aberta para quem pode usa-la.
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
    <EquipeClient
      companyId={companyId}
      currentUserId={session.userId}
      members={data ?? []}
      canManage={hasRole(session.role, "owner")}
    />
  );
}
