/**
 * Formato canonico de extrato.
 *
 * OFX, CSV e, no futuro, Open Finance sao normalizados para esta forma antes de
 * qualquer outra coisa acontecer. O resto do sistema — conciliacao, deduplicacao,
 * gravacao — so conhece este formato. Uma origem nova vira um parser novo, e
 * nada mais no sistema muda.
 */

import type { IsoDate } from "@/lib/domain/dates";
import type { Cents } from "@/lib/domain/money";

export type StatementSource = "ofx" | "csv" | "open_finance";

export interface CanonicalLine {
  readonly postedAt: IsoDate;
  /** Com sinal: positivo entra, negativo sai. */
  readonly amount: Cents;
  readonly memo: string;
  /** Identificador da transacao no banco. Presente em OFX, ausente em CSV. */
  readonly fitid?: string;
  readonly checkNumber?: string;
  /**
   * Chave de deduplicacao dentro da conta. E o que garante que reimportar um
   * extrato — inteiro ou com periodo sobreposto — nunca duplique movimento.
   */
  readonly dedupKey: string;
}

export interface CanonicalStatement {
  readonly source: StatementSource;
  readonly bankId?: string;
  readonly accountId?: string;
  readonly periodStart?: IsoDate;
  readonly periodEnd?: IsoDate;
  /**
   * Saldo final informado pelo proprio banco no arquivo. E contra ele que o
   * sistema prova que o saldo bate — sem isso a conciliacao so compara linha a
   * linha e nunca afirma que o total esta certo.
   */
  readonly ledgerBalance?: Cents;
  readonly ledgerBalanceDate?: IsoDate;
  readonly lines: readonly CanonicalLine[];
  /** Problemas que nao impedem a importacao, mas quem opera precisa saber. */
  readonly warnings: readonly string[];
}

export class ImportError extends Error {}
