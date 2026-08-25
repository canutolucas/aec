/**
 * Fluxo de caixa projetado.
 *
 * Responde a pergunta que a planilha nao responde: em que dia o caixa fura.
 *
 * Parte do saldo de hoje e aplica os previstos dia a dia. Previsto vencido e
 * anterior a hoje e que ainda nao foi baixado nao e ignorado — ele e trazido
 * para o primeiro dia da projecao, porque a conta continua para pagar. Somir com
 * ele produziria uma projecao otimista, que e o pior defeito possivel em uma
 * ferramenta feita justamente para antecipar aperto.
 */

import { type Cents, sum } from "./money";
import {
  addDays,
  BankingCalendar,
  compareDates,
  eachDay,
  type IsoDate,
} from "./dates";
import type { BalanceEntry } from "./balance";

export interface ProjectionEntry extends BalanceEntry {
  readonly id?: string;
  readonly description?: string;
}

export interface ProjectionInput {
  /** Saldo realizado de partida, ja consolidado. */
  readonly openingBalance: Cents;
  readonly from: IsoDate;
  readonly to: IsoDate;
  readonly entries: readonly ProjectionEntry[];
  readonly calendar?: BankingCalendar;
  /** Abaixo disto o dia entra como alerta. Ausente equivale a zero. */
  readonly minimumBalance?: Cents;
}

export interface ProjectedDay {
  readonly date: IsoDate;
  readonly isBusinessDay: boolean;
  readonly inflow: Cents;
  readonly outflow: Cents;
  readonly net: Cents;
  readonly balance: Cents;
  /** Previstos vencidos arrastados para este dia (so no primeiro dia). */
  readonly overdueBroughtForward: Cents;
  readonly belowMinimum: boolean;
  readonly negative: boolean;
}

export interface ProjectionResult {
  readonly days: readonly ProjectedDay[];
  readonly finalBalance: Cents;
  readonly lowestBalance: Cents;
  readonly lowestBalanceDate: IsoDate | null;
  /** Primeiro dia em que o saldo fica negativo. O alerta que importa. */
  readonly firstNegativeDate: IsoDate | null;
  /** Primeiro dia abaixo do saldo minimo configurado. */
  readonly firstBelowMinimumDate: IsoDate | null;
  readonly totalInflow: Cents;
  readonly totalOutflow: Cents;
  readonly overdueBroughtForward: Cents;
}

export function project(input: ProjectionInput): ProjectionResult {
  const calendar = input.calendar ?? new BankingCalendar();
  const minimum = input.minimumBalance ?? 0;

  // Previstos vencidos: venceram antes do inicio da projecao e continuam em
  // aberto. Entram no primeiro dia, nao somem.
  const overdue = input.entries.filter(
    (entry) =>
      entry.status === "previsto" && compareDates(entry.bookingDate, input.from) < 0,
  );
  const overdueTotal = sum(overdue.map((entry) => entry.amount));

  const byDate = new Map<IsoDate, ProjectionEntry[]>();
  for (const entry of input.entries) {
    if (compareDates(entry.bookingDate, input.from) < 0) continue;
    if (compareDates(entry.bookingDate, input.to) > 0) continue;
    const bucket = byDate.get(entry.bookingDate);
    if (bucket) {
      bucket.push(entry);
    } else {
      byDate.set(entry.bookingDate, [entry]);
    }
  }

  let running = input.openingBalance;
  let lowestBalance: Cents | null = null;
  let lowestBalanceDate: IsoDate | null = null;
  let firstNegativeDate: IsoDate | null = null;
  let firstBelowMinimumDate: IsoDate | null = null;
  let totalInflow = 0;
  let totalOutflow = 0;

  const days = eachDay(input.from, input.to).map((date, index): ProjectedDay => {
    // Os vencidos entram como se tivessem vencido no primeiro dia da janela.
    const dayEntries =
      index === 0
        ? [...overdue, ...(byDate.get(date) ?? [])]
        : (byDate.get(date) ?? []);
    const broughtForward = index === 0 ? overdueTotal : 0;

    const inflow = sum(dayEntries.filter((e) => e.amount > 0).map((e) => e.amount));
    const outflow = sum(dayEntries.filter((e) => e.amount < 0).map((e) => e.amount));
    const net = inflow + outflow;
    running += net;
    totalInflow += inflow;
    totalOutflow += outflow;

    if (lowestBalance === null || running < lowestBalance) {
      lowestBalance = running;
      lowestBalanceDate = date;
    }
    if (running < 0 && firstNegativeDate === null) {
      firstNegativeDate = date;
    }
    if (running < minimum && firstBelowMinimumDate === null) {
      firstBelowMinimumDate = date;
    }

    return {
      date,
      isBusinessDay: calendar.isBusinessDay(date),
      inflow,
      outflow,
      net,
      balance: running,
      overdueBroughtForward: broughtForward,
      belowMinimum: running < minimum,
      negative: running < 0,
    };
  });

  return {
    days,
    finalBalance: running,
    lowestBalance: lowestBalance ?? input.openingBalance,
    lowestBalanceDate,
    firstNegativeDate,
    firstBelowMinimumDate,
    totalInflow,
    totalOutflow,
    overdueBroughtForward: overdueTotal,
  };
}

/** Atalho para as janelas que a tela oferece: D+30, D+60, D+90. */
export function projectHorizon(
  input: Omit<ProjectionInput, "from" | "to">,
  from: IsoDate,
  days: number,
): ProjectionResult {
  return project({ ...input, from, to: addDays(from, days) });
}

export interface RecurrenceSpec {
  readonly startDate: IsoDate;
  readonly endDate?: IsoDate;
  readonly frequency: "mensal" | "semanal" | "quinzenal" | "anual";
  readonly dayOfMonth?: number;
  readonly amount: Cents;
  readonly description: string;
}

/**
 * Expande uma recorrencia em lancamentos previstos dentro da janela.
 *
 * Vencimento no dia 31 cai no ultimo dia dos meses que nao tem dia 31 — que e
 * como o boleto e emitido de verdade. O ajuste para dia util NAO e feito aqui de
 * proposito: a data de vencimento e um fato do contrato; se cai no domingo, quem
 * decide se paga sexta ou segunda e quem opera, e essa escolha vira lancamento.
 */
export function expandRecurrence(
  spec: RecurrenceSpec,
  from: IsoDate,
  to: IsoDate,
): ProjectionEntry[] {
  const entries: ProjectionEntry[] = [];
  const limit = spec.endDate && compareDates(spec.endDate, to) < 0 ? spec.endDate : to;

  const step = (date: IsoDate): IsoDate => {
    switch (spec.frequency) {
      case "semanal":
        return addDays(date, 7);
      case "quinzenal":
        return addDays(date, 14);
      case "mensal":
        return addMonthsKeepingDay(date, 1, spec.dayOfMonth);
      case "anual":
        return addMonthsKeepingDay(date, 12, spec.dayOfMonth);
    }
  };

  let current = spec.startDate;
  // O limite de iteracoes protege contra dado corrompido; a janela real e a data.
  for (let guard = 0; guard < 5000 && compareDates(current, limit) <= 0; guard++) {
    if (compareDates(current, from) >= 0) {
      entries.push({
        bookingDate: current,
        amount: spec.amount,
        status: "previsto",
        description: spec.description,
      });
    }
    current = step(current);
  }

  return entries;
}

function addMonthsKeepingDay(date: IsoDate, months: number, dayOfMonth?: number): IsoDate {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7)) - 1;
  const day = dayOfMonth ?? Number(date.slice(8, 10));

  const target = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));

  return target.toISOString().slice(0, 10);
}
