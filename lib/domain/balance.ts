/**
 * Saldo e extrato posicional.
 *
 * O saldo nunca e lido de um campo: e sempre reconstruido a partir do saldo
 * inicial da conta mais o movimento. Um campo de saldo atualizado a cada
 * lancamento e a origem numero um de divergencia em sistema financeiro — basta
 * um caminho de escrita esquecido para o numero passar a mentir, e sem nada que
 * acuse.
 *
 * Funcoes puras: recebem os lancamentos, devolvem os numeros. Sem I/O, sem
 * relogio, sem estado. E o que torna isto testavel e auditavel.
 */

import { type Cents, sum } from "./money";
import { compareDates, eachDay, type IsoDate } from "./dates";

export type TransactionStatus = "previsto" | "realizado";

/** O minimo que o calculo de saldo precisa saber sobre um lancamento. */
export interface BalanceEntry {
  readonly bookingDate: IsoDate;
  readonly amount: Cents;
  readonly status: TransactionStatus;
}

export interface AccountOpening {
  readonly openingBalance: Cents;
  readonly openingBalanceDate: IsoDate;
}

/** Qual movimento entra na conta: so o que aconteceu, ou tambem o previsto. */
export type BalanceScope = "realizado" | "total";

function inScope(entry: BalanceEntry, scope: BalanceScope): boolean {
  return scope === "total" || entry.status === "realizado";
}

/**
 * Saldo da conta em uma data, inclusive.
 *
 * Lancamentos anteriores ao saldo inicial sao ignorados: o saldo inicial ja os
 * contem, e soma-los de novo contaria o mesmo dinheiro duas vezes. O banco
 * recusa esses lancamentos na entrada; aqui a regra e repetida porque o calculo
 * tem de estar certo mesmo diante de dado historico importado.
 */
export function balanceOn(
  opening: AccountOpening,
  entries: readonly BalanceEntry[],
  date: IsoDate,
  scope: BalanceScope = "realizado",
): Cents {
  if (compareDates(date, opening.openingBalanceDate) < 0) {
    return 0;
  }

  const movement = entries.filter(
    (entry) =>
      inScope(entry, scope) &&
      compareDates(entry.bookingDate, opening.openingBalanceDate) >= 0 &&
      compareDates(entry.bookingDate, date) <= 0,
  );

  return opening.openingBalance + sum(movement.map((entry) => entry.amount));
}

/** Saldo considerando todo o movimento informado, sem recorte de data. */
export function currentBalance(
  opening: AccountOpening,
  entries: readonly BalanceEntry[],
  scope: BalanceScope = "realizado",
): Cents {
  const relevant = entries.filter(
    (entry) =>
      inScope(entry, scope) &&
      compareDates(entry.bookingDate, opening.openingBalanceDate) >= 0,
  );
  return opening.openingBalance + sum(relevant.map((entry) => entry.amount));
}

export interface DailyBalance {
  readonly date: IsoDate;
  readonly inflow: Cents;
  readonly outflow: Cents;
  readonly net: Cents;
  readonly balance: Cents;
  readonly entryCount: number;
}

/**
 * Extrato dia a dia com saldo acumulado.
 *
 * Devolve TODOS os dias do intervalo, inclusive os sem movimento. E o que
 * permite ao grafico de evolucao e a projecao enxergarem o saldo em qualquer
 * data, e nao so nos dias em que alguem lancou algo.
 */
export function dailyBalances(
  opening: AccountOpening,
  entries: readonly BalanceEntry[],
  from: IsoDate,
  to: IsoDate,
  scope: BalanceScope = "realizado",
): DailyBalance[] {
  const byDate = new Map<IsoDate, BalanceEntry[]>();
  for (const entry of entries) {
    if (!inScope(entry, scope)) continue;
    if (compareDates(entry.bookingDate, opening.openingBalanceDate) < 0) continue;
    const bucket = byDate.get(entry.bookingDate);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDate.set(entry.bookingDate, [entry]);
    }
  }

  // Saldo acumulado ate a vespera do intervalo, para que a primeira linha ja
  // comece do saldo certo em vez de comecar do zero.
  const start = compareDates(from, opening.openingBalanceDate) < 0
    ? opening.openingBalanceDate
    : from;

  let running = balanceOn(opening, entries, previousDay(start), scope);

  return eachDay(start, to).map((date) => {
    const dayEntries = byDate.get(date) ?? [];
    const inflow = sum(dayEntries.filter((e) => e.amount > 0).map((e) => e.amount));
    const outflow = sum(dayEntries.filter((e) => e.amount < 0).map((e) => e.amount));
    const net = inflow + outflow;
    running += net;
    return {
      date,
      inflow,
      outflow,
      net,
      balance: running,
      entryCount: dayEntries.length,
    };
  });
}

function previousDay(date: IsoDate): IsoDate {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export interface ConsolidatedBalance {
  readonly totalCurrent: Cents;
  readonly totalProjected: Cents;
  readonly perAccount: ReadonlyArray<{
    readonly bankAccountId: string;
    readonly current: Cents;
    readonly projected: Cents;
  }>;
}

export interface AccountWithEntries extends AccountOpening {
  readonly bankAccountId: string;
  readonly entries: readonly BalanceEntry[];
}

/** Saldo consolidado da empresa, somando as contas. */
export function consolidate(accounts: readonly AccountWithEntries[]): ConsolidatedBalance {
  const perAccount = accounts.map((account) => ({
    bankAccountId: account.bankAccountId,
    current: currentBalance(account, account.entries, "realizado"),
    projected: currentBalance(account, account.entries, "total"),
  }));

  return {
    totalCurrent: sum(perAccount.map((a) => a.current)),
    totalProjected: sum(perAccount.map((a) => a.projected)),
    perAccount,
  };
}
