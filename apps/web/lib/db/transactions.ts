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

import type { PaymentMethod, Transaction } from "@aec/db";
import {
  canSettle,
  canUnsettle,
  editLocks,
  fromDb,
  parseUserInput,
  startOfMonth,
  toDb,
  type TransactionLock,
  type TransactionState,
} from "@aec/domain";
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

type SupabaseServerClient = Awaited<ReturnType<typeof createServerSupabase>>;

/**
 * Carrega um lancamento e monta o `TransactionState` (@aec/domain) que
 * `editLocks`/`canSettle`/`canUnsettle` precisam — sem isto, cada Server
 * Action teria que remontar essas tres consultas na mao. Mes fechado e
 * verificado aqui (nao so pela RLS) para a mensagem de erro vir clara
 * ANTES de qualquer escrita, em vez do 42501 generico do Postgres.
 */
async function carregarLancamento(
  supabase: SupabaseServerClient,
  companyId: string,
  transactionId: string,
): Promise<{ ok: true; row: Transaction; state: TransactionState } | { ok: false; error: string }> {
  const txResult = await supabase
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (txResult.error) return { ok: false, error: traduzErro(txResult.error) };
  if (!txResult.data) return { ok: false, error: "Lancamento nao encontrado." };
  const row = txResult.data as Transaction;

  const [settlementResult, closingResult] = await Promise.all([
    supabase.from("invoice_settlements").select("id").eq("transaction_id", row.id).limit(1),
    supabase
      .from("monthly_closings")
      .select("locked_at")
      .eq("company_id", companyId)
      .eq("period", startOfMonth(row.booking_date))
      .maybeSingle(),
  ]);

  if (settlementResult.error) return { ok: false, error: traduzErro(settlementResult.error) };
  if (closingResult.error) return { ok: false, error: traduzErro(closingResult.error) };

  const state: TransactionState = {
    status: row.status,
    reconciled: row.reconciliation === "conciliado",
    hasInvoiceSettlement: (settlementResult.data?.length ?? 0) > 0,
    isTransfer: row.is_transfer,
    periodLocked: Boolean(closingResult.data?.locked_at),
  };

  return { ok: true, row, state };
}

/** Mensagem por motivo de trava, na ordem em que `canUnsettle` as verifica. */
function motivoBloqueioDesfazer(state: TransactionState): string {
  if (state.periodLocked) {
    return "O mes deste lancamento esta fechado. Reabra o fechamento para voltar para previsto.";
  }
  if (state.isTransfer) {
    return "Uma perna de transferencia nao volta para previsto — exclua a transferencia e lance de novo.";
  }
  if (state.hasInvoiceSettlement) {
    return "Este lancamento ja tem baixa de nota fiscal — desfaca a baixa em Recebimentos antes de voltar para previsto.";
  }
  if (state.reconciled) {
    return "Este lancamento ja foi conciliado com o extrato — desfaca a conciliacao antes de voltar para previsto.";
  }
  return "Somente lancamentos realizados podem voltar para previsto.";
}

/** Mensagem por motivo de trava, na ordem em que `canSettle` as verifica. */
function motivoBloqueioBaixa(state: TransactionState): string {
  if (state.periodLocked) {
    return "O mes deste lancamento esta fechado. Reabra o fechamento para dar baixa.";
  }
  if (state.isTransfer) {
    return "Uma perna de transferencia nao recebe baixa.";
  }
  if (state.status !== "previsto") {
    return "Somente lancamentos previstos podem receber baixa.";
  }
  return "Nao foi possivel dar baixa neste lancamento.";
}

/**
 * Confere se o mes de uma data futura (diferente da que o lancamento ja
 * tem) esta aberto, ANTES de escrever — sem isto, a RLS recusaria em
 * silencio (mesmo buraco de `settle_transaction`, ver abaixo) e a tela
 * diria "salvo" sem nada ter mudado.
 */
async function mesDestinoFechado(
  supabase: SupabaseServerClient,
  companyId: string,
  bookingDate: string,
): Promise<{ error: string } | null> {
  const { data, error } = await supabase
    .from("monthly_closings")
    .select("locked_at")
    .eq("company_id", companyId)
    .eq("period", startOfMonth(bookingDate))
    .maybeSingle();
  if (error) return { error: traduzErro(error) };
  if (data?.locked_at) {
    return {
      error: `O mes de destino (${bookingDate}) esta fechado. Escolha outra data ou reabra o fechamento.`,
    };
  }
  return null;
}

const LOCK_LABEL: Record<TransactionLock, string> = {
  conciliado: "já foi conciliado com o extrato — desfaça a conciliação primeiro",
  baixaDeNota: "já tem baixa de nota fiscal — desfaça a baixa em Recebimentos primeiro",
  transferencia: "é uma perna de transferência — só o texto pode ser corrigido aqui",
  mesFechado: "está em um mês fechado",
};

