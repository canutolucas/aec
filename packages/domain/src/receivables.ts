/**
 * Casamento entre recebimentos (créditos do extrato) e notas fiscais em
 * aberto — irmão de matching.ts, não uma alteração dele. matchStatement()
 * continua servindo só à conciliação de extrato ↔ lançamento; isto aqui
 * resolve um problema diferente: uma nota que nasce sem conta bancária (o
 * cliente pode pagar em qualquer banco) e cujo recebimento pode não bater
 * o valor exato da nota (retenção de imposto), pode quitar várias notas de
 * uma vez (PIX agrupado), ou pode ser parcelado.
 *
 * Por isso o CNPJ/CPF do cliente — quando o extrato traz (o Cora sempre
 * traz, no histórico de toda transação) — é a chave PRIMÁRIA de casamento
 * aqui, não o valor: com retenção, o valor nunca bate exatamente.
 *
 * Duas confianças, o mesmo par binário que matching.ts já estabeleceu — não
 * há um terceiro nível novo, nem um "score" numérico:
 *  - "exact": CNPJ bate e o valor bate exatamente com o saldo em aberto de
 *    UMA nota. Auto-aplica.
 *  - "likely": qualquer outro caso coberto abaixo (retenção, agrupado, ou
 *    sem CNPJ no extrato). NUNCA automático — exige confirmação, a mesma
 *    decisão de projeto de matching.ts ("um algoritmo que casa tudo sozinho
 *    esconde erro").
 */

import { compareDates, daysBetween, type IsoDate } from "./dates";
import type { Cents } from "./money";

export interface OpenInvoice {
  readonly id: string;
  readonly number: string;
  readonly issuedOn: IsoDate;
  /** Valor da nota (bruto). */
  readonly amount: Cents;
  /** Ainda em aberto (nota - settlements já registrados). */
  readonly outstanding: Cents;
  readonly clientTaxId?: string;
  readonly clientName: string;
}

export interface CreditTransaction {
  readonly id: string;
  readonly bookingDate: IsoDate;
  /** Sempre positivo (é um credito/entrada). */
  readonly amount: Cents;
  /** CNPJ/CPF do pagador, quando o proprio extrato traz (o Cora traz sempre). */
  readonly counterpartyTaxId?: string;
}

export interface ReceivableMatch {
  readonly transactionId: string;
  /** Uma nota, normalmente; mais de uma no caso de PIX agrupado. */
  readonly invoiceIds: readonly string[];
  readonly confidence: "exact" | "likely";
  readonly reason: string;
}

export interface ReceivableMatchResult {
  readonly matched: readonly ReceivableMatch[];
  readonly suggested: readonly ReceivableMatch[];
  /** Creditos sem nenhuma nota candidata. */
  readonly unmatchedTransactions: readonly CreditTransaction[];
}

export interface ReceivableMatchOptions {
  /**
   * Piso de retenção plausível, como fração do valor da nota (default 0.80:
   * aceita ate ~20% de retenção). IR 1,5% + CSLL 1% + PIS 0,65% + COFINS 3%
   * + INSS 11% + ISS retido chegam perto disso no pior caso combinado. Um
   * credito abaixo deste piso não é sugerido — vira "sem nota candidata",
   * porque abaixo disso é mais provável ser um erro/outro cliente do que
   * retenção de verdade.
   */
  readonly retentionFloor?: number;
  /** Janela de dias, a partir da emissão, em que um credito sem CNPJ ainda é candidato. Default 90. */
  readonly noTaxIdWindowDays?: number;
}

const DEFAULTS = { retentionFloor: 0.8, noTaxIdWindowDays: 90 } as const;

/**
 * Encontra um CNPJ/CPF pontuado (XX.XXX.XXX/XXXX-XX ou XXX.XXX.XXX-XX) em
 * texto livre — o mesmo formato que o extrato do Cora traz no histórico de
 * toda transação (já documentado em packages/statements/src/node/cora.ts).
 * Usado para extrair o CNPJ/CPF do pagador a partir da description de um
 * lançamento já existente, quando ele não tem counterparty_id vinculado a
 * um cadastro com tax_id preenchido.
 */
export function extractTaxIdFromText(text: string): string | undefined {
  const found =
    /(?<![\d.])(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})(?![\d-])/.exec(text);
  return found ? found[1]!.replace(/\D/g, "") : undefined;
}

// Teto de seguranca para a busca por forca bruta abaixo: acima disto, 2^n
// deixa de ser inofensivo (e, a partir de 31, `1 << n` estoura o inteiro de
// 32 bits que o JS usa em operadores bit a bit). Um cliente com este volume
// de notas em aberto ao mesmo tempo cai no fallback (fica sem sugestao de
// agrupamento) em vez de travar a chamada.
const MAX_SUBSET_SEARCH_INVOICES = 24;

function subsetsSummingTo(
  invoices: readonly OpenInvoice[],
  target: Cents,
): readonly OpenInvoice[] | undefined {
  // Busca por forca bruta: o numero de notas em aberto de UM cliente ao
  // mesmo tempo e pequeno na pratica (poucas dezenas, no maximo), entao 2^n
  // e inofensivo aqui — não é uma busca sobre TODAS as notas da empresa.
  const n = invoices.length;
  if (n > MAX_SUBSET_SEARCH_INVOICES) return undefined;
  for (let mask = 1; mask < 1 << n; mask++) {
    let sum = 0;
    const subset: OpenInvoice[] = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        sum += invoices[i]!.outstanding;
        subset.push(invoices[i]!);
      }
    }
    if (sum === target) return subset;
  }
  return undefined;
}

