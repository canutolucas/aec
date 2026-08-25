/**
 * Datas de caixa.
 *
 * Uma data de lancamento e um dia do calendario, nao um instante: "05/03/2025" e
 * o dia 5, seja quem for que abra o relatorio e de onde. Por isso o tipo aqui e
 * uma string `YYYY-MM-DD` e nao um `Date` — `Date` carrega hora e fuso, e e
 * dessa combinacao que nasce o classico lancamento do dia 1o aparecendo no dia 31
 * do mes anterior.
 *
 * Toda a aritmetica e feita em UTC internamente, o que a torna independente do
 * fuso da maquina que roda o codigo.
 */

/** Data de calendario no formato ISO `YYYY-MM-DD`. */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export class DateError extends Error {}

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;
  return toIsoDate(parseIsoDate(value)) === value;
}

export function parseIsoDate(value: IsoDate): Date {
  const match = ISO_DATE.exec(value);
  if (!match) {
    throw new DateError(`Data invalida: "${value}" (esperado YYYY-MM-DD)`);
  }
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

export function toIsoDate(date: Date): IsoDate {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const parsed = parseIsoDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return toIsoDate(parsed);
}

export function addMonths(date: IsoDate, months: number): IsoDate {
  const parsed = parseIsoDate(date);
  const targetDay = parsed.getUTCDate();
  parsed.setUTCDate(1);
  parsed.setUTCMonth(parsed.getUTCMonth() + months);
  // Vencimento dia 31 em fevereiro cai no ultimo dia do mes, que e como um
  // boleto e emitido de verdade.
  const lastDay = daysInMonth(parsed.getUTCFullYear(), parsed.getUTCMonth());
  parsed.setUTCDate(Math.min(targetDay, lastDay));
  return toIsoDate(parsed);
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const parsed = parseIsoDate(date);
  const last = daysInMonth(parsed.getUTCFullYear(), parsed.getUTCMonth());
  return `${date.slice(0, 7)}-${String(last).padStart(2, "0")}`;
}

/** Diferenca em dias inteiros. Positiva quando `b` e posterior a `a`. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const millis = parseIsoDate(b).getTime() - parseIsoDate(a).getTime();
  return Math.round(millis / 86_400_000);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Sequencia de datas de `from` ate `to`, inclusive nas duas pontas. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  if (compareDates(from, to) > 0) return [];
  const dates: IsoDate[] = [];
  for (let current = from; compareDates(current, to) <= 0; current = addDays(current, 1)) {
    dates.push(current);
  }
  return dates;
}

/** Hoje no fuso brasileiro — o mesmo dia que app.today() devolve no banco. */
export function todayInBrazil(now: Date = new Date()): IsoDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

export function isWeekend(date: IsoDate): boolean {
  const day = parseIsoDate(date).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Feriados nacionais com data fixa. Os moveis (Carnaval, Sexta-feira Santa,
 * Corpus Christi) sao calculados a partir da Pascoa.
 *
 * Feriado municipal e estadual varia por cidade e nao esta aqui: entra pela
 * lista extra que a projecao aceita, configurada por empresa.
 */
const FIXED_HOLIDAYS = [
  "01-01", // Confraternizacao Universal
  "04-21", // Tiradentes
  "05-01", // Dia do Trabalho
  "09-07", // Independencia
  "10-12", // Nossa Senhora Aparecida
  "11-02", // Finados
  "11-15", // Proclamacao da Republica
  "11-20", // Consciencia Negra
  "12-25", // Natal
] as const;

/** Domingo de Pascoa pelo algoritmo de Meeus/Jones/Butcher. */
export function easterSunday(year: number): IsoDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIsoDate(new Date(Date.UTC(year, month - 1, day)));
}

/** Feriados bancarios nacionais do ano, fixos e moveis. */
export function nationalHolidays(year: number): Set<IsoDate> {
  const easter = easterSunday(year);
  return new Set<IsoDate>([
    ...FIXED_HOLIDAYS.map((suffix) => `${year}-${suffix}`),
    addDays(easter, -48), // Carnaval (segunda)
    addDays(easter, -47), // Carnaval (terca)
    addDays(easter, -2), // Sexta-feira Santa
    addDays(easter, 60), // Corpus Christi
  ]);
}

/**
 * Calendario bancario: sabe dizer se o dinheiro anda em determinado dia.
 *
 * Aceita feriados extras para cobrir o municipal e o estadual, que variam por
 * cidade e por isso sao configurados por empresa.
 */
export class BankingCalendar {
  private readonly cache = new Map<number, Set<IsoDate>>();
  private readonly extra: Set<IsoDate>;

  constructor(extraHolidays: readonly IsoDate[] = []) {
    this.extra = new Set(extraHolidays);
  }

  isHoliday(date: IsoDate): boolean {
    if (this.extra.has(date)) return true;
    const year = Number(date.slice(0, 4));
    let holidays = this.cache.get(year);
    if (!holidays) {
      holidays = nationalHolidays(year);
      this.cache.set(year, holidays);
    }
    return holidays.has(date);
  }

  isBusinessDay(date: IsoDate): boolean {
    return !isWeekend(date) && !this.isHoliday(date);
  }

  /** O proprio dia se for util; senao, o proximo dia util. */
  nextBusinessDay(date: IsoDate): IsoDate {
    let current = date;
    // O limite existe so para nao girar para sempre diante de dado corrompido.
    for (let guard = 0; guard < 60; guard++) {
      if (this.isBusinessDay(current)) return current;
      current = addDays(current, 1);
    }
    throw new DateError(`Nenhum dia util encontrado a partir de ${date}`);
  }

  /** O proprio dia se for util; senao, o dia util anterior. */
  previousBusinessDay(date: IsoDate): IsoDate {
    let current = date;
    for (let guard = 0; guard < 60; guard++) {
      if (this.isBusinessDay(current)) return current;
      current = addDays(current, -1);
    }
    throw new DateError(`Nenhum dia util encontrado antes de ${date}`);
  }
}
