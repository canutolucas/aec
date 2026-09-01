/**
 * O ciclo mensal de um escritório de contabilidade: em que mês a pessoa
 * está trabalhando hoje, quando um mês pode ser fechado, e quais contas
 * ainda não têm o extrato daquele mês.
 *
 * Três funções puras — a mesma regra decidindo o que a esteira de /hoje
 * mostra e o que /fechamentos lista, em vez de cada tela reinventar o
 * corte de data.
 */

import { addMonths, compareDates, endOfMonth, type IsoDate, startOfMonth } from "./dates";

/**
 * Em 1º de setembro, a contadora está fechando agosto — não setembro. O mês
 * de trabalho é o anterior enquanto ele não estiver fechado; assim que
 * fechar, o trabalho passa para o mês corrente (mesmo ele ainda em curso).
 *
 * `earliestActivity` evita voltar antes do início real da operação — uma
 * empresa nova, sem nenhum mês anterior fechado, não deve "trabalhar" num
 * mês anterior à própria abertura.
 */
export function workingMonth(input: {
  readonly today: IsoDate;
  /** Períodos (qualquer dia dentro do mês) já fechados. */
  readonly closedPeriods: readonly IsoDate[];
  readonly earliestActivity?: IsoDate;
}): IsoDate {
  const current = startOfMonth(input.today);
  const previous = addMonths(current, -1);

  if (input.earliestActivity && compareDates(previous, startOfMonth(input.earliestActivity)) < 0) {
    return current;
  }

  const previousClosed = input.closedPeriods.some(
    (period) => compareDates(startOfMonth(period), previous) === 0,
  );
  return previousClosed ? current : previous;
}

/** Um mês que ainda não terminou não pode ser fechado. */
export function canCloseMonth(period: IsoDate, today: IsoDate): boolean {
  return compareDates(endOfMonth(startOfMonth(period)), today) < 0;
}

export interface CoverageAccount {
  readonly id: string;
  readonly openingBalanceDate: IsoDate;
}

export interface CoverageImport {
  readonly bankAccountId: string;
  /** Até onde o extrato importado alcança. Ausente quando o import não declarou período. */
  readonly periodEnd: IsoDate | null;
}

export interface StatementCoverage {
  readonly covered: readonly string[];
  readonly missing: readonly string[];
}

/**
 * Uma conta está coberta quando existe extrato importado alcançando o fim
 * do mês — não quando existe QUALQUER importação no mês (uma importação de
 * 1 a 10 de setembro não prova que 11-30 também foram cobertos).
 *
 * Conta aberta depois do fim do período não entra em `missing`: não dá pra
 * cobrar extrato de um mês anterior à própria abertura da conta.
 */
export function statementCoverage(input: {
  readonly period: IsoDate;
  readonly accounts: readonly CoverageAccount[];
  readonly imports: readonly CoverageImport[];
}): StatementCoverage {
  const periodEnd = endOfMonth(startOfMonth(input.period));

  const covered = new Set<string>();
  for (const statementImport of input.imports) {
    if (statementImport.periodEnd && compareDates(statementImport.periodEnd, periodEnd) >= 0) {
      covered.add(statementImport.bankAccountId);
    }
  }

  const eligible = input.accounts.filter(
    (account) => compareDates(account.openingBalanceDate, periodEnd) <= 0,
  );

  return {
    covered: eligible.filter((account) => covered.has(account.id)).map((account) => account.id),
    missing: eligible.filter((account) => !covered.has(account.id)).map((account) => account.id),
  };
}