/** Mensagem de recusa quando o pedido de edição mexe num campo travado. */
function motivoTravaCampo(nomeCampo: string, locks: readonly TransactionLock[]): string {
  return `Não é possível alterar ${nomeCampo}: este lançamento ${LOCK_LABEL[locks[0]!]}.`;
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
  costCenterId?: string | null;
  documentNumber?: string | null;
  paymentMethod?: PaymentMethod | null;
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
    cost_center_id: input.costCenterId || null,
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

/**
 * Da baixa num previsto com a data e o valor que de fato caíram — ate esta
 * leva, `darBaixa` so aceitava a data (e nem essa era usada na tela), e o
 * caso normal ("previsto R$1.000 pro dia 5, caiu R$1.012,30 no dia 8") nao
 * tinha como ser registrado.
 */
export async function darBaixa(input: {
  companyId: string;
  transactionId: string;
  /** Vazio mantem a data do previsto. */
  bookingDate?: string;
  /** Vazio mantem o valor do previsto. SEMPRE positivo — o sinal vem do servidor. */
  amount?: string;
}): Promise<ActionResult> {
  const supabase = await createServerSupabase();

  const carregado = await carregarLancamento(supabase, input.companyId, input.transactionId);
  if (!carregado.ok) return { ok: false, error: carregado.error };
  const { row, state } = carregado;

  if (!canSettle(state)) return { ok: false, error: motivoBloqueioBaixa(state) };

  const bookingDate = input.bookingDate?.trim() || row.booking_date;
  if (bookingDate !== row.booking_date) {
    const bloqueado = await mesDestinoFechado(supabase, input.companyId, bookingDate);
    if (bloqueado) return { ok: false, error: bloqueado.error };
  }

  let valorAbsoluto: number | null = null;
  if (input.amount?.trim()) {
    try {
      valorAbsoluto = Math.abs(parseUserInput(input.amount));
    } catch {
      return { ok: false, error: `Valor invalido: ${input.amount}` };
    }
    if (valorAbsoluto === 0) return { ok: false, error: "O valor precisa ser diferente de zero." };
  }

  // O sinal SEMPRE vem do previsto original, nunca do que a pessoa digitou —
  // um valor digitado positivo num previsto de saida nao pode virar receita
  // e inverter o resultado do mes inteiro sem aviso nenhum.
  const valorComSinal =
    valorAbsoluto === null ? null : toDb(fromDb(row.amount) < 0 ? -valorAbsoluto : valorAbsoluto);

  const { data, error } = await supabase.rpc("settle_transaction", {
    p_transaction_id: input.transactionId,
    p_booking_date: bookingDate,
    p_amount: valorComSinal,
  });

  if (error) return { ok: false, error: traduzErro(error) };
  // settle_transaction nao tem `if not found` apos o UPDATE (endurecido na
  // migration desta leva, mas o app nao pode confiar so nela): RLS
  // recusando em silencio devolve uma linha com todos os campos nulos, sem
  // erro nenhum. Sem esta checagem a tela diria "baixa dada" e nada teria
  // acontecido.
  if (!data?.id) {
    return {
      ok: false,
      error: "Nada foi alterado. Confira se o mes esta aberto e se seu perfil permite lancar.",
    };
  }

  revalidatePath(`/${input.companyId}/lancamentos`);
  revalidatePath(`/${input.companyId}/previstos`);
  revalidatePath(`/${input.companyId}/painel`);
  return OK;
}

/**
 * Volta um realizado para previsto — desfaz uma baixa, ou corrige "lancei
 * como realizado mas o dinheiro ainda nao caiu". Nao existe coluna que
 * distinga os dois casos: `settle_transaction` sempre atualiza a linha no
 * lugar, entao o caminho de volta e o mesmo pros dois.
 */
export async function desfazerBaixa(input: {
  companyId: string;
  transactionId: string;
  /** Vazio mantem a data atual (a que a baixa gravou). */
  bookingDate?: string;
  /** Vazio mantem o valor atual. SEMPRE positivo — o sinal vem do servidor. */
  amount?: string;
}): Promise<ActionResult> {
  const supabase = await createServerSupabase();

  const carregado = await carregarLancamento(supabase, input.companyId, input.transactionId);
  if (!carregado.ok) return { ok: false, error: carregado.error };
  const { row, state } = carregado;

  if (!canUnsettle(state)) return { ok: false, error: motivoBloqueioDesfazer(state) };

  const bookingDate = input.bookingDate?.trim() || row.booking_date;
  if (bookingDate !== row.booking_date) {
    const bloqueado = await mesDestinoFechado(supabase, input.companyId, bookingDate);
    if (bloqueado) return { ok: false, error: bloqueado.error };
  }

  let valorAbsoluto: number | null = null;
  if (input.amount?.trim()) {
    try {
      valorAbsoluto = Math.abs(parseUserInput(input.amount));
    } catch {
      return { ok: false, error: `Valor invalido: ${input.amount}` };
    }
    if (valorAbsoluto === 0) return { ok: false, error: "O valor precisa ser diferente de zero." };
  }

  const valorComSinal =
    valorAbsoluto === null
      ? row.amount
      : toDb(fromDb(row.amount) < 0 ? -valorAbsoluto : valorAbsoluto);

  const { data, error } = await supabase
    .from("transactions")
    .update({ status: "previsto", booking_date: bookingDate, amount: valorComSinal })
    .eq("id", input.transactionId)
    .eq("company_id", input.companyId)
    .select("id");

  if (error) return { ok: false, error: traduzErro(error) };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Nada foi alterado. Confira se o mes esta aberto e se seu perfil permite lancar.",
    };
  }

  revalidatePath(`/${input.companyId}/lancamentos`);
  revalidatePath(`/${input.companyId}/previstos`);
  revalidatePath(`/${input.companyId}/painel`);
  return OK;
}

