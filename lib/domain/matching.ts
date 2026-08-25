/**
 * Conciliacao bancaria: casar cada linha do extrato com o lancamento
 * correspondente no sistema.
 *
 * O algoritmo trabalha em tres niveis de confianca, e essa distincao e o ponto
 * central: casar sozinho o que e obvio, SUGERIR o que e provavel, e admitir o
 * que nao encontrou. Um algoritmo que casa tudo automaticamente esconde erro —
 * e o unico jeito de descobrir e no fechamento, quando o saldo nao bate e nao ha
 * mais como saber qual dos casamentos foi o errado.
 *
 * Valor sempre bate exatamente. Data e memo e que toleram diferenca: o banco
 * lanca no dia em que compensou, nao no dia em que o pagamento foi feito.
 */

import type { Cents } from "./money";
import { compareDates, daysBetween, type IsoDate } from "./dates";

export interface StatementLine {
  readonly id: string;
  readonly postedAt: IsoDate;
  readonly amount: Cents;
  readonly memo: string;
}

export interface MatchableTransaction {
  readonly id: string;
  readonly bookingDate: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly documentNumber?: string;
}

export type MatchConfidence = "exato" | "provavel" | "nenhum";

export interface Match {
  readonly lineId: string;
  readonly transactionId: string;
  readonly confidence: Exclude<MatchConfidence, "nenhum">;
  readonly dayGap: number;
  readonly score: number;
  readonly reason: string;
}

export interface MatchResult {
  /** Casamentos aceitos automaticamente. */
  readonly matched: readonly Match[];
  /** Candidatos que precisam de confirmacao humana, do melhor para o pior. */
  readonly suggested: readonly Match[];
  /** No extrato, sem lancamento correspondente: falta lancar. */
  readonly unmatchedLines: readonly StatementLine[];
  /** Lancado, sem linha no extrato: pode nao ter acontecido. */
  readonly unmatchedTransactions: readonly MatchableTransaction[];
}

export interface MatchOptions {
  /**
   * Tolerancia de data para casamento automatico. Tres dias cobrem o caso comum
   * do pagamento feito na sexta e compensado na segunda.
   */
  readonly exactDayTolerance?: number;
  /** Ate onde ainda vale sugerir, sem casar sozinho. */
  readonly suggestDayTolerance?: number;
}

const DEFAULTS = { exactDayTolerance: 3, suggestDayTolerance: 30 } as const;

/**
 * Normaliza texto para comparacao: sem acento, sem pontuacao, em minusculas.
 * "TED REC. JOAO SILVA" e "ted rec joao silva" passam a ser o mesmo texto.
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Semelhanca entre dois textos pela proporcao de palavras em comum (indice de
 * Jaccard). Vai de 0 a 1.
 *
 * Palavras de uma letra e digito solto sao descartados: casariam qualquer coisa
 * com qualquer coisa e so produziriam ruido.
 */
export function textSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeText(a).split(" ").filter((t) => t.length > 1));
  const tokensB = new Set(normalizeText(b).split(" ").filter((t) => t.length > 1));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Casa as linhas do extrato com os lancamentos.
 *
 * A estrategia e gulosa por ordem de qualidade: monta todos os pares de valor
 * identico, ordena do melhor para o pior e vai fixando, sem reutilizar linha nem
 * lancamento ja casado. Isso evita o erro classico de dois pagamentos iguais no
 * mesmo mes casarem trocados — o par de datas mais proximas leva.
 */
