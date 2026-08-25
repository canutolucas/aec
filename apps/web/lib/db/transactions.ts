/**
 * Server Actions de lancamento.
 *
 * Sao o unico caminho de escrita da tela para a tabela `transactions`. Cada uma
 * converte o que a pessoa digitou para centavos, e de centavos para `numeric` —
 * um float jamais entra no caminho entre o teclado e o banco.
 *
 * Erro do banco e devolvido traduzido. Uma policy de RLS recusando escrita em mes
 * fechado devolve "new row violates row-level security policy", que nao ajuda
 * ninguem; a pessoa precisa ler "o mes esta fechado".
 */

"use server";

import { parseUserInput, toDb } from "@aec/domain";
import { MoneyError } from "@aec/domain";
import { revalidatePath } from "next/cache";

import { createServerSupabase } from "./supabase";

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

const OK: ActionResult = { ok: true };

/**
 * Traduz o erro do Postgres para algo acionavel.
 *
 * O codigo 42501 vindo de `transactions` e quase sempre a trava de mes fechado:
 * e a unica policy de escrita que a pessoa consegue esbarrar sem ter mudado de
 * papel no meio da sessao.
 */
function traduzErro(error: { code?: string; message: string }): string {
  if (error.code === "42501") {
    return "Nao foi possivel gravar. O mes provavelmente esta fechado — reabra o fechamento (com motivo) ou confira se o seu perfil permite lancar.";
  }
  if (error.code === "23514") {
    return error.message.includes("saldo inicial")
      ? "A data do lancamento e anterior ao saldo inicial da conta. Ajuste a data, ou o saldo inicial da conta."
      : `Dado invalido: ${error.message}`;
  }
  if (error.code === "23503") {
    return "Conta, categoria ou contraparte nao pertence a esta empresa.";
  }
  return error.message;
}

interface LancamentoInput {
  companyId: string;
  bankAccountId: string;
  bookingDate: string;
  competenceDate?: string;
  /** Valor sempre positivo; o sentido vem de `direction`. */
  amount: string;
  direction: "entrada" | "saida";
  status: "realizado" | "previsto";
  description: string;
  categoryId?: string | null;
  counterpartyId?: string | null;
  documentNumber?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
}

export async function criarLancamento(input: LancamentoInput): Promise<ActionResult> {
  let valor: number;
  try {
    valor = Math.abs(parseUserInput(input.amount));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof MoneyError ? `Valor invalido: ${input.amount}` : String(error),
    };
  }

  if (valor === 0) {
    return { ok: false, error: "O valor precisa ser diferente de zero." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("transactions").insert({
    company_id: input.companyId,
    bank_account_id: input.bankAccountId,
    booking_date: input.bookingDate,
    competence_date: input.competenceDate || input.bookingDate,
    amount: toDb(input.direction === "saida" ? -valor : valor),
    status: input.status,
    description: input.description.trim(),
    category_id: input.categoryId || null,
    counterparty_id: input.counterpartyId || null,
    document_number: input.documentNumber?.trim() || null,
    payment_method: input.paymentMethod || null,
    notes: input.notes?.trim() || null,
  });

  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${input.companyId}/lancamentos`);
  revalidatePath(`/${input.companyId}/painel`);
  return OK;
}

export async function excluirLancamento(
  companyId: string,
  transactionId: string,
): Promise<ActionResult> {
  const supabase = await createServerSupabase();

  const { data, error } = await supabase
    .from("transactions")
    .delete()
    .eq("id", transactionId)
    .select("id");

  if (error) return { ok: false, error: traduzErro(error) };

  // RLS nega DELETE em silencio: a linha simplesmente deixa de ser alcancavel e
  // zero linhas sao afetadas, sem erro nenhum. Sem esta verificacao a tela diria
  // "excluido" para um lancamento que continua la.
  if (!data || data.length === 0) {
    return {
      ok: false,
      error:
        "Nada foi excluido. O lancamento pode estar em um mes fechado, ou seu perfil nao permite excluir.",
    };
  }

  revalidatePath(`/${companyId}/lancamentos`);
  revalidatePath(`/${companyId}/painel`);
  return OK;
}

export async function criarTransferencia(input: {
  companyId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: string;
  bookingDate: string;
  description: string;
}): Promise<ActionResult> {
  let valor: number;
  try {
    valor = Math.abs(parseUserInput(input.amount));
  } catch {
    return { ok: false, error: `Valor invalido: ${input.amount}` };
  }

  if (valor === 0) return { ok: false, error: "O valor precisa ser diferente de zero." };
  if (input.fromAccountId === input.toAccountId) {
    return { ok: false, error: "Conta de origem e destino nao podem ser a mesma." };
  }

  const supabase = await createServerSupabase();
  // RPC porque os dois lados tem de nascer na mesma transacao — ver
  // public.create_transfer nas migrations.
  const { error } = await supabase.rpc("create_transfer", {
    p_company_id: input.companyId,
    p_from_account_id: input.fromAccountId,
    p_to_account_id: input.toAccountId,
    p_amount: toDb(valor),
    p_booking_date: input.bookingDate,
    p_description: input.description.trim() || "Transferencia entre contas",
    p_notes: null,
  });

  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${input.companyId}/lancamentos`);
  revalidatePath(`/${input.companyId}/painel`);
  return OK;
}

export async function darBaixa(
  companyId: string,
  transactionId: string,
  bookingDate?: string,
): Promise<ActionResult> {
  const supabase = await createServerSupabase();

  const { error } = await supabase.rpc("settle_transaction", {
    p_transaction_id: transactionId,
    p_booking_date: bookingDate ?? null,
    p_amount: null,
  });

  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${companyId}/lancamentos`);
  revalidatePath(`/${companyId}/painel`);
  return OK;
}
