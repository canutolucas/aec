import { type BankAccount, hasRole } from "@aec/db";
import {
  addDays,
  addMonths,
  canCloseMonth,
  fromDb,
  isIsoDate,
  type IsoDate,
  project,
  startOfMonth,
  statementCoverage,
  sum,
  todayInBrazil,
  workingMonth,
} from "@aec/domain";
import {
  Alert,
  Card,
  CardHeader,
  EmptyState,
  LinkButton,
  Money,
  Stepper,
  type StepperStep,
} from "@aec/ui";
import { CheckCircle2, FileCheck2, HandCoins, LockOpen, Upload } from "lucide-react";

import { calcularProvaDeSaldo } from "@/lib/db/prova-de-saldo";
import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { formatDate, formatMonth, isInvoiceOverdue } from "@/lib/ui/format";
import { routes } from "@/lib/ui/routes";

import { MesDeTrabalho } from "./mes-de-trabalho";

export const metadata = { title: "Hoje — Controle Bancario" };

// Mesmo horizonte que /painel e /relatorios ja usavam pra projecao de caixa.
const HORIZONTE_DIAS = 30;

type ContaBasica = Pick<
  BankAccount,
  "id" | "name" | "bank_name" | "opening_balance" | "opening_balance_date"
>;

/**
 * "Hoje" substitui /painel e /inicio como aterrissagem — antes desta leva,
 * modo simples caia numa tela e modo avancado noutra, cada uma com sua
 * propria versao da mesma pergunta ("o que eu faco agora"). Ver CLAUDE.md.
 *
 * A esteira (Stepper) mostra em que estagio do ciclo mensal a empresa esta;
 * o card "Proxima acao" traduz isso num UNICO botao — o "fordismo" que
 * faltava: nunca mais de uma decisao em destaque por vez.
 *
 * O periodo da esteira NAO e sempre o mes corrente: workingMonth()
 * (packages/domain) decide em que mes a contadora esta de fato trabalhando
 * — em 1o de setembro, e agosto, nao setembro. Antes desta leva a esteira
 * sempre ancorava no mes corrente, entao no dia 2 de setembro o app ja
 * mandava "feche setembro", um mes que mal comecou.
 */
