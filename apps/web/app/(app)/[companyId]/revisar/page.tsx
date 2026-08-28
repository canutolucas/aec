import {
  type BankAccount,
  type Category,
  hasRole,
  type MatchingRule,
  type StatementLine,
  type Transaction,
} from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert } from "@/lib/ui/components";

import { RevisarClient } from "./revisar-client";

export const metadata = { title: "Revisar — Controle Bancario" };

/**
 * A fila de revisao: um item por vez, em vez do paredao de N linhas que
 * /conciliacao mostrava de uma vez so (ainda mostra, pra quem prefere a
 * visao completa). Mesmos dados que /conciliacao busca — pareamento e
 * categorizacao usam a mesma logica de dominio (matchStatement/categorize)
 * — so a apresentacao muda.
 */
export default async function RevisarPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);
  const supabase = await createServerSupabase();

  const [accountsResult, linesResult, transactionsResult, categoriesResult, rulesResult] =
    await Promise.all([
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
        .order("posted_at", { ascending: true })
        .limit(500),
      supabase
        .from("transactions")
        .select("*")
        .eq("company_id", companyId)
        .eq("reconciliation", "nao_conciliado")
        .eq("status", "realizado")
        .order("booking_date", { ascending: false })
        .limit(2_000),
      supabase
        .from("categories")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("matching_rules")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("priority"),
    ]);

  for (const result of [
    accountsResult,
    linesResult,
    transactionsResult,
    categoriesResult,
    rulesResult,
  ]) {
    if (result.error) throw result.error;
  }

  const canEdit = hasRole(session.role, "assistente");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Revisar</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Um movimento por vez — o que o sistema já resolveu sozinho não aparece aqui.
        </p>
      </div>

      {!canEdit && (
        <Alert tone="info">
          Seu perfil permite consultar, mas apenas assistentes, contadores e responsáveis podem
          confirmar movimentos.
        </Alert>
      )}

      <RevisarClient
        companyId={companyId}
        accounts={(accountsResult.data ?? []) as BankAccount[]}
        pendingLines={(linesResult.data ?? []) as StatementLine[]}
        transactions={(transactionsResult.data ?? []) as Transaction[]}
        categories={(categoriesResult.data ?? []) as Category[]}
        matchingRules={(rulesResult.data ?? []) as MatchingRule[]}
        canEdit={canEdit}
      />
    </div>
  );
}
