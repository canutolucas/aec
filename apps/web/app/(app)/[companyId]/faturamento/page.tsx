import { hasRole, type InvoiceBalance } from "@aec/db";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";
import { Alert } from "@/lib/ui/components";

import { SubNav } from "../sub-nav";
import type { BaixaDaNota } from "./baixas-da-nota";
import { FaturamentoClient } from "./faturamento-client";

export const metadata = { title: "Faturamento — Controle Bancario" };

export default async function FaturamentoPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const session = await requireCompany(companyId);

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("v_invoice_balances")
    .select("*")
    .eq("company_id", companyId)
    .order("issued_on", { ascending: false });
  if (error) throw error;

  const podeImportar = hasRole(session.role, "assistente");

  // `number` e texto, nao inteiro — ordenar como string colocaria "10" antes
  // de "9". `numeric: true` no collator compara pelo valor numerico dentro
  // da string, entao a lista sai na ordem que a numeracao da nota realmente
  // segue (pedido da usuaria final).
  const invoices = ((data ?? []) as InvoiceBalance[])
    .slice()
    .sort((a, b) => a.number.localeCompare(b.number, "pt-BR", { numeric: true }));

  // Todas as baixas da empresa, em lote — de onde vem o rateio que
  // aparecia so como `.select("transaction_id")` em autoApplyReceivables;
  // nenhuma tela ate esta leva mostrava o valor de cada baixa.
  const [settlementsResult, contasResult] = await Promise.all([
    supabase
      .from("invoice_settlements")
      .select("id, invoice_id, amount, created_at, transaction_id")
      .eq("company_id", companyId),
    supabase.from("bank_accounts").select("id, name").eq("company_id", companyId),
  ]);
  if (settlementsResult.error) throw settlementsResult.error;
  if (contasResult.error) throw contasResult.error;

  const idsLancamentos = (settlementsResult.data ?? []).map((s) => s.transaction_id);
  const lancamentosResult =
    idsLancamentos.length > 0
      ? await supabase
          .from("transactions")
          .select("id, description, booking_date, bank_account_id")
          .in("id", idsLancamentos)
      : { data: [] };

  const nomePorConta = new Map((contasResult.data ?? []).map((c) => [c.id, c.name]));
  const lancamentoPorId = new Map((lancamentosResult.data ?? []).map((t) => [t.id, t]));

  const baixasPorNota = new Map<string, BaixaDaNota[]>();
  for (const settlement of settlementsResult.data ?? []) {
    const lancamento = lancamentoPorId.get(settlement.transaction_id);
    const lista = baixasPorNota.get(settlement.invoice_id) ?? [];
    lista.push({
      id: settlement.id,
      amount: settlement.amount,
      createdAt: settlement.created_at,
      transactionDescription: lancamento?.description ?? null,
      transactionBookingDate: lancamento?.booking_date ?? null,
      bankAccountName: lancamento ? (nomePorConta.get(lancamento.bank_account_id) ?? null) : null,
    });
    baixasPorNota.set(settlement.invoice_id, lista);
  }

  return (
    <div className="space-y-6">
      <SubNav group="notas" active="faturamento" companyId={companyId} session={session} />

      <div>
        <h1 className="text-xl font-semibold">Faturamento</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Importe o XML de cada nota fiscal emitida. O recebimento é conciliado em Recebimentos,
          quando o extrato do banco chegar.
        </p>
      </div>

      {!podeImportar && (
        <Alert tone="info">
          Seu perfil pode consultar, mas não pode importar notas fiscais. Peça a um assistente,
          contador ou responsável.
        </Alert>
      )}

      <FaturamentoClient
        companyId={companyId}
        podeImportar={podeImportar}
        invoices={invoices}
        baixasPorNota={baixasPorNota}
      />
    </div>
  );
}