export default async function HojePage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ mes?: string }>;
}) {
  const { companyId } = await params;
  const filtros = await searchParams;
  const session = await requireCompany(companyId);
  const supabase = await createServerSupabase();

  const hoje = todayInBrazil();
  const inicioDoMes = startOfMonth(hoje);
  const mesAnterior = addMonths(inicioDoMes, -1);
  const fimDoHorizonte = addDays(hoje, HORIZONTE_DIAS);

  // `?mes=` deixa a contadora navegar manualmente para qualquer mes — o
  // padrao continua sendo o mes de trabalho automatico (workingMonth), mas
  // ela nao fica presa nele.
  const periodoManual =
    filtros.mes && isIsoDate(filtros.mes) ? startOfMonth(filtros.mes) : undefined;
  const periodosParaChecarFechamento = periodoManual
    ? [periodoManual]
    : [...new Set([mesAnterior, inicioDoMes])];

  const [
    accountsResult,
    lastImportResult,
    invoicesResult,
    balancesResult,
    plannedResult,
    linesResult,
    fechamentosResult,
    coberturaImportsResult,
  ] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("id, name, bank_name, opening_balance, opening_balance_date")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("statement_imports")
      .select("created_at, file_name")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("v_invoice_balances")
      .select("issued_on, outstanding_amount")
      .eq("company_id", companyId)
      .gt("outstanding_amount", 0),
    supabase
      .from("v_account_balances")
      .select("current_balance, unreconciled_count")
      .eq("company_id", companyId),
    supabase
      .from("transactions")
      .select("booking_date, amount, description")
      .eq("company_id", companyId)
      .eq("status", "previsto")
      .lte("booking_date", fimDoHorizonte)
      .order("booking_date"),
    supabase
      .from("statement_lines")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "pendente"),
    supabase
      .from("monthly_closings")
      .select("period, locked_at")
      .eq("company_id", companyId)
      .in("period", periodosParaChecarFechamento),
    // period_end, nao created_at: cobertura de extrato prova que o extrato
    // ALCANCA o fim do mes, nao so que alguma coisa foi importada nele —
    // ver statementCoverage() em packages/domain.
    supabase
      .from("statement_imports")
      .select("bank_account_id, period_end")
      .eq("company_id", companyId)
      .not("period_end", "is", null)
      .gte("period_end", periodoManual ?? mesAnterior),
  ]);

  if (accountsResult.error) throw accountsResult.error;

  const accounts = (accountsResult.data ?? []) as ContaBasica[];

  if (accounts.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Comece cadastrando as contas bancárias"
          description="Cada conta entra com o saldo do dia em que você vai parar de usar a planilha. A partir dali o sistema calcula tudo pelos lançamentos."
          action={
            <LinkButton href={routes.accounts(companyId)} variant="primary">
              Cadastrar contas
            </LinkButton>
          }
        />
      </Card>
    );
  }

  // Melhor esforco: cada consulta abaixo alimenta um aviso ou um passo da
  // esteira — uma falha isolada nao deveria derrubar a tela inteira.
  const lastImport = lastImportResult.error ? null : lastImportResult.data;

  const fechamentos = fechamentosResult.error ? [] : (fechamentosResult.data ?? []);
  const periodosFechados = fechamentos.filter((f) => f.locked_at).map((f) => f.period as IsoDate);

  // Uma conta ativa mais antiga vale de "inicio da operacao" — workingMonth
  // nao pode devolver um mes anterior a isso, ou uma empresa nova voltaria
  // "trabalhando" num mes em que ela nem existia.
  const inicioMaisAntigo = accounts.reduce<IsoDate | undefined>(
    (mais, conta) =>
      !mais || conta.opening_balance_date < mais ? conta.opening_balance_date : mais,
    undefined,
  );

  const periodoTrabalho =
    periodoManual ??
    workingMonth({
      today: hoje,
      closedPeriods: periodosFechados,
      earliestActivity: inicioMaisAntigo,
    });

  const mesFechado = fechamentos.some((f) => f.period === periodoTrabalho && f.locked_at);
  const podeFechar = canCloseMonth(periodoTrabalho, hoje);

  const notasVencidas = invoicesResult.error
    ? 0
    : (invoicesResult.data ?? []).filter(
        (inv) =>
          inv.issued_on &&
          inv.outstanding_amount &&
          isInvoiceOverdue(inv.issued_on as IsoDate, fromDb(inv.outstanding_amount)),
      ).length;

  const contasSaldo = balancesResult.error ? [] : (balancesResult.data ?? []);
  const saldoAtual = sum(contasSaldo.map((c) => fromDb(c.current_balance)));
  const aConciliar = contasSaldo.reduce((total, c) => total + Number(c.unreconciled_count), 0);

  const linhasPendentes = linesResult.error ? 0 : (linesResult.count ?? 0);

  const cobertura = statementCoverage({
    period: periodoTrabalho,
    accounts: accounts.map((c) => ({ id: c.id, openingBalanceDate: c.opening_balance_date })),
    imports: (coberturaImportsResult.error ? [] : (coberturaImportsResult.data ?? [])).map((i) => ({
      bankAccountId: i.bank_account_id,
      periodEnd: i.period_end,
    })),
  });
  const contasSemExtrato = cobertura.missing.length;

  // A mesma prova de saldo que /conciliacao ja fazia (extraida para
  // apps/web/lib/db/prova-de-saldo.ts nesta leva): compara o saldo que o
  // banco declarou no extrato com o que o sistema calcula. "O saldo bate?"
  // e a pergunta central de um fechamento — antes desta leva, essa resposta
  // so existia escondida em /conciliacao.
  const provaDeSaldo = await calcularProvaDeSaldo(supabase, companyId, accounts);
  const saldoDivergente = provaDeSaldo.some((check) => check.diff !== 0);

  const projecao =
    balancesResult.error || plannedResult.error
      ? null
      : project({
          openingBalance: saldoAtual,
          from: hoje,
          to: fimDoHorizonte,
          entries: (plannedResult.data ?? []).map((previsto) => ({
            bookingDate: previsto.booking_date as IsoDate,
            amount: fromDb(previsto.amount),
            status: "previsto" as const,
            description: previsto.description,
          })),
        });

  // A esteira do mes de trabalho: cada passo tem uma condicao propria de
  // "feito". O primeiro passo que nao esta feito e o passo "atual" — so ele
  // vira o card de proxima acao abaixo. "Fechar" conta como feito tambem
  // quando o mes ainda esta em curso (podeFechar=false): nao ha nada
  // ACIONAVEL a fazer ali alem de esperar o mes terminar, entao ele nao
  // deve travar a esteira num estado "atual" sem CTA nenhum.
  const passos = [
    { key: "extrato", label: "Extrato", count: contasSemExtrato, feito: contasSemExtrato === 0 },
    { key: "revisar", label: "Revisar", count: linhasPendentes, feito: linhasPendentes === 0 },
    { key: "notas", label: "Notas", count: notasVencidas, feito: notasVencidas === 0 },
    {
      key: "conferir",
      label: "Conferir",
      count: aConciliar,
      feito: aConciliar === 0 && !saldoDivergente,
    },
    { key: "fechar", label: "Fechar", count: 0, feito: mesFechado || !podeFechar },
  ] as const;

  const indiceAtual = passos.findIndex((p) => !p.feito);
  const tudoEmDia = indiceAtual === -1;

  const steps: StepperStep[] = passos.map((passo, index) => ({
    key: passo.key,
    label: passo.label,
    count: passo.count,
    status:
      tudoEmDia || index < indiceAtual ? "done" : index === indiceAtual ? "current" : "upcoming",
  }));

  // Mesma checagem que /revisar, /lancamentos etc ja fazem — so conveniencia
  // de UI (RLS decide o resto de verdade), mas sem ela um cliente_leitura
  // via a mesma "Proxima acao" acionavel (Subir extrato, Fechar o mes) que
  // quem pode escrever, em vez do aviso de "so consulta".
  const canWrite = hasRole(session.role, "assistente");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Olá, {session.company.name}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            saldo consolidado <Money cents={saldoAtual} className="font-medium" />
          </p>
        </div>
        <MesDeTrabalho
          companyId={companyId}
          periodo={periodoTrabalho}
          emAutomatico={!periodoManual}
        />
      </div>

      <Card>
        <div className="p-4">
          <Stepper steps={steps} />
        </div>
      </Card>

      {projecao?.firstNegativeDate && (
        <Alert tone="error" title="O caixa fica negativo antes do fim do mês">
          Pelo que está previsto, o saldo consolidado fica negativo em{" "}
          <strong>{formatDate(projecao.firstNegativeDate)}</strong>, chegando a{" "}
          <Money cents={projecao.lowestBalance} />
          {projecao.lowestBalanceDate ? ` em ${formatDate(projecao.lowestBalanceDate)}` : ""}.
        </Alert>
      )}

      {tudoEmDia ? (
        <Alert tone="success" title="Tudo em dia">
          {mesFechado
            ? `${formatMonth(periodoTrabalho)} está revisado, cobrado, conferido e fechado. Não há nada esperando você agora.`
            : `${formatMonth(periodoTrabalho)} está revisado, cobrado e conferido. Assim que o mês terminar, feche por aqui.`}
        </Alert>
      ) : (
        <ProximaAcao
          companyId={companyId}
          passoKey={passos[indiceAtual]!.key}
          lastImportLabel={
            lastImport
              ? `Último extrato: ${new Date(lastImport.created_at).toLocaleDateString("pt-BR")}${lastImport.file_name ? ` (${lastImport.file_name})` : ""}`
              : "Nenhum extrato importado ainda."
          }
          contasSemExtrato={contasSemExtrato}
          linhasPendentes={linhasPendentes}
          notasVencidas={notasVencidas}
          aConciliar={aConciliar}
          saldoDivergente={saldoDivergente}
          mes={formatMonth(periodoTrabalho)}
          periodo={periodoTrabalho}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}

function ProximaAcao({
  companyId,
  passoKey,
  lastImportLabel,
  contasSemExtrato,
  linhasPendentes,
  notasVencidas,
  aConciliar,
  saldoDivergente,
  mes,
  periodo,
  canWrite,
}: {
  companyId: string;
  passoKey: "extrato" | "revisar" | "notas" | "conferir" | "fechar";
  lastImportLabel: string;
  contasSemExtrato: number;
  linhasPendentes: number;
  notasVencidas: number;
  aConciliar: number;
  saldoDivergente: boolean;
  mes: string;
  periodo: IsoDate;
  canWrite: boolean;
}) {
  if (!canWrite) {
    return (
      <Alert tone="info">
        Seu perfil pode consultar, mas não fazer alterações. Peça a um assistente, contador ou
        responsável pela empresa.
      </Alert>
    );
  }

  const conteudo: Record<
    typeof passoKey,
    {
      icon: typeof Upload;
      titulo: string;
      descricao: string;
      acaoLabel: string;
      href: ReturnType<typeof routes.today>;
    }
  > = {
    extrato: {
      icon: Upload,
      titulo: `${contasSemExtrato} conta(s) sem extrato de ${mes}`,
      descricao: lastImportLabel,
      acaoLabel: "Subir extrato",
      href: routes.home(companyId),
    },
    revisar: {
      icon: FileCheck2,
      titulo: `${linhasPendentes} movimento(s) do extrato esperam sua revisão`,
      descricao:
        "Correspondência incerta ou sem categoria — o resto o sistema já organizou sozinho.",
      acaoLabel: "Revisar agora",
      href: routes.reviewQueue(companyId),
    },
    notas: {
      icon: HandCoins,
      titulo: `${notasVencidas} nota(s) fiscal(is) vencida(s) esperando cobrança`,
      descricao: "Emitidas há mais de 45 dias e ainda em aberto.",
      acaoLabel: "Ver em Recebimentos",
      href: routes.receivables(companyId),
    },
    conferir: {
      icon: CheckCircle2,
      titulo: saldoDivergente
        ? "O saldo do sistema não bate com o extrato"
        : `${aConciliar} lançamento(s) ainda não conciliado(s)`,
      descricao: saldoDivergente
        ? "Pelo menos uma conta tem diferença entre o saldo declarado no extrato e o calculado pelo sistema."
        : "Confira se todo lançamento tem uma linha do extrato correspondente.",
      acaoLabel: "Conferir em Conciliação",
      href: routes.reconciliation(companyId),
    },
    fechar: {
      icon: LockOpen,
      titulo: `Tudo pronto — feche ${mes}`,
      descricao:
        "Grava o saldo de cada conta agora e trava os lançamentos deste mês contra alteração.",
      acaoLabel: "Fechar o mês",
      href: routes.transactions(companyId, { month: periodo }),
    },
  };

  const { icon: Icon, titulo, descricao, acaoLabel, href } = conteudo[passoKey];

  return (
    <Card>
      <CardHeader title="Próxima ação" />
      <div className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
        <div className="bg-primary/10 text-primary flex size-12 shrink-0 items-center justify-center rounded-full">
          <Icon className="size-6" aria-hidden />
        </div>
        <div className="flex-1">
          <p className="text-base font-semibold">{titulo}</p>
          <p className="text-muted-foreground mt-1 text-sm">{descricao}</p>
        </div>
        <LinkButton href={href} variant="primary" className="w-full sm:w-auto">
          {acaoLabel}
        </LinkButton>
      </div>
    </Card>
  );
}
