import { type BankAccount, hasRole, type StatementLine, type Transaction } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert } from "@/lib/ui/components";

import { ReconciliationClient } from "./conciliacao-client";

export const metadata = { title: "Conciliacao — Controle Bancario" };

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);
  const supabase = await createServerSupabase();

  const [accountsResult, linesResult, transactionsResult] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("*")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("statement_lines")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "pendente")
      .order("posted_at", { ascending: false })
      .limit(500),
    supabase
      .from("transactions")
      .select("*")
      .eq("company_id", companyId)
      .eq("reconciliation", "nao_conciliado")
      .eq("status", "realizado")
      .order("booking_date", { ascending: false })
      .limit(2_000),
  ]);

  for (const result of [accountsResult, linesResult, transactionsResult]) {
    if (result.error) throw result.error;
  }

  const canEdit = hasRole(session.role, "assistente");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Conciliação bancária</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Compare o extrato com os lançamentos. O sistema sugere; você confirma cada combinação.
        </p>
      </div>

      {!canEdit && (
        <Alert tone="info">
          Seu perfil permite consultar a conciliação, mas apenas assistentes, contadores e
          responsáveis podem importar ou confirmar movimentos.
        </Alert>
      )}

      <ReconciliationClient
        companyId={companyId}
        accounts={(accountsResult.data ?? []) as BankAccount[]}
        pendingLines={(linesResult.data ?? []) as StatementLine[]}
        transactions={(transactionsResult.data ?? []) as Transaction[]}
        canEdit={canEdit}
      />
    </div>
  );
}
