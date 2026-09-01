/**
 * Server Actions de conta bancaria.
 */

"use server";

import type { BankAccountKind } from "@aec/db";
import type { Cents } from "@aec/domain";
import { compareDates, MoneyError, parseUserInput, toDb } from "@aec/domain";
import { revalidatePath } from "next/cache";

import { createServerSupabase } from "./supabase";
import type { ActionResult } from "./transactions";

const OK: ActionResult = { ok: true };

function traduzErro(error: { code?: string; message: string }): string {
  if (error.code === "23505") {
    return "Ja existe uma conta com esse nome nesta empresa.";
  }
  return error.message;
}

/** Le um campo de valor da tela. Vazio conta como zero. */
function parseAmountField(value: string | undefined): Cents {
  const raw = (value ?? "").trim();
  return raw === "" ? 0 : parseUserInput(raw);
}

/**
 * Le saldo inicial e saldo minimo juntos, com o mesmo tratamento de erro que
 * criarLancamento ja da a um valor digitado errado (transactions.ts):
 * parseUserInput lanca MoneyError pra qualquer coisa que nao seja numero,
 * e sem capturar isso aqui a excecao atravessava a Server Action inteira em
 * vez de virar o "Nao foi possivel salvar" que a tela espera.
 */
function parseContaAmounts(
  input: Pick<ContaInput, "openingBalance" | "minimumBalance">,
):
  { ok: true; openingBalance: Cents; minimumBalance: Cents | null } | { ok: false; error: string } {
  try {
    return {
      ok: true,
      openingBalance: parseAmountField(input.openingBalance),
      minimumBalance: input.minimumBalance?.trim() ? parseAmountField(input.minimumBalance) : null,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof MoneyError
          ? `Valor invalido: ${error.message}`
          : "Nao foi possivel entender o valor informado.",
    };
  }
}

export interface ContaInput {
  companyId: string;
  name: string;
  kind: BankAccountKind;
  bankName?: string;
  branch?: string;
  accountNumber?: string;
  openingBalance: string;
  openingBalanceDate: string;
  minimumBalance?: string;
}

export async function criarConta(input: ContaInput): Promise<ActionResult> {
  if (!input.name.trim()) {
    return { ok: false, error: "Informe o nome da conta." };
  }

  const valores = parseContaAmounts(input);
  if (!valores.ok) return valores;

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("bank_accounts").insert({
    company_id: input.companyId,
    name: input.name.trim(),
    kind: input.kind,
    bank_name: input.bankName?.trim() || null,
    branch: input.branch?.trim() || null,
    account_number: input.accountNumber?.trim() || null,
    // O valor digitado passa por parseUserInput e volta para numeric via toDb:
    // nunca ha um float no caminho entre a tela e o banco.
    opening_balance: toDb(valores.openingBalance),
    opening_balance_date: input.openingBalanceDate,
    minimum_balance: valores.minimumBalance !== null ? toDb(valores.minimumBalance) : null,
  });

  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${input.companyId}/contas`);
  return OK;
}

export interface EditarContaInput extends ContaInput {
  id: string;
}

/**
 * A unica tela de conta bancaria so tinha "cadastrar" — nunca "editar". Sem
 * isso, corrigir o saldo inicial (o caso mais comum: a conta foi criada com a
 * data errada, ou o saldo foi digitado errado) exigia UPDATE direto no banco.
 */
export async function editarConta(input: EditarContaInput): Promise<ActionResult> {
  if (!input.name.trim()) {
    return { ok: false, error: "Informe o nome da conta." };
  }

  const supabase = await createServerSupabase();

  // Mover a data do saldo inicial para DEPOIS de um lancamento que ja existe
  // faria esse lancamento sumir silenciosamente do calculo do saldo dali em
  // diante: balanceOn() ignora tudo que e anterior a data de abertura, sem
  // erro nenhum — so o saldo passaria a mentir. Mover para antes e sempre
  // seguro (so abre espaco para lancamentos mais antigos); a checagem so
  // precisa vigiar a direcao perigosa.
  const { data: maisAntigo, error: maisAntigoError } = await supabase
    .from("transactions")
    .select("booking_date")
    .eq("bank_account_id", input.id)
    .order("booking_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (maisAntigoError) return { ok: false, error: maisAntigoError.message };
  if (maisAntigo && compareDates(maisAntigo.booking_date, input.openingBalanceDate) < 0) {
    return {
      ok: false,
      error: `Ja existe lancamento em ${maisAntigo.booking_date}, antes dessa data — o saldo inicial nao pode vir depois de um lancamento que ja existe.`,
    };
  }

  const valores = parseContaAmounts(input);
  if (!valores.ok) return valores;

  const { data, error } = await supabase
    .from("bank_accounts")
    .update({
      name: input.name.trim(),
      kind: input.kind,
      bank_name: input.bankName?.trim() || null,
      branch: input.branch?.trim() || null,
      account_number: input.accountNumber?.trim() || null,
      opening_balance: toDb(valores.openingBalance),
      opening_balance_date: input.openingBalanceDate,
      minimum_balance: valores.minimumBalance !== null ? toDb(valores.minimumBalance) : null,
    })
    .eq("id", input.id)
    .eq("company_id", input.companyId)
    .select("id");

  if (error) return { ok: false, error: traduzErro(error) };

  // RLS nega UPDATE em silencio: zero linhas afetadas, sem erro nenhum — o
  // mesmo caso ja documentado em excluirLancamento (transactions.ts). Sem
  // esta checagem, a tela fecharia o formulario como se tivesse salvo mesmo
  // quando nada foi escrito.
  if (data.length === 0) {
    return { ok: false, error: "Nao foi possivel salvar: conta nao encontrada." };
  }

  revalidatePath(`/${input.companyId}/contas`);
  revalidatePath(`/${input.companyId}/painel`);
  revalidatePath(`/${input.companyId}/lancamentos`);
  return OK;
}

/**
 * Ativar/desativar e separada de editarConta de proposito: um toggle de linha
 * nao deve arrastar o resto do cadastro (saldo inicial, nome) junto — e o
 * mesmo raciocinio que ja levou definirCategoriaAtiva/definirContaparteAtiva
 * a ficarem separadas de editarCategoria/editarContraparte em cadastros.ts.
 *
 * Desativar so tira a conta do formulario de lancamento e da importacao de
 * extrato — o saldo dela continua entrando no consolidado (contas/painel
 * somam todas, ativas ou nao). A tela precisa deixar isso explicito no
 * confirm, nao so aqui no comentario.
 */
export async function definirContaAtiva(
  companyId: string,
  id: string,
  ativa: boolean,
): Promise<ActionResult> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("bank_accounts")
    .update({ is_active: ativa })
    .eq("id", id)
    .eq("company_id", companyId)
    .select("id");
  if (error) return { ok: false, error: traduzErro(error) };
  if (data.length === 0) {
    return {
      ok: false,
      error: `Nao foi possivel ${ativa ? "reativar" : "desativar"}: conta nao encontrada.`,
    };
  }

  revalidatePath(`/${companyId}/contas`);
  revalidatePath(`/${companyId}/painel`);
  revalidatePath(`/${companyId}/lancamentos`);
  return OK;
}
