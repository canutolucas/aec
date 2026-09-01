import {
  type BankAccount,
  type Category,
  hasRole,
  listAccountProfiles,
  listCostCenters,
  listCounterparties,
  type Transaction,
} from "@aec/db";
import { todayInBrazil } from "@aec/domain";
import { Alert, LinkButton, PageHeader } from "@aec/ui";

import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { PERFIL_PARAM, resolvePerfilSelecao } from "@/lib/ui/account-profiles";
import { routes } from "@/lib/ui/routes";

import type { LancamentoRow } from "../lancamentos/lancamentos-table";
import { SubNav } from "../sub-nav";
import { PrevistosClient } from "./previstos-client";

export const metadata = { title: "A pagar/receber — Controle Bancario" };

const LIMITE_LINHAS = 500;

/**
 * "A pagar / a receber": todos os previstos em aberto, sem filtro de mes —
 * e o ponto da tela. /lancamentos filtra por mes, entao um previsto vencido
 * de marco some quando se olha maio, mesmo com /painel avisando "N
 * previsto(s) vencido(s)". O aviso ja existia; o lugar de agir sobre ele,
 * nao.
 */
export default async function PrevistosPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ conta?: string; [PERFIL_PARAM]?: string }>;
}) {
  const { companyId } = await params;
  const filtros = await searchParams;
  const session = await requireAdvancedAccess(companyId);
  const podeEditar = hasRole(session.role, "assistente");
  const hoje = todayInBrazil();

  const supabase = await createServerSupabase();

  const [contasResult, categoriasResult, previstosResult, perfis, contrapartes, centrosDeCusto] =
    await Promise.all([
      supabase
        .from("bank_accounts")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("categories")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("transactions")
        .select("*")
        .eq("company_id", companyId)
        .eq("status", "previsto")
        .order("booking_date", { ascending: true })
        .limit(LIMITE_LINHAS),
      listAccountProfiles(supabase, companyId),
      listCounterparties(supabase, companyId),
      listCostCenters(supabase, companyId),
    ]);

  for (const result of [contasResult, categoriasResult, previstosResult]) {
    if (result.error) throw result.error;
  }

  const contas = (contasResult.data ?? []) as BankAccount[];
  const categorias = (categoriasResult.data ?? []) as Category[];
  const todos = (previstosResult.data ?? []) as Transaction[];
  const noTeto = todos.length >= LIMITE_LINHAS;

  // Mesma precedencia de /lancamentos: conta unica escolhida aqui embaixo
  // ganha do perfil selecionado no cabecalho.
  const { bankAccountIds: contasDoPerfil } = resolvePerfilSelecao(filtros[PERFIL_PARAM], perfis);
  const previstos = filtros.conta
    ? todos.filter((previsto) => previsto.bank_account_id === filtros.conta)
    : contasDoPerfil
      ? todos.filter((previsto) => contasDoPerfil.includes(previsto.bank_account_id))
      : todos;

  const nomePorConta = new Map(contas.map((conta) => [conta.id, conta.name]));
  const nomePorCategoria = new Map(categorias.map((categoria) => [categoria.id, categoria.name]));

  return (
    <div className="space-y-6">
      <SubNav group="movimentos" active="previstos" companyId={companyId} session={session} />

      <PageHeader
        title="A pagar e a receber"
        description="Todos os previstos em aberto, de qualquer mes — vencidos e a vencer."
        action={
          hasRole(session.role, "contador") && (
            <LinkButton href={routes.recurrences(companyId)} variant="ghost" size="sm">
              Lançamentos fixos (recorrências)
            </LinkButton>
          )
        }
      />

      {noTeto && (
        <Alert tone="warn" title="Mais previstos do que cabe aqui">
          Ha mais de {LIMITE_LINHAS} previstos em aberto — os mais distantes no futuro podem nao
          aparecer abaixo. Os mais vencidos aparecem primeiro.
        </Alert>
      )}

      <PrevistosClient
        companyId={companyId}
        previstos={previstos.map((previsto): LancamentoRow => ({
          ...previsto,
          contaNome: nomePorConta.get(previsto.bank_account_id) ?? "—",
          categoriaNome: previsto.category_id
            ? (nomePorCategoria.get(previsto.category_id) ?? "—")
            : null,
          // Um previsto nunca tem historico de extrato (so linhas ja
          // conciliadas tem memo) nem baixa de nota fiscal (settle_invoices
          // so aloca credito ja realizado) — os dois campos existem so pra
          // reaproveitar EditarLancamentoForm/BaixaDialog sem duplicar tipo.
          memoExtrato: null,
          temBaixaDeNota: false,
        }))}
        contas={contas}
        categorias={categorias}
        contrapartes={contrapartes}
        centrosDeCusto={centrosDeCusto}
        podeEditar={podeEditar}
        hoje={hoje}
      />
    </div>
  );
}
