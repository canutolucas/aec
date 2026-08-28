import { type BankAccount, hasRole } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert } from "@/lib/ui/components";

import { SubNav } from "../sub-nav";
import { RecebimentosClient } from "./recebimentos-client";

export const metadata = { title: "Recebimentos — Controle Bancario" };

export type RecebimentosAccount = Pick<BankAccount, "id" | "name" | "bank_name">;

export default async function RecebimentosPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("id, name, bank_name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  if (error) throw error;

  const podeConciliar = hasRole(session.role, "assistente");
  const accounts = (data ?? []) as RecebimentosAccount[];

  return (
    <div className="space-y-6">
      <SubNav group="notas" active="recebimentos" companyId={companyId} session={session} />

      <div>
        <h1 className="text-xl font-semibold">Recebimentos</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Casa os créditos do extrato com as notas fiscais em aberto — de qualquer banco, não só um
          banco fixo por nota.
        </p>
      </div>

      {!podeConciliar ? (
        <Alert tone="info">
          Seu perfil pode consultar, mas não pode conciliar recebimentos. Peça a um assistente,
          contador ou responsável.
        </Alert>
      ) : accounts.length === 0 ? (
        <Alert tone="warn">Nenhuma conta bancária cadastrada ainda.</Alert>
      ) : (
        <RecebimentosClient companyId={companyId} accounts={accounts} />
      )}
    </div>
  );
}
