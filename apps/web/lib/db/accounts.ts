/**
 * Server Actions de conta bancaria.
 */

"use server";

import type { BankAccountKind } from "@aec/db";
import type { Cents } from "@aec/domain";
import { parseUserInput, toDb } from "@aec/domain";
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
    opening_balance: toDb(parseAmountField(input.openingBalance)),
    opening_balance_date: input.openingBalanceDate,
    minimum_balance: input.minimumBalance?.trim()
      ? toDb(parseAmountField(input.minimumBalance))
      : null,
  });

  if (error) return { ok: false, error: traduzErro(error) };

  revalidatePath(`/${input.companyId}/contas`);
  return OK;
}
