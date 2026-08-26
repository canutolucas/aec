"use server";

import { createHash } from "node:crypto";

import { hasRole, type StatementSource } from "@aec/db";
import { type Cents, type IsoDate, toDb } from "@aec/domain";
import { revalidatePath } from "next/cache";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
}

interface ImportedLine {
  readonly postedAt: IsoDate;
  readonly amount: Cents;
  readonly memo: string;
  readonly fitid?: string;
  readonly dedupKey: string;
}

interface ImportPayload {
  readonly source: Extract<StatementSource, "ofx" | "csv">;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  readonly ledgerBalance?: Cents;
  readonly ledgerBalanceDate?: IsoDate;
  readonly lines: readonly ImportedLine[];
}

function canImport(role: Parameters<typeof hasRole>[0]) {
  return hasRole(role, "assistente");
}

function parsePayload(value: string): ImportPayload | null {
  try {
    const payload = JSON.parse(value) as ImportPayload;
    if (
      (payload.source !== "ofx" && payload.source !== "csv") ||
      !Array.isArray(payload.lines) ||
      payload.lines.length === 0 ||
      payload.lines.length > 10_000
    ) {
      return null;
    }

    const valid = payload.lines.every(
      (line) =>
        typeof line.postedAt === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(line.postedAt) &&
        Number.isSafeInteger(line.amount) &&
        line.amount !== 0 &&
        typeof line.memo === "string" &&
        typeof line.dedupKey === "string" &&
        line.dedupKey.length > 0,
    );
    return valid ? payload : null;
  } catch {
    return null;
  }
}

export async function importStatement(input: {
  companyId: string;
  bankAccountId: string;
  fileName: string;
  payload: string;
}): Promise<ActionResult> {
  const session = await requireCompany(input.companyId);
  if (!canImport(session.role))
    return { ok: false, error: "Seu perfil nao pode importar extratos." };

  const payload = parsePayload(input.payload);
  if (!payload)
    return { ok: false, error: "O arquivo nao contem um extrato valido para importar." };

  const supabase = await createServerSupabase();
  const { data: account, error: accountError } = await supabase
    .from("bank_accounts")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("id", input.bankAccountId)
    .maybeSingle();
  if (accountError || !account) return { ok: false, error: "Conta bancaria nao encontrada." };

  const contentHash = createHash("sha256").update(input.payload).digest("hex");
  const { data: statementImport, error: importError } = await supabase
    .from("statement_imports")
    .insert({
      company_id: input.companyId,
      bank_account_id: input.bankAccountId,
      source: payload.source,
      file_name: input.fileName.trim() || null,
      file_hash: contentHash,
      period_start: payload.periodStart ?? null,
      period_end: payload.periodEnd ?? null,
      statement_balance: payload.ledgerBalance === undefined ? null : toDb(payload.ledgerBalance),
      statement_balance_date: payload.ledgerBalanceDate ?? null,
      line_count: payload.lines.length,
      imported_by: session.userId,
    })
    .select("id")
    .single();

  if (importError || !statementImport) {
    if (importError?.code === "23505") {
      return { ok: false, error: "Este extrato ja foi importado para esta conta." };
    }
    return { ok: false, error: importError?.message ?? "Nao foi possivel registrar a importacao." };
  }

  const { data: existing, error: existingError } = await supabase
    .from("statement_lines")
    .select("dedup_key")
    .eq("company_id", input.companyId)
    .eq("bank_account_id", input.bankAccountId)
    .in(
      "dedup_key",
      payload.lines.map((line) => line.dedupKey),
    );
  if (existingError) return { ok: false, error: existingError.message };

  const existingKeys = new Set((existing ?? []).map((line) => line.dedup_key as string));
  const lines = payload.lines.filter((line) => !existingKeys.has(line.dedupKey));
  if (lines.length > 0) {
    const { error: linesError } = await supabase.from("statement_lines").insert(
      lines.map((line) => ({
        company_id: input.companyId,
        import_id: statementImport.id,
        bank_account_id: input.bankAccountId,
        posted_at: line.postedAt,
        amount: toDb(line.amount),
        memo: line.memo.trim(),
        fitid: line.fitid ?? null,
        dedup_key: line.dedupKey,
      })),
    );
    if (linesError) return { ok: false, error: linesError.message };
  }

  revalidatePath(`/${input.companyId}/conciliacao`);
  return { ok: true };
}

export async function confirmMatch(input: {
  companyId: string;
  statementLineId: string;
  transactionId: string;
}): Promise<ActionResult> {
  const session = await requireCompany(input.companyId);
  if (!canImport(session.role))
    return { ok: false, error: "Seu perfil nao pode conciliar extratos." };

  const supabase = await createServerSupabase();
  const { data: line, error: lineError } = await supabase
    .from("statement_lines")
    .select("id, bank_account_id, status")
    .eq("id", input.statementLineId)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (lineError || !line || line.status !== "pendente") {
    return { ok: false, error: "Esta linha ja foi tratada ou nao pertence a empresa selecionada." };
  }

  const { data: transaction, error: transactionError } = await supabase
    .from("transactions")
    .select("id, bank_account_id, reconciliation")
    .eq("id", input.transactionId)
    .eq("company_id", input.companyId)
    .maybeSingle();
  if (transactionError || !transaction || transaction.bank_account_id !== line.bank_account_id) {
    return { ok: false, error: "O lancamento escolhido nao pertence a mesma conta." };
  }
  if (transaction.reconciliation === "conciliado") {
    return { ok: false, error: "Este lancamento ja esta conciliado." };
  }

  const { error: lineUpdateError } = await supabase
    .from("statement_lines")
    .update({
      status: "conciliada",
      matched_transaction_id: input.transactionId,
      matched_at: new Date().toISOString(),
      matched_by: session.userId,
    })
    .eq("id", input.statementLineId)
    .eq("status", "pendente");
  if (lineUpdateError) return { ok: false, error: lineUpdateError.message };

  const { error: transactionUpdateError } = await supabase
    .from("transactions")
    .update({ reconciliation: "conciliado" })
    .eq("id", input.transactionId)
    .eq("reconciliation", "nao_conciliado");
  if (transactionUpdateError) return { ok: false, error: transactionUpdateError.message };

  revalidatePath(`/${input.companyId}/conciliacao`);
  revalidatePath(`/${input.companyId}/lancamentos`);
  revalidatePath(`/${input.companyId}/painel`);
  return { ok: true };
}
