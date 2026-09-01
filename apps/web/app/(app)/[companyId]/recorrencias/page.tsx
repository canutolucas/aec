import {
  hasRole,
  listCategories,
  listCostCenters,
  listCounterparties,
  listRecurrences,
} from "@aec/db";

import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { SubNav } from "../sub-nav";
import { RecorrenciasClient } from "./recorrencias-client";

export const metadata = { title: "Recorrências — Controle Bancario" };

export default async function RecorrenciasPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ inativos?: string }>;
}) {
  const { companyId } = await params;
  const { inativos } = await searchParams;
  const mostrarInativas = inativos === "1";
  const session = await requireAdvancedAccess(companyId);
  const supabase = await createServerSupabase();

  const [recorrencias, categorias, contrapartes, centrosDeCusto, contasResult] = await Promise.all([
    listRecurrences(supabase, companyId, { includeInactive: mostrarInativas }),
    listCategories(supabase, companyId),
    listCounterparties(supabase, companyId),
    listCostCenters(supabase, companyId),
    supabase
      .from("bank_accounts")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
  ]);
  if (contasResult.error) throw contasResult.error;

  return (
    <div className="space-y-6">
      <SubNav group="ajustes" active="recorrencias" companyId={companyId} session={session} />

      <div>
        <h1 className="text-xl font-semibold">Recorrências</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Lançamentos fixos — aluguel, folha, honorários de clientes, impostos. O sistema gera o
          previsto de cada mês sozinho.
        </p>
      </div>

      <RecorrenciasClient
        companyId={companyId}
        recorrencias={recorrencias}
        contas={contasResult.data ?? []}
        categorias={categorias}
        contrapartes={contrapartes}
        centrosDeCusto={centrosDeCusto}
        mostrarInativas={mostrarInativas}
        canEdit={hasRole(session.role, "contador")}
      />
    </div>
  );
}