export function matchStatement(
  lines: readonly StatementLine[],
  transactions: readonly MatchableTransaction[],
  options: MatchOptions = {},
): MatchResult {
  const exactTolerance = options.exactDayTolerance ?? DEFAULTS.exactDayTolerance;
  const suggestTolerance = options.suggestDayTolerance ?? DEFAULTS.suggestDayTolerance;

  // Indexa por valor: valor diferente nunca e o mesmo movimento, entao nem entra
  // na comparacao. Tambem evita o custo quadratico em extratos longos.
  const byAmount = new Map<Cents, MatchableTransaction[]>();
  for (const transaction of transactions) {
    const bucket = byAmount.get(transaction.amount);
    if (bucket) {
      bucket.push(transaction);
    } else {
      byAmount.set(transaction.amount, [transaction]);
    }
  }

  const candidates: Match[] = [];
  for (const line of lines) {
    for (const transaction of byAmount.get(line.amount) ?? []) {
      const dayGap = Math.abs(daysBetween(line.postedAt, transaction.bookingDate));
      if (dayGap > suggestTolerance) continue;

      const similarity = textSimilarity(line.memo, transaction.description);
      const documentHit =
        transaction.documentNumber !== undefined &&
        transaction.documentNumber.length > 2 &&
        normalizeText(line.memo).includes(normalizeText(transaction.documentNumber));

      candidates.push({
        lineId: line.id,
        transactionId: transaction.id,
        confidence: dayGap <= exactTolerance ? "exato" : "provavel",
        dayGap,
        score: score(dayGap, similarity, documentHit),
        reason: describe(dayGap, similarity, documentHit, exactTolerance),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.dayGap - b.dayGap);

  const usedLines = new Set<string>();
  const usedTransactions = new Set<string>();
  const matched: Match[] = [];
  const suggested: Match[] = [];

  for (const candidate of candidates) {
    if (usedLines.has(candidate.lineId) || usedTransactions.has(candidate.transactionId)) {
      continue;
    }
    usedLines.add(candidate.lineId);
    usedTransactions.add(candidate.transactionId);
    (candidate.confidence === "exato" ? matched : suggested).push(candidate);
  }

  return {
    matched,
    suggested,
    unmatchedLines: lines.filter((line) => !usedLines.has(line.id)),
    unmatchedTransactions: transactions.filter((t) => !usedTransactions.has(t.id)),
  };
}

/**
 * Pontua um par candidato. Data proxima pesa mais que texto parecido: o valor ja
 * bate exatamente, e memo de banco costuma ter pouca relacao com a descricao que
 * a pessoa digitou.
 */
function score(dayGap: number, similarity: number, documentHit: boolean): number {
  const dateScore = Math.max(0, 100 - dayGap * 8);
  const textScore = similarity * 40;
  const documentScore = documentHit ? 50 : 0;
  return dateScore + textScore + documentScore;
}

function describe(
  dayGap: number,
  similarity: number,
  documentHit: boolean,
  exactTolerance: number,
): string {
  const parts: string[] = ["valor identico"];

  if (dayGap === 0) {
    parts.push("mesma data");
  } else {
    parts.push(`${dayGap} ${dayGap === 1 ? "dia" : "dias"} de diferenca`);
  }

  if (documentHit) parts.push("numero do documento no memo");
  if (similarity >= 0.5) parts.push("descricao semelhante");

  if (dayGap > exactTolerance) parts.push("confirme antes de aceitar");

  return parts.join(", ");
}

/**
 * Divergencias entre o extrato e o sistema, prontas para a tela.
 *
 * A soma das divergencias explica exatamente a diferenca entre o saldo do banco
 * e o do sistema. E o que transforma "nao bateu" em "nao bateu por causa destes
 * quatro lancamentos".
 */
export interface Divergence {
  readonly kind: "faltando_no_sistema" | "faltando_no_extrato";
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly sourceId: string;
}

export function divergences(result: MatchResult): Divergence[] {
  const fromLines = result.unmatchedLines.map((line): Divergence => ({
    kind: "faltando_no_sistema",
    date: line.postedAt,
    amount: line.amount,
    description: line.memo,
    sourceId: line.id,
  }));

  const fromTransactions = result.unmatchedTransactions.map((t): Divergence => ({
    kind: "faltando_no_extrato",
    date: t.bookingDate,
    amount: t.amount,
    description: t.description,
    sourceId: t.id,
  }));

  return [...fromLines, ...fromTransactions].sort(
    (a, b) => compareDates(a.date, b.date) || a.amount - b.amount,
  );
}
