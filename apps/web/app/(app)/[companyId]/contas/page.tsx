import { type AccountBalance, type BankAccount, hasRole } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { ContasClient } from "./contas-client";

export const metadata = { title: "Contas — Controle Bancario" };

export default async function ContasPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);
  const podeEditar = hasRole(session.role, "contador");

  const supabase = await createServerSupabase();

  // v_account_balances traz os saldos ja calculados; bank_accounts traz os
  // campos que a view nao expoe (agencia, numero da conta) e que o
  // formulario de edicao precisa para pre-preencher.
  const [saldosResult, contasResult] = await Promise.all([
    supabase.from("v_account_balances").select("*").eq("company_id", companyId).order("name"),
    supabase.from("bank_accounts").select("*").eq("company_id", companyId).order("name"),
  ]);

  if (saldosResult.error) throw saldosResult.error;
  if (contasResult.error) throw contasResult.error;

  const saldos = (saldosResult.data ?? []) as AccountBalance[];
  const contasBrutas = (contasResult.data ?? []) as BankAccount[];
  const contaPorId = new Map(contasBrutas.map((c) => [c.id, c]));

  return (
    <ContasClient
      companyId={companyId}
      podeEditar={podeEditar}
      contas={saldos.flatMap((saldo) => {
        const bruta = contaPorId.get(saldo.bank_account_id);
        return bruta ? [{ saldo, bruta }] : [];
      })}
    />
  );
}
