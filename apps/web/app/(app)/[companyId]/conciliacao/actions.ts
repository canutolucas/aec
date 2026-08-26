"use server";

import { createHash } from "node:crypto";

import { hasRole, type TransactionDirection } from "@aec/db";
import { type Cents, fromDb, planAutoApply, toDb } from "@aec/domain";
import { type CanonicalStatement, ImportError } from "@aec/statements";
import { parseCoraPdf } from "@aec/statements/node";
import { revalidatePath } from "next/cache";

import { requireCompany } from "@/lib/db/session";
import { createServerSupabase } from "@/lib/db/supabase";

import { toCategorizationRule } from "./categorization";
import { parsePayload } from "./parse-payload";

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
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

  // Chunked: dedup_key is a PostgREST `.in()` filter, which travels in the
  // URL, not the request body. A single statement can legitimately carry a
  // few thousand lines (a full year, daily movement); an unchunked `.in()`
  // over all of them at once risks the URL outgrowing what a proxy in front
  // of Supabase allows, failing the whole import with a length-limit error
  // instead of an actionable one.
  const CHUNK_SIZE = 200;
  const existingKeys = new Set<string>();
  for (let i = 0; i < payload.lines.length; i += CHUNK_SIZE) {
    const dedupKeys = payload.lines.slice(i, i + CHUNK_SIZE).map((line) => line.dedupKey);
    const { data: existing, error: existingError } = await supabase
      .from("statement_lines")
      .select("dedup_key")
      .eq("company_id", input.companyId)
      .eq("bank_account_id", input.bankAccountId)
      .in("dedup_key", dedupKeys);
    if (existingError) return { ok: false, error: existingError.message };
    for (const row of existing ?? []) existingKeys.add(row.dedup_key);
  }

  // The insert itself is NOT chunked, on purpose: it travels as a POST
  // body (not a URL), where size limits are far more generous, and a
  // single INSERT is one atomic statement — splitting it into batches
  // would mean a failure partway through leaves some of the statement's
  // lines written and the rest missing, silently, which is worse than the
  // problem chunking the .in() lookup above solves.
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

export interface AutoApplyException {
  readonly lineId: string;
  readonly memo: string;
  readonly amount: Cents;
  readonly postedAt: string;
}

export interface AutoApplySuggestion extends AutoApplyException {
  readonly transactionId: string;
  readonly transactionDescription: string;
}

export interface AutoApplyFailure extends AutoApplyException {
  readonly error: string;
}

export interface AutoApplyResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly reconciled?: number;
  readonly created?: number;
  readonly exceptions?: {
    readonly suggested: readonly AutoApplySuggestion[];
    readonly uncategorized: readonly AutoApplyException[];
    /**
     * O dominio decidiu auto-aplicar (pareamento exato ou regra com
     * categoria), mas a RPC recusou na hora (ex.: mes ja fechado por outra
     * via, entre a hora que a pagina carregou os dados e a hora que este
     * lote rodou). A linha continua "pendente" no banco — nao se perde,
     * so nao vira nem sucesso nem uma das duas excecoes normais — e por
     * isso precisa aparecer em algum lugar, ou o total de linhas processadas
     * nao bateria com o total de linhas que existiam.
     */
    readonly failed: readonly AutoApplyFailure[];
  };
}

/**
 * O coracao do fluxo simples: depois de subir o extrato, resolve sozinho
 * tudo que da para resolver com confianca alta (pareamento exato, regra
 * aprendida com categoria) e devolve so o que sobrou como excecao.
 *
 * Um loop de chamadas independentes as MESMAS RPCs atomicas que a tela
 * avancada usa (reconcile_line, create_transaction_from_line) — de proposito
 * nao e uma unica transacao SQL envolvente: se fosse, uma linha problematica
 * no meio do lote desfaria tudo que ja tinha sido aplicado antes dela, o
 * oposto de "aplique tudo que der, mostre so a excecao real".
 *
 * Nao passa pelas Server Actions reconcileLine/createTransactionFromLine
 * (acima): elas repetem requireCompany + uma consulta de posse por linha a
 * cada chamada, redundante aqui porque esta funcao ja buscou as linhas
 * filtradas pela propria empresa e conta antes de decidir o que aplicar.
 */
