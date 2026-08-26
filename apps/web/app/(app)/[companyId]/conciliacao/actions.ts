"use server";

import { createHash } from "node:crypto";

import { hasRole, type StatementSource, type TransactionDirection } from "@aec/db";
import { type Cents, type IsoDate, toDb } from "@aec/domain";
import { type CanonicalStatement, ImportError } from "@aec/statements";
import { parseCoraPdf } from "@aec/statements/node";
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
  readonly source: Extract<StatementSource, "ofx" | "csv" | "pdf">;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  readonly ledgerBalance?: Cents;
  readonly ledgerBalanceDate?: IsoDate;
  readonly lines: readonly ImportedLine[];
}

function canImport(role: Parameters<typeof hasRole>[0]) {
  return hasRole(role, "assistente");
}

function revalidateAfterReconciliation(companyId: string) {
  revalidatePath(`/${companyId}/conciliacao`);
  revalidatePath(`/${companyId}/lancamentos`);
  revalidatePath(`/${companyId}/painel`);
}

/**
 * Confirms a statement line belongs to the company the caller claims to be
 * acting on, before handing its id to an RPC that only takes the line id.
 *
 * RLS on `statement_lines` already stops a line from a company the caller
 * isn't a member of — so this can never be bypassed to reach another
 * tenant's data. What it protects against is different: an accountant who
 * is legitimately a member of several client companies could otherwise
 * pass a mismatched `companyId` (e.g. a stale tab, an old bookmark from a
 * different company's screen) and have the action silently succeed against
 * the wrong one, with `revalidatePath` refreshing a screen nobody is
 * looking at while the one they ARE looking at stays stale.
 */
async function requireLineInCompany(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  companyId: string,
  statementLineId: string,
): Promise<ActionResult> {
  const { data, error } = await supabase
    .from("statement_lines")
    .select("id")
    .eq("id", statementLineId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Esta linha nao pertence a empresa selecionada." };
  return { ok: true };
}

function parsePayload(value: string): ImportPayload | null {
  try {
    const payload = JSON.parse(value) as ImportPayload;
    if (
      (payload.source !== "ofx" && payload.source !== "csv" && payload.source !== "pdf") ||
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

/**
 * Parses a Cora PDF statement on the server.
 *
 * `unpdf` is Node-only, so the file has to come here instead of being parsed
 * in the browser like OFX and CSV already are. The client sends the raw
 * bytes as base64 and gets back the same `CanonicalStatement` shape it
 * already knows how to preview.
 */
export async function parsePdfStatement(
  companyId: string,
  base64: string,
): Promise<{ ok: true; statement: CanonicalStatement } | { ok: false; error: string }> {
  const session = await requireCompany(companyId);
  if (!canImport(session.role))
    return { ok: false, error: "Seu perfil nao pode importar extratos." };

  try {
    const bytes = Buffer.from(base64, "base64");
    const statement = await parseCoraPdf(new Uint8Array(bytes));
    return { ok: true, statement };
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, error: error.message };
    return { ok: false, error: "Nao foi possivel ler este PDF." };
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

/** Confirms a suggested pairing: statement line <-> existing transaction. */
export async function reconcileLine(input: {
  companyId: string;
  statementLineId: string;
  transactionId: string;
}): Promise<ActionResult> {
  const session = await requireCompany(input.companyId);
  if (!canImport(session.role))
    return { ok: false, error: "Seu perfil nao pode conciliar extratos." };

  const supabase = await createServerSupabase();
  const scoped = await requireLineInCompany(supabase, input.companyId, input.statementLineId);
  if (!scoped.ok) return scoped;

  const { error } = await supabase.rpc("reconcile_line", {
    p_line_id: input.statementLineId,
    p_transaction_id: input.transactionId,
  });
  if (error) return { ok: false, error: error.message };

  revalidateAfterReconciliation(input.companyId);
  return { ok: true };
}

/** Undoes a reconciliation: the line goes back to pending, the transaction to unreconciled. */
export async function unreconcileLine(input: {
  companyId: string;
  statementLineId: string;
}): Promise<ActionResult> {
  const session = await requireCompany(input.companyId);
  if (!canImport(session.role))
    return { ok: false, error: "Seu perfil nao pode desfazer conciliacoes." };

  const supabase = await createServerSupabase();
  const scoped = await requireLineInCompany(supabase, input.companyId, input.statementLineId);
  if (!scoped.ok) return scoped;

  const { error } = await supabase.rpc("unreconcile_line", {
    p_line_id: input.statementLineId,
  });
  if (error) return { ok: false, error: error.message };

  revalidateAfterReconciliation(input.companyId);
  return { ok: true };
}

/**
 * Creates a transaction from a statement line with no counterpart in the
 * system — the common case on a first import. The transaction is born
 * already reconciled: it exists because the statement line exists.
 */
export async function createTransactionFromLine(input: {
  companyId: string;
  statementLineId: string;
  categoryId?: string | null;
  description?: string | null;
  /** The rule that suggested categoryId, when it came from a learned rule rather than a manual pick. */
  ruleId?: string | null;
}): Promise<ActionResult> {
  const session = await requireCompany(input.companyId);
  if (!canImport(session.role))
    return { ok: false, error: "Seu perfil nao pode lancar a partir do extrato." };

  const supabase = await createServerSupabase();
  const scoped = await requireLineInCompany(supabase, input.companyId, input.statementLineId);
  if (!scoped.ok) return scoped;

  const { error } = await supabase.rpc("create_transaction_from_line", {
    p_line_id: input.statementLineId,
    p_category_id: input.categoryId ?? null,
    p_description: input.description ?? null,
    p_rule_id: input.ruleId ?? null,
  });
  if (error) return { ok: false, error: error.message };

  revalidateAfterReconciliation(input.companyId);
  return { ok: true };
}

/** Ignores a line on purpose (e.g. already booked in another account). */
export async function ignoreLine(input: {
  companyId: string;
  statementLineId: string;
  reason: string;
}): Promise<ActionResult> {
  const session = await requireCompany(input.companyId);
  if (!canImport(session.role))
    return { ok: false, error: "Seu perfil nao pode ignorar linhas do extrato." };

  const supabase = await createServerSupabase();
  const scoped = await requireLineInCompany(supabase, input.companyId, input.statementLineId);
  if (!scoped.ok) return scoped;

  const { error } = await supabase.rpc("ignore_line", {
    p_line_id: input.statementLineId,
    p_reason: input.reason,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${input.companyId}/conciliacao`);
  return { ok: true };
}

/**
 * Saves a learned categorization rule so the next import already arrives
 * categorized. Offered right after creating a transaction from a line —
 * the moment the category is freshest in whoever's mind.
 */
export async function createMatchingRule(input: {
  companyId: string;
  matchText: string;
  categoryId?: string | null;
  bankAccountId?: string | null;
  direction?: TransactionDirection | null;
}): Promise<ActionResult> {
  const session = await requireCompany(input.companyId);
  if (!canImport(session.role))
    return { ok: false, error: "Seu perfil nao pode criar regras de categorizacao." };

  const matchText = input.matchText.trim();
  if (!matchText) return { ok: false, error: "Informe o texto que a regra deve procurar." };
  if (!input.categoryId) return { ok: false, error: "Escolha uma categoria para a regra." };

  const supabase = await createServerSupabase();
  const { error } = await supabase.from("matching_rules").insert({
    company_id: input.companyId,
    match_text: matchText,
    bank_account_id: input.bankAccountId ?? null,
    direction: input.direction ?? null,
    category_id: input.categoryId,
    created_by: session.userId,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${input.companyId}/conciliacao`);
  return { ok: true };
}
