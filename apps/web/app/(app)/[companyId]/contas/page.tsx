import { type AccountBalance, type BankAccount, hasRole, listAccountProfiles } from "@aec/db";

import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { ContasClient } from "./contas-client";
import { PerfisCard } from "./perfis-card";

export const metadata = { title: "Contas — Controle Bancario" };

export default async function ContasPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await requireAdvancedAccess(companyId);
  const podeEditar = hasRole(session.role, "contador");

  const supabase = await createServerSupabase();

  // v_account_balances traz os saldos ja calculados; bank_accounts traz os
  // campos que a view nao expoe (agencia, numero da conta) e que o
  // formulario de edicao precisa para pre-preencher.
  const [saldosResult, contasResult, perfis] = await Promise.all([
    supabase.from("v_account_balances").select("*").eq("company_id", companyId).order("name"),
    supabase.from("bank_accounts").select("*").eq("company_id", companyId).order("name"),
    listAccountProfiles(supabase, companyId),
  ]);

  if (saldosResult.error) throw saldosResult.error;
  if (contasResult.error) throw contasResult.error;

  const saldos = (saldosResult.data ?? []) as AccountBalance[];
  const contasBrutas = (contasResult.data ?? []) as BankAccount[];
  const contaPorId = new Map(contasBrutas.map((c) => [c.id, c]));

  return (
    <div className="space-y-6">
      <ContasClient
        companyId={companyId}
        podeEditar={podeEditar}
        contas={saldos.flatMap((saldo) => {
          const bruta = contaPorId.get(saldo.bank_account_id);
          return bruta ? [{ saldo, bruta }] : [];
        })}
      />
      <PerfisCard
        companyId={companyId}
        podeEditar={hasRole(session.role, "contador")}
        contas={contasBrutas}
        perfis={perfis}
      />
    </div>
  );
}
