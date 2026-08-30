import { type AuditLog, hasRole } from "@aec/db";
import { addMonths, startOfMonth, todayInBrazil } from "@aec/domain";
import { Alert, PageHeader } from "@aec/ui";

import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { SubNav } from "../sub-nav";
import { type AuditLogRow, AuditoriaClient } from "./auditoria-client";
import { FiltroAuditoria } from "./filtro-auditoria";

export const metadata = { title: "Auditoria — Controle Bancario" };

/**
 * Nome amigavel por tabela — a mesma trilha (audit_log) cobre tudo que ja
 * tem trigger, nao so as seis que esta leva fechou (ver migration
 * 20250101002100). Uma tabela auditada sem entrada aqui ainda aparece —
 * so com o nome cru do banco, o que e visivel o suficiente pra nao esconder
 * nada, so menos bonito.
 */
const TABLE_LABELS: Record<string, string> = {
  transactions: "Lançamentos",
  bank_accounts: "Contas",
  monthly_closings: "Fechamentos de mês",
  memberships: "Equipe",
  invoices: "Notas fiscais",
  invoice_settlements: "Baixas de recebimento",
  categories: "Categorias",
  counterparties: "Clientes e fornecedores",
  cost_centers: "Centros de custo",
  matching_rules: "Regras de correspondência",
  statement_imports: "Importações de extrato",
  statement_lines: "Linhas de extrato",
  account_profiles: "Perfis de contas",
  account_profile_accounts: "Contas do perfil",
};

const LIMITE_LINHAS = 500;

export default async function AuditoriaPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ mes?: string; tabela?: string }>;
}) {
  const { companyId } = await params;
  const filtros = await searchParams;
  const session = await requireAdvancedAccess(companyId);
  const podeVer = hasRole(session.role, "contador");

  const hoje = todayInBrazil();
  const mes = filtros.mes ?? startOfMonth(hoje);
  const primeiroDia = startOfMonth(mes);
  const proximoMes = startOfMonth(addMonths(primeiroDia, 1));

  let linhas: AuditLogRow[] = [];
  let noTeto = false;

  if (podeVer) {
    const supabase = await createServerSupabase();

    // changed_at e timestamptz; comparar com "YYYY-MM-DD" cru assume meia-noite
    // UTC, nao meia-noite de Brasilia — um registro dos primeiros/ultimos
    // instantes do mes pode aparecer no mes vizinho. Aceitavel para uma trilha
    // de consulta (nao mexe em saldo nem em fechamento); nenhuma outra tela do
    // sistema ainda filtrou por timestamptz para ter um padrao exato pra seguir.
    let query = supabase
      .from("audit_log")
      .select("*")
      .eq("company_id", companyId)
      .gte("changed_at", primeiroDia)
      .lt("changed_at", proximoMes)
      .order("changed_at", { ascending: false })
      .limit(LIMITE_LINHAS);
    if (filtros.tabela) query = query.eq("table_name", filtros.tabela);

    const { data, error } = await query;
    if (error) throw error;

    const brutas = (data ?? []) as AuditLog[];
    noTeto = brutas.length >= LIMITE_LINHAS;

    const idsAutores = [
      ...new Set(brutas.flatMap((linha) => (linha.changed_by ? [linha.changed_by] : []))),
    ];
    const perfisResult =
      idsAutores.length > 0
        ? await supabase.from("profiles").select("id, full_name, email").in("id", idsAutores)
        : { data: [] };
    const nomePorAutor = new Map(
      (perfisResult.data ?? []).map((perfil) => [
        perfil.id,
        perfil.full_name ?? perfil.email ?? "—",
      ]),
    );

    linhas = brutas.map((linha) => ({
      ...linha,
      id: String(linha.id),
      tableLabel: TABLE_LABELS[linha.table_name] ?? linha.table_name,
      actorName: linha.changed_by ? (nomePorAutor.get(linha.changed_by) ?? "—") : "Fora do app",
    }));
  }

  return (
    <div className="space-y-6">
      <SubNav group="relatorios" active="auditoria" companyId={companyId} session={session} />

      <PageHeader
        title="Auditoria"
        description="Quem mudou o quê, e quando — preenchido automaticamente, nunca pela aplicação."
      />

      {!podeVer ? (
        <Alert tone="info">
          Seu perfil não tem acesso à trilha de auditoria — é visível a partir de contador.
        </Alert>
      ) : (
        <>
          <FiltroAuditoria
            companyId={companyId}
            mes={primeiroDia}
            tabela={filtros.tabela}
            tabelas={Object.entries(TABLE_LABELS).map(([value, label]) => ({ value, label }))}
          />

          {noTeto && (
            <Alert tone="warn" title="Mais alterações do que cabe aqui">
              Este mês tem mais de {LIMITE_LINHAS} alterações registradas — as mais antigas do
              período podem não aparecer abaixo. Estreite pelo filtro de tabela para ver o resto.
            </Alert>
          )}

          <AuditoriaClient linhas={linhas} />
        </>
      )}
    </div>
  );
}
