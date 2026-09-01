import { ROLE_LABELS } from "@aec/db";
import { fromDb, type IsoDate, startOfMonth, sum, todayInBrazil } from "@aec/domain";
import { redirect } from "next/navigation";

import { listCompanies } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  LinkButton,
  Logo,
  Money,
} from "@/lib/ui/components";
import { formatMonth, formatTaxId, isInvoiceOverdue } from "@/lib/ui/format";
import { routes, withQuery } from "@/lib/ui/routes";

export const metadata = { title: "Empresas — Controle Bancario" };

interface StatusEmpresa {
  readonly companyId: string;
  readonly saldoAtual: number;
  readonly contasAtivas: number;
  readonly contasComExtratoDoMes: number;
  readonly linhasPendentes: number;
  readonly aConciliar: number;
  readonly notasVencidas: number;
  readonly aReceber: number;
  readonly mesFechado: boolean;
}

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const params = await searchParams;
  const companies = await listCompanies();

  async function criarEmpresa(formData: FormData) {
    "use server";

    const nome = String(formData.get("nome") ?? "").trim();
    const razao = String(formData.get("razao") ?? "").trim();
    const cnpj = String(formData.get("cnpj") ?? "").trim();

    const supabase = await createServerSupabase();
    // RPC porque criar empresa e criar o vinculo de dono precisam acontecer na
    // mesma transacao — ver public.create_company nas migrations.
    const { data, error } = await supabase.rpc("create_company", {
      p_name: nome,
      p_legal_name: razao || null,
      p_tax_id: cnpj || null,
    });

    if (error) redirect(withQuery(routes.companies, { erro: error.message }));
    redirect(routes.accounts((data as { id: string }).id));
  }

  const statusPorEmpresa =
    companies.length > 0 ? await carregarStatus(companies.map((c) => c.id)) : new Map();

  // Quem precisa de atencao primeiro sobe na lista — nao e uma lista
  // alfabetica de nomes, e o "como estao os extratos, financas e
  // fechamentos" que o dono pediu numa tela so.
  const ordenadas = [...companies].sort((a, b) => {
    const scoreA = pontuarAtencao(statusPorEmpresa.get(a.id));
    const scoreB = pontuarAtencao(statusPorEmpresa.get(b.id));
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Logo className="text-2xl" />
      <h1 className="mt-4 text-xl font-semibold">Empresas</h1>

      {params.erro && (
        <div className="mt-4">
          <Alert tone="error">{params.erro}</Alert>
        </div>
      )}

      {companies.length > 0 && (
        <div className="mt-6 space-y-3">
          {ordenadas.map((company) => (
            <LinhaEmpresa
              key={company.id}
              company={company}
              status={statusPorEmpresa.get(company.id)}
            />
          ))}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader title="Cadastrar empresa" />
        <form action={criarEmpresa} className="space-y-4 p-4">
          {companies.length === 0 && (
            <Alert tone="info">
              Cadastre a primeira empresa para comecar. Depois voce cria as contas bancarias com o
              saldo do dia em que vai parar de usar a planilha.
            </Alert>
          )}

          <Field label="Nome">
            <Input name="nome" required placeholder="Como voce chama a empresa no dia a dia" />
          </Field>

          <Field label="Razao social" hint="Opcional">
            <Input name="razao" />
          </Field>

          <Field label="CNPJ" hint="Opcional. Pode digitar com ou sem pontuacao.">
            <Input name="cnpj" inputMode="numeric" placeholder="00.000.000/0000-00" />
          </Field>

          <Button type="submit">Cadastrar</Button>
        </form>
      </Card>
    </main>
  );
}

function pontuarAtencao(status: StatusEmpresa | undefined): number {
  if (!status) return 0;
  let score = 0;
  if (status.linhasPendentes > 0) score++;
  if (status.aConciliar > 0) score++;
  if (status.notasVencidas > 0) score++;
  if (status.contasAtivas > 0 && status.contasComExtratoDoMes < status.contasAtivas) score++;
  return score;
}

function LinhaEmpresa({
  company,
  status,
}: {
  company: Awaited<ReturnType<typeof listCompanies>>[number];
  status: StatusEmpresa | undefined;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium">{company.name}</p>
          <p className="text-muted-foreground text-xs">
            {formatTaxId(company.tax_id)} {company.tax_id && "·"} {ROLE_LABELS[company.role]}
          </p>

          {status ? (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="tabular-money font-medium">
                <Money cents={status.saldoAtual} />
              </span>
              {status.contasAtivas > 0 && status.contasComExtratoDoMes < status.contasAtivas && (
                <Badge tone="warn">
                  extrato de {status.contasAtivas - status.contasComExtratoDoMes} de{" "}
                  {status.contasAtivas} conta(s) faltando
                </Badge>
              )}
              {status.linhasPendentes > 0 && (
                <Badge>{status.linhasPendentes} movimento(s) sem revisar</Badge>
              )}
              {status.aConciliar > 0 && <Badge>{status.aConciliar} sem conciliar</Badge>}
              {status.notasVencidas > 0 && (
                <Badge tone="warn">{status.notasVencidas} nota(s) vencida(s)</Badge>
              )}
              {status.aReceber > 0 && (
                <span className="text-muted-foreground text-xs">
                  a receber <Money cents={status.aReceber} />
                </span>
              )}
              <span className="text-muted-foreground text-xs">
                {formatMonth(startOfMonth(todayInBrazil()))}{" "}
                {status.mesFechado ? "fechado" : "em aberto"}
              </span>
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">Nenhuma conta bancária cadastrada.</p>
          )}
        </div>

        <LinkButton href={routes.today(company.id)} className="shrink-0">
          Abrir
        </LinkButton>
      </div>
    </Card>
  );
}

/**
 * Uma consulta por tabela com `.in("company_id", ids)`, nao uma por empresa —
 * o RLS ja limita as empresas dela, o `.in()` so serve para agrupar em JS.
 * Nao cresce com o numero de empresas na carteira.
 */
async function carregarStatus(companyIds: string[]): Promise<Map<string, StatusEmpresa>> {
  const supabase = await createServerSupabase();
  const hoje = todayInBrazil();
  const inicioDoMes = startOfMonth(hoje);

  const [saldosResult, contasResult, linhasResult, importsResult, notasResult, fechamentosResult] =
    await Promise.all([
      supabase
        .from("v_account_balances")
        .select("company_id, current_balance, unreconciled_count")
        .in("company_id", companyIds),
      supabase
        .from("bank_accounts")
        .select("id, company_id")
        .in("company_id", companyIds)
        .eq("is_active", true),
      supabase
        .from("statement_lines")
        .select("id, company_id")
        .in("company_id", companyIds)
        .eq("status", "pendente"),
      supabase
        .from("statement_imports")
        .select("company_id, bank_account_id, created_at")
        .in("company_id", companyIds)
        .gte("created_at", inicioDoMes),
      supabase
        .from("v_invoice_balances")
        .select("company_id, issued_on, outstanding_amount")
        .in("company_id", companyIds)
        .gt("outstanding_amount", 0),
      supabase
        .from("monthly_closings")
        .select("company_id, locked_at")
        .in("company_id", companyIds)
        .eq("period", inicioDoMes),
    ]);

  // Melhor esforco: uma consulta falhando nao pode derrubar a carteira
  // inteira — a empresa so aparece sem aquele numero.
  const saldos = saldosResult.error ? [] : (saldosResult.data ?? []);
  const contas = contasResult.error ? [] : (contasResult.data ?? []);
  const linhas = linhasResult.error ? [] : (linhasResult.data ?? []);
  const imports = importsResult.error ? [] : (importsResult.data ?? []);
  const notas = notasResult.error ? [] : (notasResult.data ?? []);
  const fechamentos = fechamentosResult.error ? [] : (fechamentosResult.data ?? []);

  const status = new Map<string, StatusEmpresa>();

  for (const companyId of companyIds) {
    const saldosDaEmpresa = saldos.filter((s) => s.company_id === companyId);
    if (saldosDaEmpresa.length === 0) continue;

    const contasComExtrato = new Set(
      imports.filter((i) => i.company_id === companyId).map((i) => i.bank_account_id),
    );
    const notasDaEmpresa = notas.filter((n) => n.company_id === companyId);
    const vencidas = notasDaEmpresa.filter(
      (n) => n.issued_on && isInvoiceOverdue(n.issued_on as IsoDate, fromDb(n.outstanding_amount)),
    );

    status.set(companyId, {
      companyId,
      saldoAtual: sum(saldosDaEmpresa.map((s) => fromDb(s.current_balance))),
      contasAtivas: contas.filter((c) => c.company_id === companyId).length,
      contasComExtratoDoMes: contasComExtrato.size,
      linhasPendentes: linhas.filter((l) => l.company_id === companyId).length,
      aConciliar: saldosDaEmpresa.reduce((total, s) => total + Number(s.unreconciled_count), 0),
      notasVencidas: vencidas.length,
      aReceber: sum(notasDaEmpresa.map((n) => fromDb(n.outstanding_amount))),
      mesFechado: fechamentos.some((f) => f.company_id === companyId && f.locked_at),
    });
  }

  return status;
}