export async function autoApplyReconciliation(input: {
  companyId: string;
  bankAccountId: string;
}): Promise<AutoApplyResult> {
  const session = await requireCompany(input.companyId);
  if (!canImport(session.role))
    return { ok: false, error: "Seu perfil nao pode conciliar extratos." };

  const supabase = await createServerSupabase();

  const { data: account, error: accountError } = await supabase
    .from("bank_accounts")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("id", input.bankAccountId)
    .maybeSingle();
  if (accountError) return { ok: false, error: accountError.message };
  if (!account) return { ok: false, error: "Conta bancaria nao encontrada." };

  const [linesResult, transactionsResult, rulesResult] = await Promise.all([
    supabase
      .from("statement_lines")
      .select("id, posted_at, amount, memo")
      .eq("company_id", input.companyId)
      .eq("bank_account_id", input.bankAccountId)
      .eq("status", "pendente"),
    supabase
      .from("transactions")
      .select("id, booking_date, amount, description, document_number")
      .eq("company_id", input.companyId)
      .eq("bank_account_id", input.bankAccountId)
      .eq("reconciliation", "nao_conciliado")
      .eq("status", "realizado"),
    supabase
      .from("matching_rules")
      .select("*")
      .eq("company_id", input.companyId)
      .eq("is_active", true)
      .order("priority"),
  ]);

  if (linesResult.error) return { ok: false, error: linesResult.error.message };
  if (transactionsResult.error) return { ok: false, error: transactionsResult.error.message };
  if (rulesResult.error) return { ok: false, error: rulesResult.error.message };

  const lines = linesResult.data ?? [];
  if (lines.length === 0) {
    return {
      ok: true,
      reconciled: 0,
      created: 0,
      exceptions: { suggested: [], uncategorized: [], failed: [] },
    };
  }

  const lineById = new Map(lines.map((line) => [line.id, line]));
  const transactionById = new Map((transactionsResult.data ?? []).map((t) => [t.id, t]));

  const plan = planAutoApply(
    lines.map((line) => ({
      id: line.id,
      postedAt: line.posted_at,
      amount: fromDb(line.amount),
      memo: line.memo,
    })),
    (transactionsResult.data ?? []).map((t) => ({
      id: t.id,
      bookingDate: t.booking_date,
      amount: fromDb(t.amount),
      description: t.description,
      documentNumber: t.document_number ?? undefined,
    })),
    (rulesResult.data ?? []).map(toCategorizationRule),
    input.bankAccountId,
  );

  const failed: AutoApplyFailure[] = [];

  let reconciled = 0;
  for (const item of plan.reconcile) {
    const { error } = await supabase.rpc("reconcile_line", {
      p_line_id: item.lineId,
      p_transaction_id: item.transactionId,
    });
    // Uma linha que falha (ex.: mes ja fechado por outra via) nao derruba o
    // lote inteiro — ela so deixa de contar como aplicada, e vai para
    // "failed" em vez de sumir (ver comentario em AutoApplyResult).
    if (error) {
      const line = lineById.get(item.lineId);
      if (line) {
        failed.push({
          lineId: line.id,
          memo: line.memo,
          amount: fromDb(line.amount),
          postedAt: line.posted_at,
          error: error.message,
        });
      }
      continue;
    }
    reconciled++;
  }

  let created = 0;
  for (const item of plan.create) {
    const { error } = await supabase.rpc("create_transaction_from_line", {
      p_line_id: item.lineId,
      p_category_id: item.categoryId,
      p_description: null,
      p_rule_id: item.ruleId,
    });
    if (error) {
      const line = lineById.get(item.lineId);
      if (line) {
        failed.push({
          lineId: line.id,
          memo: line.memo,
          amount: fromDb(line.amount),
          postedAt: line.posted_at,
          error: error.message,
        });
      }
      continue;
    }
    created++;
  }

  const suggested: AutoApplySuggestion[] = plan.exceptions.suggested.flatMap((match) => {
    const line = lineById.get(match.lineId);
    const transaction = transactionById.get(match.transactionId);
    if (!line || !transaction) return [];
    return [
      {
        lineId: line.id,
        memo: line.memo,
        amount: fromDb(line.amount),
        postedAt: line.posted_at,
        transactionId: transaction.id,
        transactionDescription: transaction.description,
      },
    ];
  });

  const uncategorized: AutoApplyException[] = plan.exceptions.uncategorized.map((line) => ({
    lineId: line.id,
    memo: line.memo,
    amount: line.amount,
    postedAt: line.postedAt,
  }));

  revalidateAfterReconciliation(input.companyId);
  return { ok: true, reconciled, created, exceptions: { suggested, uncategorized, failed } };
}
