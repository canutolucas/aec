/**
 * Shared tolerant decimal-amount parsing.
 *
 * OFX's TRNAMT and NFS-e's ValorServicos/ValorLiquidoNfse/etc. both mandate a
 * dot as the decimal separator, but real exporters (Brazilian banks and
 * municipal systems alike) sometimes use a comma, and occasionally sign a
 * positive value with a leading "+". Both readers need the exact same
 * tolerance, so it lives here once instead of being copy-pasted per reader —
 * a previous copy (NFS-e's) drifted from the original (OFX's) by dropping
 * the "+" strip, which made `fromDb` reject an explicitly-signed positive
 * amount (its own decimal-string parser only accepts a leading "-", never a
 * "+") even though this function's own validity check allows one.
 */

import { type Cents, fromDb } from "@aec/domain";

import { ImportError } from "./types";

export function parseTolerantAmount(
  value: string,
  emptyMessage: string,
  invalidMessage: string,
): Cents {
  const raw = value.trim().replace(/\s|R\$/gi, "");
  if (raw === "") {
    throw new ImportError(emptyMessage);
  }

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = raw.replace(",", ".");
  } else {
    normalized = raw;
  }

  if (!/^[+-]?\d*\.?\d*$/.test(normalized) || /^[+-]?\.?$/.test(normalized)) {
    throw new ImportError(invalidMessage);
  }

  // fromDb's decimal parser only accepts a leading "-", never a "+" — strip
  // it here, after the tolerance check above (which allows it) has passed.
  return fromDb(normalized.replace(/^\+/, ""));
}
