/**
 * Server Actions de faturamento: importar notas fiscais (XML) e dar baixa
 * nos recebimentos correspondentes.
 *
 * Segue o mesmo padrao de conciliacao/actions.ts (parse, dedup, resultado
 * tolerante a falha parcial) e de accounts.ts/transactions.ts (ActionResult,
 * checagem de linhas afetadas apos RLS negar em silencio).
 */

"use server";

import { hasRole } from "@aec/db";
import { type Cents, extractTaxIdFromText, fromDb, matchReceivables, toDb } from "@aec/domain";
import { ImportError, parseNfse } from "@aec/statements";
import { revalidatePath } from "next/cache";

import { requireCompany } from "./session";
import { createServerSupabase } from "./supabase";
import type { ActionResult } from "./transactions";

const OK: ActionResult = { ok: true };

function canManageFaturamento(role: Parameters<typeof hasRole>[0]) {
  return hasRole(role, "assistente");
}

export interface ImportarNotasResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly imported?: number;
  readonly duplicated?: number;
  readonly failed?: readonly { fileName: string; error: string }[];
}

/**
 * Importa um lote de XMLs de NFS-e. Cada arquivo e tratado de forma
 * independente — um XML ilegivel ou uma nota duplicada nao derruba o lote
 * inteiro, no mesmo espirito do loop de autoApplyReconciliation
 * (conciliacao/actions.ts).
 */
export async function importarNotas(input: {
  companyId: string;
  files: readonly { fileName: string; xml: string }[];
}): Promise<ImportarNotasResult> {
  const session = await requireCompany(input.companyId);
  if (!canManageFaturamento(session.role)) {
    return { ok: false, error: "Seu perfil nao pode importar notas fiscais." };
  }
  if (input.files.length === 0) {
    return { ok: false, error: "Nenhum arquivo para importar." };
  }

  const supabase = await createServerSupabase();
  let imported = 0;
  let duplicated = 0;
  const failed: { fileName: string; error: string }[] = [];

  for (const file of input.files) {
    // Um arquivo pode trazer uma nota so OU o lote inteiro de um periodo —
    // e o caso real de Salvador/BA, onde a prefeitura exporta a consulta
    // por periodo como um unico XML com dezenas de notas dentro. parseNfse
    // ja separa as duas coisas; um erro aqui e so XML ilegivel (sintaxe),
    // nao "essa nota especifica veio incompleta" (isso vira result.errors,
    // sem derrubar as outras do mesmo arquivo).
    let result;
    try {
      result = parseNfse(file.xml);
    } catch (error) {
      failed.push({
        fileName: file.fileName,
        error: error instanceof ImportError ? error.message : "Nao foi possivel ler este XML.",
      });
      continue;
    }
    for (const error of result.errors) {
      failed.push({ fileName: file.fileName, error });
    }

    for (const invoice of result.invoices) {
      // Varias notas do mesmo arquivo podem falhar por motivos diferentes
      // (uma duplicada, outra com CNPJ invalido) — identifica cada uma pelo
      // numero da nota quando o arquivo tem mais de uma, para nao confundir
      // qual delas deu erro.
      const label =
        result.invoices.length > 1 ? `${file.fileName} (nota ${invoice.number})` : file.fileName;

      // Acha a contraparte pelo CNPJ/CPF; cria automaticamente quando nao
      // existe — sem isso a pessoa teria que pre-cadastrar todo cliente
      // antes de importar, exatamente o trabalho manual que isto existe
      // pra evitar.
      let counterpartyId: string | null = null;
      if (invoice.clientTaxId) {
        const { data: existing } = await supabase
          .from("counterparties")
          .select("id")
          .eq("company_id", input.companyId)
          .eq("tax_id", invoice.clientTaxId)
          .maybeSingle();

        if (existing) {
          counterpartyId = existing.id;
        } else {
          const { data: created } = await supabase
            .from("counterparties")
            .insert({
              company_id: input.companyId,
              name: invoice.clientName,
              tax_id: invoice.clientTaxId,
            })
            .select("id")
            .maybeSingle();
          // Falha ao criar a contraparte (ex.: nome vazio, RLS) nao impede
          // a nota de ser importada — so fica sem counterparty_id, que e
          // opcional (o nome e o CNPJ do XML ja ficam gravados na propria
          // nota, client_name/client_tax_id).
          if (created) counterpartyId = created.id;
        }
      }

      const { error } = await supabase.from("invoices").insert({
        company_id: input.companyId,
        number: invoice.number,
        series: invoice.series ?? null,
        verification_code: invoice.verificationCode ?? null,
        issued_on: invoice.issuedOn,
        due_on: null,
        amount: toDb(invoice.amount),
        withheld_amount: toDb(invoice.withheldAmount),
        counterparty_id: counterpartyId,
        client_name: invoice.clientName,
        client_tax_id: invoice.clientTaxId ?? null,
        source_file_name: file.fileName,
        created_by: session.userId,
      });

      if (error) {
        if (error.code === "23505") {
          duplicated++;
        } else {
          failed.push({ fileName: label, error: error.message });
        }
        continue;
      }

      imported++;
    }
  }

  revalidatePath(`/${input.companyId}/faturamento`);
  revalidatePath(`/${input.companyId}/recebimentos`);
  return { ok: true, imported, duplicated, failed };
}

