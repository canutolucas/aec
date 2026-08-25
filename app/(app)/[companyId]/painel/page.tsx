import Link from "next/link";
import { rotas } from "@/lib/ui/rotas";
import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import type { AccountBalance, Transaction } from "@/lib/db/types";
import { addDays, startOfMonth, todayInBrazil } from "@/lib/domain/dates";
import { fromDb, sum } from "@/lib/domain/money";
import { project } from "@/lib/domain/projection";
import { Alert, Card, CardHeader, EmptyState, LinkButton, Money } from "@/lib/ui/components";
import { formatDate, formatMonth } from "@/lib/ui/format";

export const metadata = { title: "Painel — Controle Bancario" };

const HORIZONTE_DIAS = 30;

export default async function PainelPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  await requireCompany(companyId);

  const hoje = todayInBrazil();
  const inicioDoMes = startOfMonth(hoje);
  const fimDoHorizonte = addDays(hoje, HORIZONTE_DIAS);

  const supabase = await createServerSupabase();

  const [saldosResult, previstosResult, doMesResult] = await Promise.all([
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
  ]);

  for (const result of [saldosResult, previstosResult, doMesResult]) {
    if (result.error) throw result.error;
  }

  const contas = (saldosResult.data ?? []) as AccountBalance[];
  const previstos = (previstosResult.data ?? []) as Transaction[];
  const doMes = (doMesResult.data ?? []) as Transaction[];

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
          action={<LinkButton href={rotas.contas(companyId)} variant="primary">Cadastrar contas</LinkButton>}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador titulo="Saldo hoje" valor={saldoAtual} />
        <Indicador titulo={`Entradas de ${formatMonth(inicioDoMes)}`} valor={entradasDoMes} />
        <Indicador titulo={`Saidas de ${formatMonth(inicioDoMes)}`} valor={saidasDoMes} />
        <Indicador titulo={`Projetado em ${HORIZONTE_DIAS} dias`} valor={projecao.finalBalance} />
      </div>

      {projecao.firstNegativeDate && (
        <Alert tone="error" title="O caixa fica negativo antes do fim do periodo">
          Pelo que esta previsto, o saldo consolidado fica negativo em{" "}
          <strong>{formatDate(projecao.firstNegativeDate)}</strong>, chegando a{" "}
          <Money cents={projecao.lowestBalance} /> em{" "}
          {formatDate(projecao.lowestBalanceDate!)}.
        </Alert>
      )}

      {vencidos.length > 0 && (
        <Alert tone="warn" title={`${vencidos.length} previsto(s) vencido(s) e em aberto`}>
          Somam <Money cents={sum(vencidos.map((v) => fromDb(v.amount)))} />. Continuam contando na
          projecao — se ja foram pagos, de baixa para o caixa projetado ficar correto.
        </Alert>
      )}

      {aConciliar > 0 && (
        <Alert tone="info">
          {aConciliar} lancamento(s) ainda nao conciliados com o extrato do banco.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Saldo por conta"
            action={
              <Link
                href={rotas.contas(companyId)}
                className="text-xs text-[--color-marca] underline-offset-2 hover:underline"
              >
                ver contas
              </Link>
            }
          />
          <table className="w-full text-sm">
            <tbody className="divide-y divide-[--color-borda]">
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
              <tr className="border-t-2 border-[--color-borda] font-semibold">
                <td className="px-4 py-2">Total</td>
                <td className="px-4 py-2 text-right">
                  <Money cents={saldoAtual} />
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>

        <Card>
          <CardHeader
            title="Proximos vencimentos"
            action={
              <Link
                href={rotas.lancamentos(companyId)}
                className="text-xs text-[--color-marca] underline-offset-2 hover:underline"
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
            <table className="w-full text-sm">
              <tbody className="divide-y divide-[--color-borda]">
                {previstos.slice(0, 10).map((previsto) => (
                  <tr key={previsto.id}>
                    <td className="numero whitespace-nowrap px-4 py-2 text-[--color-tinta-fraca]">
                      {formatDate(previsto.booking_date)}
                      {previsto.booking_date < hoje && (
                        <span className="ml-1 text-[--color-saida]">vencido</span>
                      )}
                    </td>
                    <td className="px-4 py-2">{previsto.description}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <Money cents={fromDb(previsto.amount)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Indicador({ titulo, valor }: { titulo: string; valor: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-[--color-tinta-fraca]">{titulo}</p>
      <p className="mt-1 text-lg font-semibold">
        <Money cents={valor} />
      </p>
    </Card>
  );
}
