import { hasRole, listCategories, listMatchingRules } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { RegrasClient } from "./regras-client";

export const metadata = { title: "Regras automáticas — Controle Bancario" };

/**
 * Igual a /cadastros (que tambem lista estas mesmas regras), mas com
 * requireCompany em vez de requireAdvancedAccess: quem esta em modo simples
 * cria uma regra automatica a cada categorizacao manual (sem checkbox, ver
 * inicio-client.tsx) e precisa conseguir ver e desligar uma regra ruim sem
 * pedir pro owner desligar o modo simples primeiro. Nao entra no menu (nem
 * simpleNav nem NAV avancado) de proposito — e alcancada por um link a
 * partir de /inicio, nao uma aba nova.
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
    <RegrasClient
      companyId={companyId}
      categories={categories}
      matchingRules={matchingRules}
      canEdit={hasRole(session.role, "assistente")}
    />
  );
}
