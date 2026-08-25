/**
 * Reader for Cora's PDF statement.
 *
 * PDF is the worst possible source for reconciliation, and it's worth being
 * explicit about why — whoever maintains this needs to know what they're
 * accepting:
 *
 *   1. There's no transaction identifier (OFX's FITID). Deduplication falls
 *      back to date + amount + memo.
 *   2. The statement TRUNCATES the counterparty's name ("Le Va Tout Do
 *      Brasil L…"). A name-based categorization rule only gets you halfway.
 *   3. The layout is a design choice, not a contract. When the bank changes
 *      the page design, this reader stops working.
 *
 * Two things make up for it:
 *
 *   The counterparty's CNPJ/CPF comes in FULL, even when the name is cut
 *   off. It's a better key than the name would ever be — it doesn't change,
 *   doesn't abbreviate and doesn't depend on how the bank wrote it.
 *   Categorization rules should lean on it.
 *
 *   The statement declares the totals and the balance for EVERY DAY. Redoing
 *   that math and comparing catches the worst failure mode of a PDF reader:
 *   reading it wrong and not warning about it. A dropped line would produce
 *   a plausible balance, and the difference would only show up at closing
 *   time, when nobody connects it back to the cause anymore. Here, it shows
 *   up at import time.
 *
 * Cora also exports OFX. When OFX is available, use OFX.
 */

import { type Cents, type IsoDate, parseUserInput, sum } from "@aec/domain";

import { assignDedupKeys } from "../universal/dedup";
import {
  type CanonicalLine,
  type CanonicalStatement,
  type DailyBalanceCheck,
  ImportError,
  type StatementIntegrity,
} from "../universal/types";
import { extractLines, type PdfLine } from "./pdf";

/**
 * Maximum indent, in points, for a line to count as a heading.
 *
 * In Cora's layout, the header and the day's date start at the margin
 * (x ~ 30) and transactions come indented (x ~ 54). It's the only signal
 * that separates "25/08/2026 Saldo do dia" from a transaction — both have a
 * date and an amount.
 */
const HEADING_INDENT = 45;

const DATE = /(\d{2})\/(\d{2})\/(\d{4})/;
const DOCUMENT = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/;
const SIGNED_AMOUNT = /([+-])\s*R\$\s*([\d.]+,\d{2})/;
const AMOUNT = /R\$\s*(-?[\d.]+,\d{2})/;

export async function parseCoraPdf(bytes: Uint8Array): Promise<CanonicalStatement> {
  return parseCoraLines(await extractLines(bytes));
}

/**
 * Interprets the lines already extracted.
 *
 * Deliberately a pure function: the whole layout can be tested without any
 * binary PDF, which matters because a real statement carries real financial
 * data and can't become a repository fixture.
 */
