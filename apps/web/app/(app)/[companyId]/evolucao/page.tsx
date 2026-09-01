import { type BankAccount } from "@aec/db";
import {
  addMonths,
  type Cents,
  compareDates,
  endOfMonth,
  fromDb,
  type IsoDate,
  project,
  startOfMonth,
  sum,
  todayInBrazil,
} from "@aec/domain";
import { Card, CardHeader, EmptyState, Money } from "@aec/ui";

import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { formatMonth } from "@/lib/ui/format";

import { SubNav } from "../sub-nav";

export const metadata = { title: "Evolução mensal — Controle Bancario" };

const MESES_NA_JANELA = 12;

interface LinhaMes {
  readonly mes: IsoDate;
  readonly entradas: Cents;
  readonly saidas: Cents;
  readonly resultado: Cents;
  readonly saldo: Cents;
}

/**
 * Comparativo dos ultimos 12 meses — entradas, saidas, resultado e saldo ao
 * fim de cada um. Nenhuma tela ate esta leva respondia "como este mes foi
 * contra os anteriores" de uma vez so; /relatorios e /painel so mostram um
 * periodo por vez.
 *
 * Reusa project() (o mesmo motor que /relatorios ja usa para o fluxo de
 * caixa historico) em vez de recalcular saldo mes a mes na mao — um
 * unico project() sobre a janela inteira, com o saldo de cada mes lido do
 * dia certo em resultado.days.
 */
export default async function EvolucaoPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await requireAdvancedAccess(companyId);
  const supabase = await createServerSupabase();

  const hoje = todayInBrazil();
  const inicioDoMes = startOfMonth(hoje);
  const janelaInicio = addMonths(inicioDoMes, -(MESES_NA_JANELA - 1));

  const { data: contasData, error: contasError } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("company_id", companyId)
    .eq("is_active", true);
  if (contasError) throw contasError;
  const contas = (contasData ?? []) as BankAccount[];

  if (contas.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nenhuma conta bancária cadastrada"
          description="A evolução mensal aparece assim que houver contas com movimento."
        />
      </Card>
    );
  }

  // Saldo consolidado ANTES da janela: soma so a coluna amount (nao a linha
  // inteira) dos lancamentos anteriores ao inicio — mesmo padrao e mesmo
  // motivo (fromDb/soma em JS, nunca o sum() agregado do PostgREST, que
  // volta como number) que /relatorios/page.tsx ja documenta.
  const antesDaJanela = await Promise.all(
    contas.map(async (conta): Promise<Cents> => {
      const { data, error } = await supabase
        .from("transactions")
        .select("amount")
        .eq("company_id", companyId)
        .eq("bank_account_id", conta.id)
        .eq("status", "realizado")
        .lt("booking_date", janelaInicio);
      if (error) throw error;
      const movimento = sum((data ?? []).map((t) => fromDb(t.amount)));
      return fromDb(conta.opening_balance) + movimento;
    }),
  );
  const saldoInicial = sum(antesDaJanela);

  // Transferencia entre duas contas EM ESCOPO se cancela sozinha no
  // consolidado (mesmo movimento, sinais opostos) — excluir da entrada do
  // project() nao muda o saldo final, e tira a inflacao artificial que
  // contaria a mesma transferencia como "entrada" E "saida" do mes.
  const { data: transacoesData, error: transacoesError } = await supabase
    .from("transactions")
    .select("booking_date, amount, description")
    .eq("company_id", companyId)
    .in(
      "bank_account_id",
      contas.map((c) => c.id),
    )
    .eq("status", "realizado")
    .eq("is_transfer", false)
    .gte("booking_date", janelaInicio)
    .lte("booking_date", hoje)
    .order("booking_date");
  if (transacoesError) throw transacoesError;

  const resultado = project({
    openingBalance: saldoInicial,
    from: janelaInicio,
    to: hoje,
    entries: (transacoesData ?? []).map((t) => ({
      bookingDate: t.booking_date as IsoDate,
      amount: fromDb(t.amount),
      status: "realizado" as const,
      description: t.description,
    })),
  });

  const diasPorData = new Map(resultado.days.map((dia) => [dia.date, dia]));

  const meses: LinhaMes[] = Array.from({ length: MESES_NA_JANELA }, (_, i) => {
    const mes = addMonths(janelaInicio, i);
    const fimDoMes = endOfMonth(mes);
    // O mes corrente ainda nao terminou: le o saldo ate hoje, nao ate um
    // fim de mes que ainda nao chegou.
    const dataDeCorte = compareDates(fimDoMes, hoje) > 0 ? hoje : fimDoMes;

    const diasDoMes = resultado.days.filter(
      (dia) => compareDates(dia.date, mes) >= 0 && compareDates(dia.date, dataDeCorte) <= 0,
    );
    const entradas = sum(diasDoMes.map((d) => d.inflow));
    const saidas = sum(diasDoMes.map((d) => d.outflow));

    return {
      mes,
      entradas,
      saidas,
      resultado: entradas + saidas,
      saldo: diasPorData.get(dataDeCorte)?.balance ?? saldoInicial,
    };
  });

  return (
    <div className="space-y-6">
      <SubNav group="relatorios" active="evolucao" companyId={companyId} session={session} />

      <div>
        <h1 className="text-xl font-semibold">Evolução mensal</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Os últimos {MESES_NA_JANELA} meses, só com o que já foi realizado. O mês corrente aparece
          até hoje, não até o fim do mês.
        </p>
      </div>

      <Card>
        <CardHeader title="Entradas, saídas e saldo por mês" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border text-muted-foreground border-b text-left text-xs">
                <th className="px-4 py-2 font-medium">Mês</th>
                <th className="px-4 py-2 text-right font-medium">Entradas</th>
                <th className="px-4 py-2 text-right font-medium">Saídas</th>
                <th className="px-4 py-2 text-right font-medium">Resultado</th>
                <th className="px-4 py-2 text-right font-medium">Saldo ao fim</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {meses.map((linha) => (
                <tr key={linha.mes}>
                  <td className="px-4 py-2">{formatMonth(linha.mes)}</td>
                  <td className="px-4 py-2 text-right">
                    <Money cents={linha.entradas} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money cents={linha.saidas} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money cents={linha.resultado} />
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    <Money cents={linha.saldo} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
