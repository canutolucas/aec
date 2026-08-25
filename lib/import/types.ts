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

export type StatementSource = "ofx" | "csv" | "pdf" | "open_finance";

export interface CanonicalLine {
  readonly postedAt: IsoDate;
  /** Com sinal: positivo entra, negativo sai. */
  readonly amount: Cents;
  readonly memo: string;
  /** Identificador da transacao no banco. Presente em OFX, ausente em CSV e PDF. */
  readonly fitid?: string;
  readonly checkNumber?: string;
  /** Nome da contraparte, quando o extrato traz em campo proprio. */
  readonly counterpartyName?: string;
  /**
   * CNPJ ou CPF da contraparte, so digitos.
   *
   * Vale mais que o nome para identificar quem e: extratos costumam TRUNCAR o
   * nome, e o documento vem inteiro. E a chave estavel para casar a contraparte.
   */
  readonly counterpartyDocument?: string;
  /** Verdadeiro quando o extrato cortou o nome da contraparte. */
  readonly nameTruncated?: boolean;
  /**
   * Chave de deduplicacao dentro da conta. E o que garante que reimportar um
   * extrato — inteiro ou com periodo sobreposto — nunca duplique movimento.
   */
  readonly dedupKey: string;
}

/**
 * Conferencia aritmetica do que foi lido contra o que o extrato declara.
 *
 * Extrato traz totais e, em alguns formatos, o saldo de cada dia. Refazer essas
 * contas e comparar e o que impede o pior modo de falha de um leitor de extrato:
 * ler ERRADO e nao avisar. Uma linha perdida ou um valor mal interpretado
 * produziria um saldo plausivel, e a divergencia so apareceria no fechamento.
 */
export interface DailyBalanceCheck {
  readonly date: IsoDate;
  readonly declared: Cents;
  readonly computed: Cents;
  readonly ok: boolean;
}

export interface StatementIntegrity {
  readonly declaredOpening?: Cents;
  readonly declaredClosing?: Cents;
  readonly declaredInflow?: Cents;
  readonly declaredOutflow?: Cents;
  readonly computedInflow: Cents;
  readonly computedOutflow: Cents;
  readonly computedClosing?: Cents;
  readonly dailyChecks: readonly DailyBalanceCheck[];
  /** Falso quando qualquer conferencia falhou. Importar assim e arriscado. */
  readonly ok: boolean;
  readonly problems: readonly string[];
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
  /** Saldo do dia anterior ao periodo, quando o extrato declara. */
  readonly openingBalance?: Cents;
  readonly lines: readonly CanonicalLine[];
  /** Conferencia contra os totais declarados, quando o formato os fornece. */
  readonly integrity?: StatementIntegrity;
  /** Problemas que nao impedem a importacao, mas quem opera precisa saber. */
  readonly warnings: readonly string[];
}

export class ImportError extends Error {}