/**
 * Casa creditos do extrato com notas em aberto.
 *
 * Processa os creditos NA ORDEM dada, indeferentemente diminuindo o saldo em
 * aberto das notas conforme cada credito anterior as consome — dentro de UMA
 * chamada, a mesma nota não é oferecida duas vezes para dois creditos
 * diferentes por engano.
 */
export function matchReceivables(
  credits: readonly CreditTransaction[],
  invoices: readonly OpenInvoice[],
  options: ReceivableMatchOptions = {},
): ReceivableMatchResult {
  const retentionFloor = options.retentionFloor ?? DEFAULTS.retentionFloor;
  const noTaxIdWindowDays = options.noTaxIdWindowDays ?? DEFAULTS.noTaxIdWindowDays;

  // Copia mutavel do saldo em aberto — vai diminuindo conforme os creditos,
  // na ordem dada, forem consumindo notas.
  const remaining = new Map<string, Cents>(invoices.map((inv) => [inv.id, inv.outstanding]));
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));

  function openInvoicesOf(taxId: string): OpenInvoice[] {
    return invoices
      .filter((inv) => inv.clientTaxId === taxId && (remaining.get(inv.id) ?? 0) > 0)
      .map((inv) => ({ ...inv, outstanding: remaining.get(inv.id)! }))
      .sort((a, b) => compareDates(a.issuedOn, b.issuedOn));
  }

  function consume(invoiceIds: readonly string[], amounts: readonly Cents[]) {
    invoiceIds.forEach((id, i) => {
      remaining.set(id, (remaining.get(id) ?? 0) - amounts[i]!);
    });
  }

  const matched: ReceivableMatch[] = [];
  const suggested: ReceivableMatch[] = [];
  const unmatchedTransactions: CreditTransaction[] = [];

  for (const credit of credits) {
    if (credit.counterpartyTaxId) {
      const open = openInvoicesOf(credit.counterpartyTaxId);

      // 1) exact: uma unica nota, valor bate em cheio.
      const exactOne = open.find((inv) => inv.outstanding === credit.amount);
      if (exactOne) {
        consume([exactOne.id], [credit.amount]);
        matched.push({
          transactionId: credit.id,
          invoiceIds: [exactOne.id],
          confidence: "exact",
          reason: `Mesmo CNPJ/CPF e valor exatamente igual ao saldo em aberto da nota ${exactOne.number}.`,
        });
        continue;
      }

      // 2) likely agrupado: soma de 2+ notas do mesmo cliente bate em cheio.
      // Verificado ANTES da retencao de nota unica: um valor que fecha
      // exatamente a soma de varias notas e um sinal mais forte do que "esta
      // um pouco abaixo do saldo de uma nota so".
      if (open.length >= 2) {
        const subset = subsetsSummingTo(open, credit.amount);
        if (subset && subset.length >= 2) {
          consume(
            subset.map((inv) => inv.id),
            subset.map((inv) => inv.outstanding),
          );
          suggested.push({
            transactionId: credit.id,
            invoiceIds: subset.map((inv) => inv.id),
            confidence: "likely",
            reason: `Mesmo CNPJ/CPF; o valor bate com a soma de ${subset.length} notas em aberto (${subset.map((i) => i.number).join(", ")}).`,
          });
          continue;
        }
      }

      // 3) likely com retencao: uma unica nota, valor abaixo do saldo mas
      // dentro do piso plausivel.
      const withRetention = open.find(
        (inv) =>
          credit.amount < inv.outstanding && credit.amount >= inv.outstanding * retentionFloor,
      );
      if (withRetention) {
        consume([withRetention.id], [credit.amount]);
        suggested.push({
          transactionId: credit.id,
          invoiceIds: [withRetention.id],
          confidence: "likely",
          reason: `Mesmo CNPJ/CPF; valor abaixo do saldo em aberto da nota ${withRetention.number} — provável retenção de imposto.`,
        });
        continue;
      }

      // CNPJ bateu mas nenhuma regra encontrou nota candidata — não cai para
      // o fallback de "sem CNPJ" abaixo (esse é so para quando o EXTRATO em
      // si não trouxe CNPJ nenhum, não para um CNPJ que não bateu com nada).
      unmatchedTransactions.push(credit);
      continue;
    }

    // 4) sem CNPJ no extrato: valor exato + janela de data, sempre likely.
    const candidates = invoices
      .filter((inv) => (remaining.get(inv.id) ?? 0) === credit.amount)
      .filter((inv) => {
        const days = daysBetween(inv.issuedOn, credit.bookingDate);
        return days >= 0 && days <= noTaxIdWindowDays;
      });

    if (candidates.length === 1) {
      const invoice = candidates[0]!;
      consume([invoice.id], [credit.amount]);
      suggested.push({
        transactionId: credit.id,
        invoiceIds: [invoice.id],
        confidence: "likely",
        reason: `O extrato não trouxe CNPJ/CPF do pagador; valor exato e dentro da janela de vencimento da nota ${invoice.number}.`,
      });
      continue;
    }

    unmatchedTransactions.push(credit);
  }

  return { matched, suggested, unmatchedTransactions };
}
