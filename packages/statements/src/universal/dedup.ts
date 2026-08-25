/**
 * Statement line deduplication key.
 */

import { type Cents, type IsoDate, normalizeText } from "@aec/domain";

/**
 * When the bank provides a FITID, it is the key: it's the identifier the
 * bank itself assigned to the transaction, stable across exports.
 */
export function fitidKey(fitid: string): string {
  return `fitid:${fitid.trim()}`;
}

/**
 * Without a FITID (the CSV case), the key is composed of date, amount, memo
 * and the OCCURRENCE ORDER of that combination within the file.
 *
 * The occurrence is the detail that matters: two identical payments on the
 * same day are legitimate and do happen — two installments from the same
 * supplier, two tolls. Without it, the second line would be dropped as a
 * duplicate and the statement would end up off by that amount — exactly the
 * problem the import exists to solve.
 *
 * Known limitation, inherent to CSV: if a later statement repeats the same
 * day with an EXTRA identical movement, it will be confused with the one
 * already imported. This doesn't happen with OFX, because it has a FITID.
 * That's why OFX is the preferred path and CSV warns when it finds identical
 * lines.
 */
export function compositeKey(
  postedAt: IsoDate,
  amount: Cents,
  memo: string,
  occurrence: number,
): string {
  const cleanMemo = normalizeText(memo).slice(0, 80);
  return `c:${postedAt}|${amount}|${cleanMemo}|${occurrence}`;
}

/**
 * Assigns the key to each line, counting repeated occurrences.
 */
export function assignDedupKeys<
  T extends { postedAt: IsoDate; amount: Cents; memo: string; fitid?: string },
>(lines: readonly T[]): Array<T & { dedupKey: string }> {
  const seen = new Map<string, number>();

  return lines.map((line) => {
    if (line.fitid !== undefined && line.fitid.trim() !== "") {
      return { ...line, dedupKey: fitidKey(line.fitid) };
    }

    const base = compositeKey(line.postedAt, line.amount, line.memo, 0);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);

    return {
      ...line,
      dedupKey: compositeKey(line.postedAt, line.amount, line.memo, occurrence),
    };
  });
}
