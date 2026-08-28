import {
  type AccountBalance,
  listAccountProfiles,
  type MonthlyClosing,
  type Transaction,
} from "@aec/db";
import { addDays, startOfMonth, todayInBrazil } from "@aec/domain";
import { fromDb, sum } from "@aec/domain";
import { project } from "@aec/domain";
import Link from "next/link";

import { requireAdvancedAccess } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { PERFIL_PARAM, resolvePerfilSelecao } from "@/lib/ui/account-profiles";
import { Alert, Card, CardHeader, EmptyState, LinkButton, Money } from "@/lib/ui/components";
import { formatDate, formatMonth } from "@/lib/ui/format";
import { routes } from "@/lib/ui/routes";

export const metadata = { title: "Painel — Controle Bancario" };

const HORIZONTE_DIAS = 30;

export default async function PainelPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ [PERFIL_PARAM]?: string }>;
}) {
  const { companyId } = await params;
  const filtros = await searchParams;
  await requireAdvancedAccess(companyId);

  const hoje = todayInBrazil();
  const inicioDoMes = startOfMonth(hoje);
  const fimDoHorizonte = addDays(hoje, HORIZONTE_DIAS);

  const supabase = await createServerSupabase();

  const [
    saldosResult,
    previstosResult,
    doMesResult,
    notasResult,
    fechamentoResult,
    linhasResult,
    perfis,
  ] = await Promise.all([
    supabase.from("v_account_balances").select("*").eq("company_id", companyId).order("name"),
    // Inclui previstos vencidos (anteriores a hoje): eles continuam para pagar e
    // a projecao os traz para o primeiro dia em vez de ignora-los.
    supabase
      .from("transactions")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "previsto")
      .lte("booking_date", fimDoHorizonte)
      .order("booking_date"),
    supabase
      .from("transactions")
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "realizado")
      .gte("booking_date", inicioDoMes)
      .lte("booking_date", hoje),
    supabase
      .from("v_invoice_balances")
      .select("outstanding_amount")
      .eq("company_id", companyId)
      .gt("outstanding_amount", 0),
    supabase
      .from("monthly_closings")
      .select("*")
      .eq("company_id", companyId)
      .eq("period", inicioDoMes)
      .maybeSingle(),
    // Linhas do extrato ainda sem tratamento (nao viraram lancamento nem
    // foram casadas) — uma populacao diferente do "lancamento sem
    // conciliar" abaixo. As duas contagens de /conciliacao, lado a lado
    // aqui, pra nao existir um numero ambiguo de "quanto falta".
    supabase
      .from("statement_lines")
      .select("id, bank_account_id")
      .eq("company_id", companyId)
      .eq("status", "pendente"),
    listAccountProfiles(supabase, companyId),
  ]);

  for (const result of [saldosResult, previstosResult, doMesResult, notasResult]) {
    if (result.error) throw result.error;
  }

  // O perfil selecionado no cabecalho estreita o painel para so as contas
  // daquela lente — saldo, projecao e vencimentos, tudo recalculado em cima
  // do subconjunto, nao uma segunda versao da conta.
  const { bankAccountIds: contasDoPerfil } = resolvePerfilSelecao(filtros[PERFIL_PARAM], perfis);
  const noEscopo = (bankAccountId: string) =>
    contasDoPerfil === null || contasDoPerfil.includes(bankAccountId);

  const contas = ((saldosResult.data ?? []) as AccountBalance[]).filter((conta) =>
    noEscopo(conta.bank_account_id),
  );
  const previstos = ((previstosResult.data ?? []) as Transaction[]).filter((t) =>
    noEscopo(t.bank_account_id),
  );
  const doMes = ((doMesResult.data ?? []) as Transaction[]).filter((t) =>
    noEscopo(t.bank_account_id),
  );
  const aReceber = sum((notasResult.data ?? []).map((row) => fromDb(row.outstanding_amount)));
  // Melhor esforco: mes fechado e linhas pendentes sao avisos informativos,
  // nao travam o resto do painel se a consulta falhar.
  const fechamento = fechamentoResult.error
    ? null
    : (fechamentoResult.data as MonthlyClosing | null);
  const mesFechado = Boolean(fechamento?.locked_at);
  // Mesmo escopo de perfil que as demais consultas -- senao esta contagem
  // (que aparece lado a lado com "aConciliar", ja filtrada) ficaria sempre
  // no total da empresa inteira quando uma lente esta selecionada, voltando
  // a divergir do que a pessoa ve ao clicar em Conciliacao.
  const linhasPendentes = linhasResult.error
    ? 0
    : (linhasResult.data ?? []).filter((linha) => noEscopo(linha.bank_account_id)).length;

  const saldoAtual = sum(contas.map((conta) => fromDb(conta.current_balance)));
  const aConciliar = contas.reduce((total, conta) => total + Number(conta.unreconciled_count), 0);

  const semMovimento = contas.length === 0;

  // A projecao roda na camada de dominio, sobre os mesmos dados que a tela
  // mostra — sem uma segunda versao da conta em SQL que possa divergir.
  const projecao = project({
    openingBalance: saldoAtual,
    from: hoje,
    to: fimDoHorizonte,
    entries: previstos.map((previsto) => ({
      bookingDate: previsto.booking_date,
      amount: fromDb(previsto.amount),
      status: "previsto" as const,
      description: previsto.description,
    })),
  });

  const doResultado = doMes.filter((lancamento) => !lancamento.is_transfer);
  const entradasDoMes = sum(
    doResultado.filter((l) => l.direction === "entrada").map((l) => fromDb(l.amount)),
  );
  const saidasDoMes = sum(
    doResultado.filter((l) => l.direction === "saida").map((l) => fromDb(l.amount)),
  );

  const vencidos = previstos.filter((previsto) => previsto.booking_date < hoje);

  if (semMovimento) {
    return (
      <Card>
        <EmptyState
          title="Comece cadastrando as contas bancarias"
          description="Cada conta entra com o saldo do dia em que voce vai parar de usar a planilha. A partir dali o sistema calcula tudo pelos lancamentos."
          action={
            <LinkButton href={routes.accounts(companyId)} variant="primary">
              Cadastrar contas
            </LinkButton>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Indicador titulo="Saldo hoje" valor={saldoAtual} />
        <Indicador titulo={`Entradas de ${formatMonth(inicioDoMes)}`} valor={entradasDoMes} />
        <Indicador titulo={`Saidas de ${formatMonth(inicioDoMes)}`} valor={saidasDoMes} />
        <Indicador titulo={`Projetado em ${HORIZONTE_DIAS} dias`} valor={projecao.finalBalance} />
        <Indicador titulo="A receber (notas em aberto)" valor={aReceber} />
      </div>

      {projecao.firstNegativeDate && (
        <Alert tone="error" title="O caixa fica negativo antes do fim do periodo">
          Pelo que esta previsto, o saldo consolidado fica negativo em{" "}
          <strong>{formatDate(projecao.firstNegativeDate)}</strong>, chegando a{" "}
          <Money cents={projecao.lowestBalance} /> em {formatDate(projecao.lowestBalanceDate!)}.
        </Alert>
      )}

      {vencidos.length > 0 && (
        <Alert tone="warn" title={`${vencidos.length} previsto(s) vencido(s) e em aberto`}>
          Somam <Money cents={sum(vencidos.map((v) => fromDb(v.amount)))} />. Continuam contando na
          projecao — se ja foram pagos, de baixa para o caixa projetado ficar correto.
        </Alert>
      )}

      {mesFechado && (
        <Alert tone="warn" title={`${formatMonth(inicioDoMes)} esta fechado`}>
          Lancamentos deste mes nao podem ser alterados nem excluidos.{" "}
          <Link
            href={routes.transactions(companyId, { month: inicioDoMes })}
            className="underline underline-offset-2 hover:no-underline"
          >
            Ver em Lancamentos
          </Link>
        </Alert>
      )}

      {(aConciliar > 0 || linhasPendentes > 0) && (
        <Alert tone="info">
          {aConciliar > 0 && (
            <>
              {aConciliar} lancamento(s) ainda nao conciliados com o extrato do banco
              {linhasPendentes > 0 ? "; " : "."}
            </>
          )}
          {linhasPendentes > 0 && <>{linhasPendentes} linha(s) do extrato aguardando tratamento.</>}{" "}
          <Link
            href={routes.reconciliation(companyId)}
            className="underline underline-offset-2 hover:no-underline"
          >
            Ver em Conciliacao
          </Link>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Saldo por conta"
            action={
              <Link
                href={routes.accounts(companyId)}
                className="text-primary text-xs underline-offset-2 hover:underline"
              >
                ver contas
              </Link>
            }
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody className="divide-border divide-y">
                {contas.map((conta) => (
                  <tr key={conta.bank_account_id}>
                    <td className="px-4 py-2">{conta.name}</td>
                    <td className="px-4 py-2 text-right">
                      <Money cents={fromDb(conta.current_balance)} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-border border-t-2 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right">
                    <Money cents={saldoAtual} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Proximos vencimentos"
            action={
              <Link
                href={routes.transactions(companyId)}
                className="text-primary text-xs underline-offset-2 hover:underline"
              >
                ver lancamentos
              </Link>
            }
          />

          {previstos.length === 0 ? (
            <EmptyState
              title="Nada previsto para os proximos 30 dias"
              description="Lancamentos com situacao 'previsto' aparecem aqui e alimentam a projecao de caixa."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <tbody className="divide-border divide-y">
                  {previstos.slice(0, 10).map((previsto) => (
                    <tr key={previsto.id}>
                      <td className="tabular-money text-muted-foreground px-4 py-2 whitespace-nowrap">
                        {formatDate(previsto.booking_date)}
                        {previsto.booking_date < hoje && (
                          <span className="text-outflow ml-1">vencido</span>
                        )}
                      </td>
                      <td className="px-4 py-2">{previsto.description}</td>
                      <td className="px-4 py-2 text-right whitespace-nowrap">
                        <Money cents={fromDb(previsto.amount)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Indicador({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <Card className="p-4">
      <p className="text-muted-foreground text-xs">{titulo}</p>
      <p className="mt-1 text-lg font-semibold">
        <Money cents={valor} />
      </p>
    </Card>
  );
}