export function parseCoraLines(lines: readonly PdfLine[]): CanonicalStatement {
  const warnings: string[] = [];
  const everything = lines.map((line) => line.text).join("\n");

  if (!/Cora SCFI/i.test(everything)) {
    throw new ImportError(
      "Este PDF não parece ser um extrato do Cora. Se for de outro banco, exporte em OFX — " +
        "o leitor de OFX funciona para qualquer banco.",
    );
  }

  // Looks for the range by its own pattern, not by proximity to the label:
  // in the PDF, "Extrato do período" and the dates sit 1.5 points apart
  // vertically and land on different lines. "date to date" only shows up here.
  const period = /(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/.exec(everything);
  const generatedOn = /Extrato gerado no dia\s*(\d{2}\/\d{2}\/\d{4})/.exec(everything);
  const declaredOpening = readLabeledAmount(
    everything,
    /Saldo inicial disponível\s*R\$\s*([\d.]+,\d{2})/,
  );
  const declaredClosing = readLabeledAmount(
    everything,
    /Saldo final disponível\s*R\$\s*([\d.]+,\d{2})/,
  );
  const declaredInflow = readLabeledAmount(
    everything,
    /Total de entradas\s*\+\s*R\$\s*([\d.]+,\d{2})/,
  );
  const declaredOutflow = readLabeledAmount(
    everything,
    /Total de saídas\s*-\s*R\$\s*([\d.]+,\d{2})/,
  );

  const rawLines: Array<{
    postedAt: IsoDate;
    amount: Cents;
    memo: string;
    counterpartyName?: string;
    counterpartyDocument?: string;
    nameTruncated?: boolean;
  }> = [];

  const declaredBalances = new Map<IsoDate, Cents>();
  let currentDay: IsoDate | null = null;

  for (const line of lines) {
    if (isPageNoise(line.text)) continue;

    // Day heading: at the margin, with a date and "Saldo do dia".
    if (line.indent < HEADING_INDENT && /Saldo do dia/i.test(line.text)) {
      const date = DATE.exec(line.text);
      const balance = AMOUNT.exec(line.text.replace(DATE, ""));
      if (date && balance) {
        currentDay = toIso(date);
        declaredBalances.set(currentDay, parseUserInput(balance[1]!));
      }
      continue;
    }

    // Transaction: indented, with a signed amount.
    if (line.indent < HEADING_INDENT) continue;

    const amount = SIGNED_AMOUNT.exec(line.text);
    if (!amount) continue;

    if (currentDay === null) {
      warnings.push(`Transação ignorada por vir antes de qualquer data: "${line.text}"`);
      continue;
    }

    const value = parseUserInput(amount[2]!);
    const document = DOCUMENT.exec(line.text)?.[1];

    // What's left after stripping the amount and the document is the type
    // plus the name. The cells already separate the two columns; the
    // flattened text wouldn't.
    const columns = line.cells.map((cell) => cell.text.trim());
    const type = columns[0] ?? "";
    const rawName = columns
      .slice(1)
      .find((column) => !DOCUMENT.test(column) && !AMOUNT.test(column));

    const truncated = rawName !== undefined && /[…]|\.\.\.$/.test(rawName);
    const name = rawName?.replace(/\s*(…|\.\.\.)\s*$/, "").trim();

    rawLines.push({
      postedAt: currentDay,
      amount: amount[1] === "-" ? -value : value,
      // The memo carries everything the statement gave, including the
      // document: it's the text the categorization rules will scan.
      memo: [type, name, document].filter(Boolean).join(" - "),
      counterpartyName: name || undefined,
      counterpartyDocument: document?.replace(/\D/g, ""),
      nameTruncated: truncated || undefined,
    });
  }

  if (rawLines.length === 0) {
    throw new ImportError(
      "Nenhuma transação encontrada no PDF. O layout do extrato pode ter mudado.",
    );
  }

  // The statement comes newest to oldest; the rest of the system expects
  // chronological order.
  rawLines.sort((a, b) => (a.postedAt < b.postedAt ? -1 : a.postedAt > b.postedAt ? 1 : 0));

  const canonicalLines: CanonicalLine[] = assignDedupKeys(rawLines);

  const integrity = check({
    lines: canonicalLines,
    declaredBalances,
    declaredOpening,
    declaredClosing,
    declaredInflow,
    declaredOutflow,
  });

  if (!integrity.ok) warnings.push(...integrity.problems);

  const truncatedCount = canonicalLines.filter((line) => line.nameTruncated).length;
  if (truncatedCount > 0) {
    warnings.push(
      `${truncatedCount} de ${canonicalLines.length} contrapartes vieram com o nome cortado pelo extrato. ` +
        "O CNPJ/CPF veio inteiro e é uma chave melhor: prefira criar as regras de categorização " +
        "por documento. Se o Cora oferecer OFX para este período, o OFX traz o nome completo.",
    );
  }

  // The period the statement ATTESTS TO is not the one it declares.
  //
  // This statement says it covers 08/01 to 08/31, but was generated on the
  // 25th and only has movement up to there. Recording 08/31 as the end of
  // the period would make the system treat August as already covered, and
  // "reconciled through" would start lying — days 26 through 31 would never
  // get charged to anyone. The real end is the last day the statement
  // printed a balance for.
  const declaredStart = period ? toIso(DATE.exec(period[1]!)!) : undefined;
  const declaredEnd = period ? toIso(DATE.exec(period[2]!)!) : undefined;
  const lastAttestedDay = [...declaredBalances.keys()].sort().pop();

  const periodStart = declaredStart ?? canonicalLines[0]!.postedAt;
  const periodEnd = lastAttestedDay ?? canonicalLines[canonicalLines.length - 1]!.postedAt;

  if (declaredEnd !== undefined && declaredEnd > periodEnd) {
    warnings.push(
      `O extrato diz cobrir até ${formatDate(declaredEnd)}, mas foi gerado em ` +
        `${generatedOn ? generatedOn[1] : formatDate(periodEnd)} e só tem movimento até ` +
        `${formatDate(periodEnd)}. O período importado vai até aí; peça o extrato do restante ` +
        "do mês antes de fechar.",
    );
  }

  return {
    source: "pdf",
    // Cora's COMPE code. The PDF carries CNPJ 37.880.206/0001-63, the same
    // institution under the two names it has used (SCD and SCFI).
    bankId: "403",
    periodStart,
    periodEnd,
    openingBalance: declaredOpening,
    ledgerBalance: declaredClosing,
    ledgerBalanceDate: periodEnd,
    lines: canonicalLines,
    integrity,
    warnings,
  };
}

function check(input: {
  lines: readonly CanonicalLine[];
  declaredBalances: ReadonlyMap<IsoDate, Cents>;
  declaredOpening?: Cents;
  declaredClosing?: Cents;
  declaredInflow?: Cents;
  declaredOutflow?: Cents;
}): StatementIntegrity {
  const { lines, declaredBalances, declaredOpening, declaredClosing } = input;
  const problems: string[] = [];

  const computedInflow = sum(lines.filter((l) => l.amount > 0).map((l) => l.amount));
  // Summed as positive, to compare with the statement's "Total de saidas",
  // which also comes with no sign.
  const computedOutflow = -sum(lines.filter((l) => l.amount < 0).map((l) => l.amount));

  if (input.declaredInflow !== undefined && input.declaredInflow !== computedInflow) {
    problems.push(
      `Total de entradas não confere: o extrato declara ${reais(input.declaredInflow)} e as ` +
        `linhas lidas somam ${reais(computedInflow)}.`,
    );
  }

  if (input.declaredOutflow !== undefined && input.declaredOutflow !== computedOutflow) {
    problems.push(
      `Total de saídas não confere: o extrato declara ${reais(input.declaredOutflow)} e as ` +
        `linhas lidas somam ${reais(computedOutflow)}.`,
    );
  }

  // Day-by-day running balance against the "Saldo do dia" the statement
  // prints. This is the strongest check: it locates ON WHICH DAY the
  // reading diverged, instead of just saying the total came out wrong.
  const dailyChecks: DailyBalanceCheck[] = [];
  let running = declaredOpening ?? 0;

  if (declaredOpening !== undefined) {
    const byDay = new Map<IsoDate, Cents>();
    for (const line of lines) {
      byDay.set(line.postedAt, (byDay.get(line.postedAt) ?? 0) + line.amount);
    }

    for (const day of [...byDay.keys()].sort()) {
      running += byDay.get(day)!;
      const declared = declaredBalances.get(day);
      if (declared === undefined) continue;

      const ok = declared === running;
      dailyChecks.push({ date: day, declared, computed: running, ok });

      if (!ok) {
        problems.push(
          `Saldo de ${day} não confere: o extrato declara ${reais(declared)} e o acumulado das ` +
            `linhas lidas dá ${reais(running)}.`,
        );
      }
    }
  }

  const computedClosing = declaredOpening === undefined ? undefined : running;

  if (
    declaredClosing !== undefined &&
    computedClosing !== undefined &&
    declaredClosing !== computedClosing
  ) {
    problems.push(
      `Saldo final não confere: o extrato declara ${reais(declaredClosing)} e o acumulado das ` +
        `linhas lidas dá ${reais(computedClosing)}.`,
    );
  }

  return {
    declaredOpening,
    declaredClosing,
    declaredInflow: input.declaredInflow,
    declaredOutflow: input.declaredOutflow,
    computedInflow,
    computedOutflow,
    computedClosing,
    dailyChecks,
    ok: problems.length === 0,
    problems,
  };
}

function readLabeledAmount(text: string, pattern: RegExp): Cents | undefined {
  const found = pattern.exec(text);
  return found ? parseUserInput(found[1]!) : undefined;
}

function toIso(date: RegExpExecArray): IsoDate {
  return `${date[3]}-${date[2]}-${date[1]}`;
}

/** 2026-08-25 -> 25/08/2026 */
function formatDate(date: IsoDate): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function reais(cents: Cents): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}R$ ${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Header and footer that repeat on every page. */
function isPageNoise(text: string): boolean {
  return (
    /^pág \d+ de \d+$/i.test(text) ||
    /^Extrato gerado no dia/i.test(text) ||
    /^Ouvidoria:/i.test(text) ||
    /^Cora SCFI/i.test(text) ||
    /^Agência:/i.test(text) ||
    /^CNPJ [\d./-]+$/i.test(text)
  );
}
