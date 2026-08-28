import { type BankAccount, type Category, hasRole, listMatchingRules } from "@aec/db";
import { addDays, fromDb, type IsoDate, project, sum, todayInBrazil } from "@aec/domain";
import { Card, CardHeader } from "@aec/ui";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert, Money } from "@/lib/ui/components";
import { formatDate, isInvoiceOverdue } from "@/lib/ui/format";
import { routes } from "@/lib/ui/routes";

import { SubNav } from "../sub-nav";
import { InicioClient } from "./inicio-client";
import { InstallHint } from "./install-hint";

export const metadata = { title: "Início — Controle Bancario" };

export type InicioAccount = Pick<BankAccount, "id" | "name" | "bank_name">;

// Mesmo horizonte usado em /painel — a mesma pergunta ("o caixa aguenta os
// proximos 30 dias?") nao pode ter uma resposta diferente so por ter sido
// feita numa tela diferente.
const HORIZONTE_DIAS = 30;

export default async function InicioPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);
  const supabase = await createServerSupabase();

  const hoje = todayInBrazil();
  const fimDoHorizonte = addDays(hoje, HORIZONTE_DIAS);

  const [
    accountsResult,
    categoriesResult,
    lastImportResult,
    invoicesResult,
    matchingRules,
    balancesResult,
    plannedResult,
  ] = await Promise.all([
    supabase
      .from("bank_accounts")
      .select("id, name, bank_name")
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
    // listMatchingRules lanca em erro (ao contrario dos demais acima, que
    // devolvem {data, error}) — .catch aqui preserva o mesmo "melhor
    // esforco" do resto deste card: uma falha nao derruba a pagina inteira.
    listMatchingRules(supabase, companyId).catch(() => []),
    // Mesmas duas consultas que /painel usa pra montar o alerta de caixa —
    // quem usa o modo simples nunca ve /painel, entao sem isto aqui o aviso
    // mais importante do sistema (o caixa vai ficar negativo) so existia
    // pra quem tem acesso avancado.
    supabase.from("v_account_balances").select("current_balance").eq("company_id", companyId),
    supabase
      .from("transactions")
      .select("booking_date, amount, description")
      .eq("company_id", companyId)
      .eq("status", "previsto")
      .lte("booking_date", fimDoHorizonte)
      .order("booking_date"),
  ]);

  if (accountsResult.error) throw accountsResult.error;
  if (categoriesResult.error) throw categoriesResult.error;

  const canUpload = hasRole(session.role, "assistente");
  const accounts = (accountsResult.data ?? []) as InicioAccount[];
  const categories = (categoriesResult.data ?? []) as Category[];

  // Melhor esforco: um erro aqui e so informativo (o "Status do mes"), nao
  // impede o resto da tela de funcionar — a tela inteira nao deveria cair
  // por causa de um card de status.
  const lastImport = lastImportResult.error ? null : lastImportResult.data;
  const notasVencidas = invoicesResult.error
    ? 0
    : (invoicesResult.data ?? []).filter(
        (inv) =>
          inv.issued_on &&
          inv.outstanding_amount &&
          isInvoiceOverdue(inv.issued_on as IsoDate, fromDb(inv.outstanding_amount)),
      ).length;

  // Mesma projecao de /painel (mesma funcao de dominio, mesmo horizonte) —
  // so nao trava a pagina se alguma das duas consultas falhar.
  const projecao =
    balancesResult.error || plannedResult.error
      ? null
      : project({
          openingBalance: sum(
            (balancesResult.data ?? []).map((row) => fromDb(row.current_balance)),
          ),
          from: hoje,
          to: fimDoHorizonte,
          entries: (plannedResult.data ?? []).map((previsto) => ({
            bookingDate: previsto.booking_date as IsoDate,
            amount: fromDb(previsto.amount),
            status: "previsto" as const,
            description: previsto.description,
          })),
        });

  return (
    <div className="space-y-6">
      <SubNav group="movimentos" active="inicio" companyId={companyId} session={session} />

      <div>
        <h1 className="text-xl font-semibold">Ola, {session.company.name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Suba o extrato do banco abaixo e o mes fica organizado sozinho.
        </p>
      </div>

      <InstallHint />

      {projecao?.firstNegativeDate && (
        <Alert tone="error" title="O caixa fica negativo antes do fim do mes">
          Pelo que esta previsto, o saldo consolidado fica negativo em{" "}
          <strong>{formatDate(projecao.firstNegativeDate)}</strong>, chegando a{" "}
          <Money cents={projecao.lowestBalance} />
          {projecao.lowestBalanceDate ? ` em ${formatDate(projecao.lowestBalanceDate)}` : ""}.
        </Alert>
      )}

      <Card>
        <CardHeader title="Status do mes" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <p className="text-sm">
            {lastImport ? (
              <>
                Ultimo extrato importado:{" "}
                <span className="font-medium">
                  {new Date(lastImport.created_at).toLocaleDateString("pt-BR")}
                </span>
                {lastImport.file_name ? ` (${lastImport.file_name})` : ""}
              </>
            ) : (
              "Nenhum extrato importado ainda."
            )}
          </p>
          <p className="text-sm">
            {notasVencidas > 0 ? (
              <>
                <span className="text-destructive font-semibold">{notasVencidas}</span> nota(s)
                fiscal(is) em aberto ha mais de 45 dias.{" "}
                <a
                  href={routes.receivables(companyId)}
                  className="underline underline-offset-2 hover:no-underline"
                >
                  Ver em Recebimentos
                </a>
              </>
            ) : (
              "Nenhuma nota fiscal vencida."
            )}
          </p>
          <p className="text-sm">
            {matchingRules.length > 0 ? (
              <>
                <span className="font-medium">{matchingRules.length}</span> regra(s) automatica(s)
                ativa(s).{" "}
                <a
                  href={routes.rules(companyId)}
                  className="underline underline-offset-2 hover:no-underline"
                >
                  Ver e gerenciar
                </a>
              </>
            ) : (
              "Nenhuma regra automatica ativa ainda."
            )}
          </p>
        </div>
      </Card>

      {!canUpload ? (
        <Alert tone="info">
          Seu perfil pode consultar, mas nao subir extratos. Peca a um assistente, contador ou
          responsavel pela empresa.
        </Alert>
      ) : accounts.length === 0 ? (
        <Alert tone="warn">
          Nenhuma conta bancaria cadastrada ainda. Peca a um contador ou responsavel para cadastrar
          a conta antes de subir o primeiro extrato.
        </Alert>
      ) : (
        <InicioClient companyId={companyId} accounts={accounts} categories={categories} />
      )}
    </div>
  );
}
