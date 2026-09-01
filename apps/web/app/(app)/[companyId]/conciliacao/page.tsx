import {
  type BankAccount,
  type Category,
  hasRole,
  listAccountProfiles,
  type MatchingRule,
  type StatementLine,
  type Transaction,
} from "@aec/db";

import { type BalanceCheck, calcularProvaDeSaldo } from "@/lib/db/prova-de-saldo";
import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { PERFIL_PARAM, resolvePerfilSelecao } from "@/lib/ui/account-profiles";
import { Alert } from "@/lib/ui/components";

import { SubNav } from "../sub-nav";
import { ReconciliationClient } from "./conciliacao-client";

export const metadata = { title: "Conciliacao — Controle Bancario" };

export type { BalanceCheck };

export default async function ReconciliationPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ [PERFIL_PARAM]?: string }>;
}) {
  const { companyId } = await params;
  const filtros = await searchParams;
  const session = await requireAdvancedAccess(companyId);
  const supabase = await createServerSupabase();

  const [
    accountsResult,
    linesResult,
    reconciledLinesResult,
    transactionsResult,
    categoriesResult,
    rulesResult,
    perfis,
  ] = await Promise.all([
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
    // Linhas ja tratadas recentemente: e o que permite desfazer uma
    // conciliacao feita por engano, sem ter que ir procurar no lancamento.
    supabase
      .from("statement_lines")
      .select("*")
      .eq("company_id", companyId)
      .in("status", ["conciliada", "criada"])
      .order("matched_at", { ascending: false })
      .limit(50),
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
    listAccountProfiles(supabase, companyId),
  ]);

  for (const result of [
    accountsResult,
    linesResult,
    reconciledLinesResult,
    transactionsResult,
    categoriesResult,
    rulesResult,
  ]) {
    if (result.error) throw result.error;
  }

  const canEdit = hasRole(session.role, "assistente");

  // As duas consultas grandes tem um teto (limit acima) que sempre existiu,
  // mas nunca foi comunicado — quem tivesse mais de 500 linhas pendentes ou
  // 2.000 lancamentos nao conciliados via a tela "completa" sem saber que
  // faltava parte do fundo da lista. Nao e paginacao de verdade (mudaria a
  // tela inteira, que hoje trabalha com o array completo em memoria para
  // pareamento e prova de saldo) — e o minimo que fecha a promessa quebrada:
  // avisar quando o teto foi atingido, com o que fazer a respeito.
  const linhasNoTeto = (linesResult.data?.length ?? 0) >= 500;
  const lancamentosNoTeto = (transactionsResult.data?.length ?? 0) >= 2_000;

  // O perfil selecionado no cabecalho filtra tudo nesta tela — nao ha um
  // filtro de conta unica proprio aqui como em /lancamentos e /relatorios,
  // entao a lente e a unica forma de estreitar o que aparece.
  const { bankAccountIds: contasDoPerfil } = resolvePerfilSelecao(filtros[PERFIL_PARAM], perfis);
  const noEscopo = (bankAccountId: string) =>
    contasDoPerfil === null || contasDoPerfil.includes(bankAccountId);

  const accounts = ((accountsResult.data ?? []) as BankAccount[]).filter((account) =>
    noEscopo(account.id),
  );

  const balanceChecks = await calcularProvaDeSaldo(supabase, companyId, accounts);

  return (
    <div className="space-y-6">
      <SubNav group="movimentos" active="conciliacao" companyId={companyId} session={session} />

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

      {(linhasNoTeto || lancamentosNoTeto) && (
        <Alert tone="warn" title="Esta tela não está mostrando tudo">
          {linhasNoTeto &&
            "Há mais de 500 movimentos do extrato aguardando revisão — os mais antigos podem não aparecer abaixo. "}
          {lancamentosNoTeto &&
            "Há mais de 2.000 lançamentos sem conciliar — os mais antigos podem não aparecer abaixo. "}
          Revise e confirme o que já apareceu para reduzir o total, ou use &ldquo;Organizar o que dá
          sozinho&rdquo; para adiantar o que o sistema já reconhece.
        </Alert>
      )}

      <ReconciliationClient
        companyId={companyId}
        accounts={accounts}
        pendingLines={((linesResult.data ?? []) as StatementLine[]).filter((line) =>
          noEscopo(line.bank_account_id),
        )}
        reconciledLines={((reconciledLinesResult.data ?? []) as StatementLine[]).filter((line) =>
          noEscopo(line.bank_account_id),
        )}
        transactions={((transactionsResult.data ?? []) as Transaction[]).filter((transaction) =>
          noEscopo(transaction.bank_account_id),
        )}
        categories={(categoriesResult.data ?? []) as Category[]}
        matchingRules={(rulesResult.data ?? []) as MatchingRule[]}
        balanceChecks={balanceChecks}
        canEdit={canEdit}
      />
    </div>
  );
}
