import {
  hasRole,
  listCategories,
  listCostCenters,
  listCounterparties,
  listMatchingRules,
} from "@aec/db";

import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { CadastrosClient } from "./cadastros-client";

export const metadata = { title: "Cadastros — Controle Bancario" };

export default async function CadastrosPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await requireAdvancedAccess(companyId);
  const supabase = await createServerSupabase();

  // Shared with the mobile app (packages/db) instead of repeating the same
  // company_id/is_active/order() query inline here: one place to change the
  // filtering or sort order for either surface, not two copies that can
  // silently drift apart.
  const [categories, costCenters, counterparties, matchingRules] = await Promise.all([
    listCategories(supabase, companyId),
    listCostCenters(supabase, companyId),
    listCounterparties(supabase, companyId),
    listMatchingRules(supabase, companyId),
  ]);

  return (
    <CadastrosClient
      companyId={companyId}
      categories={categories}
      costCenters={costCenters}
      counterparties={counterparties}
      matchingRules={matchingRules}
      // Categorias e centros de custo (plano de contas) exigem contador;
      // contrapartes e regras de categorizacao ja aceitam assistente — a
      // mesma distincao que as policies de RLS fazem no banco.
      canEditChartOfAccounts={hasRole(session.role, "contador")}
      canEditOperational={hasRole(session.role, "assistente")}
    />
  );
}
