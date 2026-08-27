/**
 * Bank reconciliation: matching each statement line to the corresponding
 * transaction in the system.
 *
 * The algorithm works across three confidence levels, and that distinction
 * is the central point: match automatically what's obvious, SUGGEST what's
 * likely, and admit what wasn't found. An algorithm that matches everything
 * automatically hides errors — the only way to find out is at closing time,
 * when the balance doesn't add up and there's no longer any way to tell
 * which match was the wrong one.
 *
 * The amount always matches exactly. Date and memo are what tolerate a
 * difference: the bank posts on the day it cleared, not the day the payment
 * was made.
 */

import { compareDates, daysBetween, type IsoDate } from "./dates";
import type { Cents } from "./money";

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

export type MatchConfidence = "exact" | "likely" | "none";

export interface Match {
  readonly lineId: string;
  readonly transactionId: string;
  readonly confidence: Exclude<MatchConfidence, "none">;
  readonly dayGap: number;
  readonly score: number;
  readonly reason: string;
}

export interface MatchResult {
  /** Matches accepted automatically. */
  readonly matched: readonly Match[];
  /** Candidates that need human confirmation, best to worst. */
  readonly suggested: readonly Match[];
  /** On the statement, with no corresponding transaction: still needs booking. */
  readonly unmatchedLines: readonly StatementLine[];
  /** Booked, with no line on the statement: may not have happened. */
  readonly unmatchedTransactions: readonly MatchableTransaction[];
}

export interface MatchOptions {
  /**
   * Date tolerance for an automatic match. Three days covers the common case
   * of a payment made on Friday and cleared on Monday.
   */
  readonly exactDayTolerance?: number;
  /** How far out it's still worth suggesting, without matching automatically. */
  readonly suggestDayTolerance?: number;
}

const DEFAULTS = { exactDayTolerance: 3, suggestDayTolerance: 30 } as const;

/**
 * Normalizes text for comparison: no accents, no punctuation, lowercase.
 * "TED REC. JOAO SILVA" and "ted rec joao silva" become the same text.
 */
export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Similarity between two texts by the proportion of shared words (Jaccard
 * index). Ranges from 0 to 1.
 *
 * Single-letter words and bare digits are dropped: they'd match anything
 * with anything and would only produce noise.
 */
export function textSimilarity(a: string, b: string): number {
  const tokensA = new Set(
    normalizeText(a)
      .split(" ")
      .filter((t) => t.length > 1),
  );
  const tokensB = new Set(
    normalizeText(b)
      .split(" ")
      .filter((t) => t.length > 1),
  );

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) intersection++;
  }

  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Matches statement lines against transactions.
 *
 * The strategy is greedy by quality order: it builds every pair with an
 * identical amount, sorts best to worst, and locks them in without reusing a
 * line or a transaction that's already matched. This avoids the classic bug
 * of two equal payments in the same month getting matched swapped — the pair
 * with the closest dates wins.
 */
export function matchStatement(
  lines: readonly StatementLine[],
  transactions: readonly MatchableTransaction[],
  options: MatchOptions = {},
): MatchResult {
  const exactTolerance = options.exactDayTolerance ?? DEFAULTS.exactDayTolerance;
  const suggestTolerance = options.suggestDayTolerance ?? DEFAULTS.suggestDayTolerance;

  // Indexed by amount: a different amount is never the same movement, so it
  // doesn't even enter the comparison. Also avoids the quadratic cost on
  // long statements.
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
        confidence: dayGap <= exactTolerance ? "exact" : "likely",
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
    (candidate.confidence === "exact" ? matched : suggested).push(candidate);
  }

  return {
    matched,
    suggested,
    unmatchedLines: lines.filter((line) => !usedLines.has(line.id)),
    unmatchedTransactions: transactions.filter((t) => !usedTransactions.has(t.id)),
  };
}

/**
 * Scores a candidate pair. A close date weighs more than similar text: the
 * amount already matches exactly, and a bank memo usually has little
 * relation to the description the person typed.
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
  // Em portugues: e este texto, montado aqui, que a tela de conciliacao
  // mostra como motivo do pareamento — a justificativa que a pessoa usa
  // pra decidir se confirma. Ate esta leva saia em ingles cru ("same
  // amount, 3 days apart, confirm before accepting") dentro de uma frase
  // em portugues.
  const parts: string[] = ["mesmo valor"];

  if (dayGap === 0) {
    parts.push("mesma data");
  } else {
    parts.push(`${dayGap} dia${dayGap === 1 ? "" : "s"} de diferença`);
  }

  if (documentHit) parts.push("número do documento no histórico");
  if (similarity >= 0.5) parts.push("descrição parecida");

  if (dayGap > exactTolerance) parts.push("confirme antes de aceitar");

  return parts.join(", ");
}

/**
 * Divergences between the statement and the system, ready for the screen.
 *
 * The sum of the divergences explains exactly the difference between the
 * bank's balance and the system's. This is what turns "it doesn't match"
 * into "it doesn't match because of these four transactions".
 */
export interface Divergence {
  readonly kind: "missing_in_system" | "missing_in_statement";
  readonly date: IsoDate;
  readonly amount: Cents;
  readonly description: string;
  readonly sourceId: string;
}

export function divergences(result: MatchResult): Divergence[] {
  const fromLines = result.unmatchedLines.map((line): Divergence => ({
    kind: "missing_in_system",
    date: line.postedAt,
    amount: line.amount,
    description: line.memo,
    sourceId: line.id,
  }));

  const fromTransactions = result.unmatchedTransactions.map((t): Divergence => ({
    kind: "missing_in_statement",
    date: t.bookingDate,
    amount: t.amount,
    description: t.description,
    sourceId: t.id,
  }));

  return [...fromLines, ...fromTransactions].sort(
    (a, b) => compareDates(a.date, b.date) || a.amount - b.amount,
  );
}