export async function settleInvoicesAction(input: {
  companyId: string;
  transactionId: string;
  allocations: readonly { invoiceId: string; amount: Cents }[];
}): Promise<ActionResult> {
  const session = await requireCompany(input.companyId);
  if (!canManageFaturamento(session.role)) {
    return { ok: false, error: "Seu perfil nao pode dar baixa em recebimentos." };
  }
  if (input.allocations.length === 0) {
    return { ok: false, error: "Escolha ao menos uma nota para dar baixa." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("settle_invoices", {
    p_transaction_id: input.transactionId,
    p_allocations: input.allocations.map((a) => ({
      invoice_id: a.invoiceId,
      amount: toDb(a.amount),
    })),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${input.companyId}/faturamento`);
  revalidatePath(`/${input.companyId}/recebimentos`);
  return OK;
}

export async function unsettleInvoiceAction(
  companyId: string,
  settlementId: string,
): Promise<ActionResult> {
  const session = await requireCompany(companyId);
  if (!canManageFaturamento(session.role)) {
    return { ok: false, error: "Seu perfil nao pode desfazer uma baixa." };
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("unsettle_invoice", { p_settlement_id: settlementId });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/${companyId}/faturamento`);
  revalidatePath(`/${companyId}/recebimentos`);
  return OK;
}

export interface ReceivableAllocation {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly amount: Cents;
}

export interface AutoApplyReceivablesSuggestion {
  readonly transactionId: string;
  readonly transactionDescription: string;
  readonly creditAmount: Cents;
  /**
   * Quanto vai para cada nota, ja calculado — o suficiente para chamar
   * settleInvoicesAction direto, sem a pessoa precisar montar a alocacao na
   * mao. Numa nota so (retencao ou o "exact" que ja foi aplicado sozinho),
   * o credito inteiro vai pra ela; em 2+ notas (PIX agrupado), cada uma
   * recebe o proprio saldo em aberto — e por isso a soma fecha com o
   * credito.
   */
  readonly allocations: readonly ReceivableAllocation[];
  readonly reason: string;
}

export interface AutoApplyReceivablesFailure {
  readonly transactionId: string;
  readonly transactionDescription: string;
  readonly creditAmount: Cents;
  readonly invoiceNumber: string;
  readonly error: string;
}

export interface AutoApplyReceivablesResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly settled?: number;
  readonly suggested?: readonly AutoApplyReceivablesSuggestion[];
  /**
   * Uma alocacao que a RPC recusa (ex.: mes fechado entre a hora que a
   * pagina carregou e a hora que este lote rodou) nao pode so desaparecer —
   * mesma convencao de AutoApplyFailure em conciliacao/actions.ts: "nada
   * some em silencio".
   */
  readonly failed?: readonly AutoApplyReceivablesFailure[];
}

/**
 * O coracao do fluxo simples para recebimentos: dado o extrato que acabou de
 * ser importado numa conta, tenta casar sozinho os creditos com notas em
 * aberto (usando matchReceivables) e ja da baixa nos casos "exact" — o
 * resto vira sugestao de um clique.
 *
 * Notas nao sao presas a conta bancaria (o cliente pode pagar em qualquer
 * banco), entao a busca de notas em aberto e da EMPRESA inteira; so os
 * creditos vem escopados a conta que acabou de receber o extrato.
 */
export async function autoApplyReceivables(input: {
  companyId: string;
  bankAccountId: string;
}): Promise<AutoApplyReceivablesResult> {
  const session = await requireCompany(input.companyId);
  if (!canManageFaturamento(session.role)) {
    return { ok: false, error: "Seu perfil nao pode conciliar recebimentos." };
  }

  const supabase = await createServerSupabase();

  const [invoicesResult, creditsResult] = await Promise.all([
    supabase
      .from("v_invoice_balances")
      .select("invoice_id, number, issued_on, amount, outstanding_amount, client_tax_id")
      .eq("company_id", input.companyId)
      .gt("outstanding_amount", 0),
    supabase
      .from("transactions")
      .select("id, booking_date, amount, description, counterparty_id")
      .eq("company_id", input.companyId)
      .eq("bank_account_id", input.bankAccountId)
      .eq("status", "realizado")
      .gt("amount", 0),
  ]);

  if (invoicesResult.error) return { ok: false, error: invoicesResult.error.message };
  if (creditsResult.error) return { ok: false, error: creditsResult.error.message };

  const openInvoices = invoicesResult.data ?? [];
  const credits = creditsResult.data ?? [];
  if (openInvoices.length === 0 || credits.length === 0) {
    return { ok: true, settled: 0, suggested: [], failed: [] };
  }

  // So os creditos que ainda nao tem NENHUMA alocacao — um credito ja usado
  // (total ou parcialmente) nao volta a ser oferecido.
  const creditIds = credits.map((c) => c.id);
  const { data: existingSettlements, error: settlementsError } = await supabase
    .from("invoice_settlements")
    .select("transaction_id")
    .in("transaction_id", creditIds);
  if (settlementsError) return { ok: false, error: settlementsError.message };

  const settledTransactionIds = new Set((existingSettlements ?? []).map((s) => s.transaction_id));
  const unsweptCredits = credits.filter((c) => !settledTransactionIds.has(c.id));
  if (unsweptCredits.length === 0) {
    return { ok: true, settled: 0, suggested: [], failed: [] };
  }

  // Contraparte ja vinculada por counterparty_id ganha do texto livre —
  // e uma informacao mais confiavel do que uma extracao por regex.
  const counterpartyIds = unsweptCredits.flatMap((c) =>
    c.counterparty_id ? [c.counterparty_id] : [],
  );
  const counterpartyTaxIdById = new Map<string, string>();
  if (counterpartyIds.length > 0) {
    const { data: counterparties } = await supabase
      .from("counterparties")
      .select("id, tax_id")
      .in("id", counterpartyIds);
    for (const row of counterparties ?? []) {
      if (row.tax_id) counterpartyTaxIdById.set(row.id, row.tax_id);
    }
  }

  const creditById = new Map(unsweptCredits.map((c) => [c.id, c]));
  const plan = matchReceivables(
    unsweptCredits.map((c) => ({
      id: c.id,
      bookingDate: c.booking_date,
      amount: fromDb(c.amount),
      counterpartyTaxId:
        (c.counterparty_id ? counterpartyTaxIdById.get(c.counterparty_id) : undefined) ??
        extractTaxIdFromText(c.description),
    })),
    openInvoices.flatMap((inv) =>
      inv.invoice_id && inv.number && inv.issued_on
        ? [
            {
              id: inv.invoice_id,
              number: inv.number,
              issuedOn: inv.issued_on,
              amount: fromDb(inv.amount),
              outstanding: fromDb(inv.outstanding_amount),
              clientTaxId: inv.client_tax_id ?? undefined,
              clientName: "",
            },
          ]
        : [],
    ),
  );

  let settled = 0;
  const failed: AutoApplyReceivablesFailure[] = [];
  for (const match of plan.matched) {
    const invoiceId = match.invoiceIds[0];
    if (!invoiceId) continue;
    const invoice = openInvoices.find((inv) => inv.invoice_id === invoiceId);
    if (!invoice) continue;

    const { error } = await supabase.rpc("settle_invoices", {
      p_transaction_id: match.transactionId,
      p_allocations: [{ invoice_id: invoiceId, amount: invoice.outstanding_amount }],
    });
    // Uma alocacao que a RPC recusa (ex.: mes fechado) nao derruba o lote —
    // so fica sem aplicar, e vai para "failed" em vez de sumir (mesmo
    // raciocinio de AutoApplyFailure em conciliacao/actions.ts); a proxima
    // chamada de autoApplyReceivables tenta de novo.
    if (error) {
      const credit = creditById.get(match.transactionId);
      if (credit) {
        failed.push({
          transactionId: credit.id,
          transactionDescription: credit.description,
          creditAmount: fromDb(credit.amount),
          invoiceNumber: invoice.number ?? "",
          error: error.message,
        });
      }
      continue;
    }
    settled++;
  }

  const suggested: AutoApplyReceivablesSuggestion[] = plan.suggested.flatMap((match) => {
    const credit = creditById.get(match.transactionId);
    if (!credit) return [];

    const matchedInvoices = match.invoiceIds.flatMap((id) => {
      const inv = openInvoices.find((candidate) => candidate.invoice_id === id);
      return inv ? [inv] : [];
    });
    if (matchedInvoices.length !== match.invoiceIds.length) return [];

    // Uma nota so: o credito inteiro vai pra ela (mesmo quando e menor que
    // o saldo em aberto — e exatamente o caso de retencao). Duas ou mais
    // (agrupado): cada uma recebe o proprio saldo em aberto, porque foi
    // assim que matchReceivables achou a combinacao (a soma dos saldos
    // bate exatamente com o credito).
    const allocations: ReceivableAllocation[] =
      matchedInvoices.length === 1
        ? [
            {
              invoiceId: matchedInvoices[0]!.invoice_id!,
              invoiceNumber: matchedInvoices[0]!.number!,
              amount: fromDb(credit.amount),
            },
          ]
        : matchedInvoices.map((inv) => ({
            invoiceId: inv.invoice_id!,
            invoiceNumber: inv.number!,
            amount: fromDb(inv.outstanding_amount),
          }));

    return [
      {
        transactionId: credit.id,
        transactionDescription: credit.description,
        creditAmount: fromDb(credit.amount),
        allocations,
        reason: match.reason,
      },
    ];
  });

  revalidatePath(`/${input.companyId}/faturamento`);
  revalidatePath(`/${input.companyId}/recebimentos`);
  revalidatePath(`/${input.companyId}/painel`);
  return { ok: true, settled, suggested, failed };
}