export interface EditarLancamentoInput {
  companyId: string;
  transactionId: string;
  description: string;
  /** Magnitude sempre positiva — sentido nunca muda numa edicao (ver R11). */
  amount: string;
  bookingDate: string;
  competenceDate?: string;
  bankAccountId: string;
  categoryId?: string | null;
  counterpartyId?: string | null;
  costCenterId?: string | null;
  documentNumber?: string | null;
  paymentMethod?: PaymentMethod | null;
  notes?: string | null;
}

/**
 * Edita um lancamento ja existente — ate esta leva, so dava pra excluir e
 * relancar pra corrigir qualquer coisa, o que era impossivel se o mes ja
 * estivesse fechado. `editLocks` (@aec/domain) decide o que pode mudar: um
 * lancamento conciliado ou com baixa de nota fiscal trava valor/data/conta
 * (o que sustenta a prova de saldo e o rateio da nota) mas continua
 * editavel em tudo o mais — descricao, categoria, cliente, centro de
 * custo, documento, forma de pagamento, competencia, observacoes.
 *
 * Substitui `atualizarObservacoes`: duas Server Actions escrevendo a mesma
 * coluna `notes` era a divergencia que este arquivo evita em todo lugar.
 */
export async function editarLancamento(input: EditarLancamentoInput): Promise<ActionResult> {
  const supabase = await createServerSupabase();

  const carregado = await carregarLancamento(supabase, input.companyId, input.transactionId);
  if (!carregado.ok) return { ok: false, error: carregado.error };
  const { row, state } = carregado;

  if (state.periodLocked) {
    return {
      ok: false,
      error: "O mes deste lancamento esta fechado. Reabra o fechamento para editar.",
    };
  }

  let valor: number;
  try {
    valor = Math.abs(parseUserInput(input.amount));
  } catch {
    return { ok: false, error: `Valor invalido: ${input.amount}` };
  }
  if (valor === 0) return { ok: false, error: "O valor precisa ser diferente de zero." };

  // O servidor recalcula as travas e recusa explicitamente se o pedido
  // mexeu num campo travado — desabilitar o campo na tela e so
  // conveniencia, a recusa de verdade e aqui (o RLS por baixo tambem
  // barraria, mas so com a mensagem generica de RLS).
  const locks = editLocks(state);
  const valorAtual = Math.abs(fromDb(row.amount));
  if (locks.amount.length > 0 && valor !== valorAtual) {
    return { ok: false, error: motivoTravaCampo("o valor", locks.amount) };
  }
  if (locks.bookingDate.length > 0 && input.bookingDate !== row.booking_date) {
    return { ok: false, error: motivoTravaCampo("a data", locks.bookingDate) };
  }
  if (locks.bankAccountId.length > 0 && input.bankAccountId !== row.bank_account_id) {
    return { ok: false, error: motivoTravaCampo("a conta", locks.bankAccountId) };
  }
  const categoryIdNovo = input.categoryId || null;
  if (locks.categoryId.length > 0 && categoryIdNovo !== row.category_id) {
    return { ok: false, error: motivoTravaCampo("a categoria", locks.categoryId) };
  }

  // O sinal SEMPRE vem do que o lancamento ja tem, nunca do que a pessoa
  // digitou — trocar o sentido nao e uma edicao, e excluir e relancar.
  const valorComSinal = toDb(fromDb(row.amount) < 0 ? -valor : valor);

  const { data, error } = await supabase
    .from("transactions")
    .update({
      description: input.description.trim(),
      amount: valorComSinal,
      booking_date: input.bookingDate,
      competence_date: input.competenceDate || input.bookingDate,
      bank_account_id: input.bankAccountId,
      category_id: categoryIdNovo,
      counterparty_id: input.counterpartyId || null,
      cost_center_id: input.costCenterId || null,
      document_number: input.documentNumber?.trim() || null,
      payment_method: input.paymentMethod || null,
      notes: input.notes?.trim() || null,
    })
    .eq("id", input.transactionId)
    .eq("company_id", input.companyId)
    .select("id");

  if (error) return { ok: false, error: traduzErro(error) };
  if (!data || data.length === 0) {
    return {
      ok: false,
      error: "Nada foi alterado. Confira se o mes esta aberto e se seu perfil permite lancar.",
    };
  }

  revalidatePath(`/${input.companyId}/lancamentos`);
  revalidatePath(`/${input.companyId}/previstos`);
  revalidatePath(`/${input.companyId}/painel`);
  return OK;
}
