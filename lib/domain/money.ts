/**
 * Aritmetica monetaria.
 *
 * Dinheiro circula neste sistema como inteiro de centavos (`Cents`), nunca como
 * `number` decimal. O motivo e o de sempre: 0.1 + 0.2 === 0.30000000000000004 em
 * ponto flutuante, e um relatorio que fecha com um centavo de diferenca custa
 * mais tempo de conferencia do que o mes inteiro de lancamento.
 *
 * A fronteira com o banco e explicita: o Postgres guarda `numeric(14,2)` e o
 * driver entrega string (justamente para nao passar por float). `fromDb` e
 * `toDb` sao os unicos pontos de conversao.
 */

/** Valor monetario em centavos. Positivo entra, negativo sai. */
export type Cents = number;

const CENTS_PER_UNIT = 100;

export class MoneyError extends Error {}

/**
 * Converte o `numeric(14,2)` que veio do banco para centavos.
 *
 * Aceita string (o formato em que o driver entrega numeric) e number, para os
 * casos em que o valor foi montado na propria aplicacao.
 */
export function fromDb(value: string | number | null | undefined): Cents {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return fromDecimal(value);
  return parseDecimalString(value);
}

/** Converte centavos para a string que o Postgres aceita como numeric(14,2). */
export function toDb(cents: Cents): string {
  assertSafe(cents);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const units = Math.trunc(abs / CENTS_PER_UNIT);
  const remainder = abs % CENTS_PER_UNIT;
  return `${negative ? "-" : ""}${units}.${String(remainder).padStart(2, "0")}`;
}

/**
 * Converte um numero decimal em centavos, arredondando para o centavo mais
 * proximo. Usa `Math.round` sobre o valor ja multiplicado, com uma correcao de
 * epsilon: 1.005 * 100 da 100.49999999999999 em float, e arredondaria para baixo.
 */
export function fromDecimal(value: number): Cents {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Valor monetario invalido: ${value}`);
  }
  const scaled = value * CENTS_PER_UNIT;
  const rounded = Math.round(scaled + (scaled >= 0 ? Number.EPSILON : -Number.EPSILON) * Math.abs(scaled));
  assertSafe(rounded);
  return rounded;
}

/** Converte centavos de volta para decimal. Use apenas para exibir ou exportar. */
export function toDecimal(cents: Cents): number {
  assertSafe(cents);
  return cents / CENTS_PER_UNIT;
}

/**
 * Interpreta o que o usuario digitou.
 *
 * Aceita os formatos que aparecem de verdade quando alguem vem do Excel:
 * "1.234,56", "1234,56", "1234.56", "R$ 1.234,56", "-50", "(50)" para negativo.
 *
 * A regra do separador: quando ha virgula, ela e o decimal e o ponto e milhar —
 * a convencao brasileira. Sem virgula, um ponto so e decimal se separar no
 * maximo dois digitos ("12.50"); "1.234" e mil duzentos e trinta e quatro.
 */
export function parseUserInput(input: string): Cents {
  const raw = input.trim();
  if (raw === "") {
    throw new MoneyError("Valor vazio");
  }

  // Parenteses indicam negativo na notacao contabil: (1.234,56)
  const parenthesized = /^\((.*)\)$/.exec(raw);
  const body = parenthesized ? parenthesized[1]! : raw;

  let cleaned = body.replace(/R\$/gi, "").replace(/\s/g, "");
  let negative = parenthesized !== null;

  if (cleaned.startsWith("-")) {
    negative = !negative;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith("+")) {
    cleaned = cleaned.slice(1);
  }

  if (!/^[\d.,]+$/.test(cleaned)) {
    throw new MoneyError(`Valor monetario invalido: "${input}"`);
  }

  let normalized: string;
  if (cleaned.includes(",")) {
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = cleaned.split(".");
    const last = parts[parts.length - 1]!;
    // "12.50" -> decimal.  "1.234" ou "1.234.567" -> separador de milhar.
    normalized = parts.length > 1 && last.length <= 2 && parts.length === 2
      ? cleaned
      : parts.join("");
  }

  if (normalized === "" || normalized === ".") {
    throw new MoneyError(`Valor monetario invalido: "${input}"`);
  }

  const cents = parseDecimalString(normalized);
  return negative ? -cents : cents;
}

/**
 * Analisa uma string decimal sem passar por ponto flutuante: separa a parte
 * inteira da fracionaria e monta os centavos com aritmetica de inteiros.
 */
function parseDecimalString(value: string): Cents {
  const trimmed = value.trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (match[2] === "" && (match[3] ?? "") === "")) {
    throw new MoneyError(`Valor monetario invalido: "${value}"`);
  }

  const [, sign, integerPart, fractionPart = ""] = match;
  const units = integerPart === "" ? 0 : Number(integerPart);

  // Arredonda no terceiro decimal em diante, em vez de truncar.
  const twoDigits = fractionPart.slice(0, 2).padEnd(2, "0");
  const thirdDigit = fractionPart.charCodeAt(2) - 48;
  let cents = units * CENTS_PER_UNIT + Number(twoDigits);
  if (thirdDigit >= 5 && thirdDigit <= 9) {
    cents += 1;
  }

  assertSafe(cents);
  return sign === "-" ? -cents : cents;
}

/** Soma segura: acusa estouro em vez de devolver um numero silenciosamente errado. */
export function sum(values: readonly Cents[]): Cents {
  let total = 0;
  for (const value of values) {
    total += value;
  }
  assertSafe(total);
  return total;
}

/**
 * Reparte um valor em N partes iguais sem perder nem inventar centavo.
 *
 * Os centavos que sobram da divisao vao para as primeiras parcelas, que e como
 * um parcelamento e cobrado na pratica. A soma das partes e sempre igual ao
 * total — a propriedade que importa quando isto vira lancamento.
 */
export function allocate(total: Cents, parts: number): Cents[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`Numero de parcelas invalido: ${parts}`);
  }

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / parts);
  const remainder = abs - base * parts;

  return Array.from({ length: parts }, (_unused, index) =>
    sign * (base + (index < remainder ? 1 : 0)),
  );
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const decimalFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formata como moeda: R$ 1.234,56 */
export function formatBRL(cents: Cents): string {
  return currencyFormatter.format(toDecimal(cents));
}

/** Formata sem o simbolo, para grades densas: 1.234,56 */
export function formatAmount(cents: Cents): string {
  return decimalFormatter.format(toDecimal(cents));
}

export function isInflow(cents: Cents): boolean {
  return cents > 0;
}

export function isOutflow(cents: Cents): boolean {
  return cents < 0;
}

/**
 * O maior valor que cabe em numeric(14,2) e ainda e um inteiro exato em
 * JavaScript. Passar disso significa que algo somou o que nao devia.
 */
const MAX_CENTS = 999_999_999_999.99 * CENTS_PER_UNIT;

function assertSafe(cents: number): void {
  if (!Number.isFinite(cents) || !Number.isInteger(cents)) {
    throw new MoneyError(`Valor em centavos deve ser inteiro finito, recebeu ${cents}`);
  }
  if (Math.abs(cents) > MAX_CENTS) {
    throw new MoneyError(`Valor monetario fora da faixa suportada: ${cents}`);
  }
}
