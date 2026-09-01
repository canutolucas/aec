import { type BankAccount, hasRole } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert } from "@/lib/ui/components";

import { type BaixaDaNota } from "../faturamento/baixas-da-nota";
import { SubNav } from "../sub-nav";
import { RecebimentosClient } from "./recebimentos-client";

export const metadata = { title: "Recebimentos — Controle Bancario" };

export type RecebimentosAccount = Pick<BankAccount, "id" | "name" | "bank_name">;

export interface NotaComBaixas {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly baixas: readonly BaixaDaNota[];
  readonly ultimaBaixaEm: string;
}

const LIMITE_BAIXAS = 200;

export default async function RecebimentosPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("id, name, bank_name")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .order("name");
  if (error) throw error;

  const podeConciliar = hasRole(session.role, "assistente");
  const accounts = (data ?? []) as RecebimentosAccount[];

  // Baixas registradas recentemente — pedido real: nenhuma tela ate esta
  // leva mostrava o rateio de uma baixa, e cancelarNota/undo_transaction_
  // from_line mandam "desfaca a baixa em Recebimentos primeiro" sem essa
  // acao existir em lugar nenhum. So as N mais recentes; card e so de
  // leitura + desfazer, nao mexe no fluxo de autoApplyReceivables.
  const [settlementsResult, invoicesResult, contasResult] = await Promise.all([
    supabase
      .from("invoice_settlements")
      .select("id, invoice_id, amount, created_at, transaction_id")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(LIMITE_BAIXAS),
    supabase.from("invoices").select("id, number").eq("company_id", companyId),
    supabase.from("bank_accounts").select("id, name").eq("company_id", companyId),
  ]);
  if (settlementsResult.error) throw settlementsResult.error;
  if (invoicesResult.error) throw invoicesResult.error;
  if (contasResult.error) throw contasResult.error;

  const idsLancamentos = (settlementsResult.data ?? []).map((s) => s.transaction_id);
  const lancamentosResult =
    idsLancamentos.length > 0
      ? await supabase
          .from("transactions")
          .select("id, description, booking_date, bank_account_id")
          .in("id", idsLancamentos)
      : { data: [] };

  const numeroPorNota = new Map((invoicesResult.data ?? []).map((i) => [i.id, i.number]));
  const nomePorConta = new Map((contasResult.data ?? []).map((c) => [c.id, c.name]));
  const lancamentoPorId = new Map((lancamentosResult.data ?? []).map((t) => [t.id, t]));

  const notasComBaixas = new Map<string, NotaComBaixas>();
  for (const settlement of settlementsResult.data ?? []) {
    const lancamento = lancamentoPorId.get(settlement.transaction_id);
    const baixa: BaixaDaNota = {
      id: settlement.id,
      amount: settlement.amount,
      createdAt: settlement.created_at,
      transactionDescription: lancamento?.description ?? null,
      transactionBookingDate: lancamento?.booking_date ?? null,
      bankAccountName: lancamento ? (nomePorConta.get(lancamento.bank_account_id) ?? null) : null,
    };
    const existente = notasComBaixas.get(settlement.invoice_id);
    if (existente) {
      (existente.baixas as BaixaDaNota[]).push(baixa);
    } else {
      notasComBaixas.set(settlement.invoice_id, {
        invoiceId: settlement.invoice_id,
        invoiceNumber: numeroPorNota.get(settlement.invoice_id) ?? "—",
        baixas: [baixa],
        ultimaBaixaEm: settlement.created_at,
      });
    }
  }
  // A consulta ja vem ordenada por created_at desc; a ordem de insercao no
  // Map preserva isso, entao a nota com a baixa mais recente aparece primeiro.
  const recentes = [...notasComBaixas.values()];

  return (
    <div className="space-y-6">
      <SubNav group="notas" active="recebimentos" companyId={companyId} session={session} />

      <div>
        <h1 className="text-xl font-semibold">Recebimentos</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Casa os créditos do extrato com as notas fiscais em aberto — de qualquer banco, não só um
          banco fixo por nota.
        </p>
      </div>

      {!podeConciliar ? (
        <Alert tone="info">
          Seu perfil pode consultar, mas não pode conciliar recebimentos. Peça a um assistente,
          contador ou responsável.
        </Alert>
      ) : accounts.length === 0 ? (
        <Alert tone="warn">Nenhuma conta bancária cadastrada ainda.</Alert>
      ) : (
        <RecebimentosClient
          companyId={companyId}
          accounts={accounts}
          notasComBaixas={recentes}
          podeDesfazer={podeConciliar}
        />
      )}
    </div>
  );
}
