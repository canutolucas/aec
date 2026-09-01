import { type CategorySummary } from "@aec/db";
import { fromDb, startOfMonth, sum, todayInBrazil } from "@aec/domain";
import { Card, CardHeader, EmptyState, Money } from "@aec/ui";

import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { formatMonth } from "@/lib/ui/format";

import { SubNav } from "../sub-nav";
import { FiltroMesCategoria } from "./filtro-mes-categoria";
import { RegimeToggle } from "./regime-toggle";

export const metadata = { title: "Relatório por categoria — Controle Bancario" };

/**
 * v_monthly_category_summary ja existia (com GRANT) desde a migration de
 * views operacionais — nenhuma tela nunca tinha consultado ela. A pessoa
 * categoriza cada lançamento, mas o relatório que essa classificação
 * deveria alimentar não existia em lugar nenhum.
 *
 * So realizado (nao previsto) — mesmo recorte que /painel ja usa pros
 * indicadores de entradas/saidas do mes. Sem filtro de perfil: a view
 * agrega por categoria, nao por conta, entao nao ha bank_account_id pra
 * filtrar por perfil sem mudar a view.
 *
 * Caixa/competencia (nesta leva): a view sempre expos period_cash E
 * period_accrual, e nenhuma tela consultava a segunda coluna — o corte por
 * competencia que qualquer contador espera estava a um `eq()` de distancia.
 */
export default async function RelatorioCategoriasPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ mes?: string; regime?: string }>;
}) {
  const { companyId } = await params;
  const filtros = await searchParams;
  const session = await requireAdvancedAccess(companyId);

  const hoje = todayInBrazil();
  const mes = filtros.mes ?? startOfMonth(hoje);
  const primeiroDia = startOfMonth(mes);
  const regime = filtros.regime === "competencia" ? "competencia" : "caixa";

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("v_monthly_category_summary")
    .select("*")
    .eq("company_id", companyId)
    .eq(regime === "competencia" ? "period_accrual" : "period_cash", primeiroDia)
    .eq("status", "realizado");
  if (error) throw error;

  const linhas = (data ?? []) as CategorySummary[];
  const entradas = linhas
    .filter((l) => l.direction === "entrada")
    .sort((a, b) => fromDb(b.total_amount) - fromDb(a.total_amount));
  const saidas = linhas
    .filter((l) => l.direction === "saida")
    .sort((a, b) => fromDb(a.total_amount) - fromDb(b.total_amount));

  const totalEntradas = sum(entradas.map((l) => fromDb(l.total_amount)));
  const totalSaidas = sum(saidas.map((l) => fromDb(l.total_amount)));

  return (
    <div className="space-y-6">
      <SubNav group="relatorios" active="categorias" companyId={companyId} session={session} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Por categoria</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Só o que já foi realizado em {formatMonth(primeiroDia)}
            {regime === "competencia"
              ? " — por competência: a que mês cada lançamento pertence, mesmo que o dinheiro tenha andado antes ou depois."
              : " — por caixa: o mesmo recorte que o Painel usa pros totais do mês."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RegimeToggle companyId={companyId} mes={primeiroDia} regime={regime} />
          <FiltroMesCategoria companyId={companyId} mes={primeiroDia} regime={filtros.regime} />
        </div>
      </div>

      {linhas.length === 0 ? (
        <Card>
          <EmptyState
            title="Nenhum lançamento realizado neste mês"
            description="O relatório aparece assim que houver movimento com situação 'realizado' no período."
          />
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <TabelaCategoria titulo="Entradas" total={totalEntradas} linhas={entradas} />
          <TabelaCategoria titulo="Saídas" total={totalSaidas} linhas={saidas} />
        </div>
      )}
    </div>
  );
}

function TabelaCategoria({
  titulo,
  total,
  linhas,
}: {
  titulo: string;
  total: number;
  linhas: readonly CategorySummary[];
}) {
  return (
    <Card>
      <CardHeader
        title={titulo}
        action={<Money cents={total} className="text-base font-semibold" />}
      />
      {linhas.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm">Nada neste mês.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody className="divide-border divide-y">
              {linhas.map((linha) => (
                <tr key={linha.category_id ?? "sem-categoria"}>
                  <td className="px-4 py-2">{linha.category_name ?? "Sem categoria"}</td>
                  <td className="text-muted-foreground px-4 py-2 text-xs whitespace-nowrap">
                    {linha.entry_count} lançamento(s)
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money cents={fromDb(linha.total_amount)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
