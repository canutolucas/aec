import { hasRole, listCategories, listMatchingRules } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { SubNav } from "../sub-nav";
import { RegrasClient } from "./regras-client";

export const metadata = { title: "Regras automáticas — Controle Bancario" };

/**
 * Igual a /cadastros (que tambem lista estas mesmas regras), mas com
 * requireCompany em vez de requireAdvancedAccess: quem esta em modo simples
 * cria uma regra automatica a cada categorizacao manual (sem checkbox, ver
 * inicio-client.tsx) e precisa conseguir ver e desligar uma regra ruim sem
 * pedir pro owner desligar o modo simples primeiro. Desde a Fase 2b e uma
 * aba normal dentro de Ajustes (nav-groups.ts), sempre visivel — nao mais
 * so alcancavel por um link avulso a partir de /inicio.
 */
export default async function RegrasPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);
  const supabase = await createServerSupabase();

  const [categories, matchingRules] = await Promise.all([
    listCategories(supabase, companyId),
    listMatchingRules(supabase, companyId),
  ]);

  return (
    <div className="space-y-6">
      <SubNav group="ajustes" active="regras" companyId={companyId} session={session} />

      <RegrasClient
        companyId={companyId}
        categories={categories}
        matchingRules={matchingRules}
        canEdit={hasRole(session.role, "assistente")}
      />
    </div>
  );
}
