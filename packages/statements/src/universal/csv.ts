/**
 * CSV statement reader.
 *
 * CSV has no standard: every bank picks its own delimiter, column order,
 * date format and how it represents an outflow — sometimes a negative sign,
 * sometimes a separate debit column. That's why the column mapping is
 * explicit and gets saved per bank: whoever configures it once doesn't
 * configure it again the following month.
 *
 * `detectMapping` proposes the mapping from the column titles, and whoever
 * is operating confirms or corrects it. Guessing without confirmation would
 * be worse than asking: a wrong mapping imports the entire statement
 * swapped, and the error only shows up at closing time.
 *
 * A note on language: `ImportError` messages, warnings, and the
 * `HEADER_HINTS` list below are deliberately kept in Portuguese. The former
 * are direct, actionable instructions read by the accountant operating the
 * system; the latter matches against real Brazilian bank CSV column
 * headers, which are themselves written in Portuguese — that's input data
 * being matched, not code. Everything else is in English like the rest of
 * the codebase.
 */

import { type Cents, isIsoDate, type IsoDate, normalizeText, parseUserInput } from "@aec/domain";

import { assignDedupKeys } from "./dedup";
import { type CanonicalLine, type CanonicalStatement, ImportError } from "./types";

/** Column referenced by title or by zero-based position. */
export type ColumnRef = string | number;

export interface CsvMapping {
  readonly delimiter?: string;
  /** Bank header rows to skip before the table. */
  readonly skipRows?: number;
  readonly hasHeader?: boolean;
  readonly dateColumn: ColumnRef;
  readonly descriptionColumn: ColumnRef;
  /** Single column with a signed amount. Alternative to separate debit/credit. */
  readonly amountColumn?: ColumnRef;
  /** Banks that split inflow and outflow into separate columns. */
  readonly debitColumn?: ColumnRef;
  readonly creditColumn?: ColumnRef;
  readonly documentColumn?: ColumnRef;
  /** When the bank exports an outflow as positive in a single column. */
  readonly invertSign?: boolean;
}

const DELIMITERS = [";", ",", "\t", "|"] as const;

/**
 * Detects the delimiter by counting which one produces the same number of
 * columns most consistently across lines. A simple occurrence count would
 * get it wrong on a memo that contains a comma, which is the norm in bank
 * descriptions.
 */
export function detectDelimiter(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, 20);

  if (lines.length === 0) return ";";

  let best = ";";
  let bestScore = -1;

  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => splitLine(line, delimiter).length);
    const columns = counts[0] ?? 1;
    if (columns < 2) continue;

    const consistent = counts.filter((count) => count === columns).length;
    const score = consistent * 100 + columns;

    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

/** Splits a line respecting quotes and doubled quotes ("" inside a field). */
function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const char = line[index]!;

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      fields.push(field.trim());
      field = "";
    } else {
      field += char;
    }
  }

  fields.push(field.trim());
  return fields;
}

/** Splits the file into rows, respecting a line break inside a quoted field. */
export function parseCsv(content: string, delimiter?: string): string[][] {
  // U+FEFF is the UTF-8 byte order mark some banks prepend to the export.
  // Written as an escape, not the literal character, so it stays visible in
  // the source instead of vanishing into an invisible byte at the file head.
  const clean = content.replace(/^\uFEFF/, "");
  const sep = delimiter ?? detectDelimiter(clean);

  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < clean.length; index++) {
    const char = clean[index]!;

    if (char === '"') {
      const isEscapedQuote = inQuotes && clean[index + 1] === '"';
      if (isEscapedQuote) {
        // A doubled quote inside the field: consume both and stay inside the quotes.
        current += '""';
        index++;
      } else {
        inQuotes = !inQuotes;
        current += char;
      }
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && clean[index + 1] === "\n") index++;
      if (current.trim() !== "") rows.push(splitLine(current, sep));
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim() !== "") rows.push(splitLine(current, sep));
  return rows;
}

const HEADER_HINTS = {
  date: ["data", "data lancamento", "data movimento", "dt", "date", "data da operacao"],
  description: [
    "historico",
    "descricao",
    "lancamento",
    "memo",
    "detalhe",
    "description",
    "historico complementar",
  ],
  amount: ["valor", "valor r", "montante", "amount", "vlr"],
  debit: ["debito", "saida", "saidas", "pagamento", "debit"],
  credit: ["credito", "entrada", "entradas", "recebimento", "credit"],
  document: ["documento", "doc", "numero documento", "num doc", "n documento"],
} as const;

function findColumn(header: readonly string[], hints: readonly string[]): number | undefined {
  const normalized = header.map((title) => normalizeText(title));

  // Exact title first; only then accept containing the term, so "valor"
  // doesn't capture "valor do saldo" when there's a real "valor" column.
  for (const hint of hints) {
    const exact = normalized.indexOf(hint);
    if (exact >= 0) return exact;
  }
  for (const hint of hints) {
    const partial = normalized.findIndex((title) => title.includes(hint));
    if (partial >= 0) return partial;
  }
  return undefined;
}

export interface DetectedMapping {
  readonly mapping: CsvMapping | null;
  readonly header: readonly string[];
  readonly delimiter: string;
  readonly problems: readonly string[];
}

/**
 * Proposes a mapping from the column titles. The result is a suggestion for
 * whoever is operating to confirm, never an automatic decision.
 */
export function detectMapping(content: string): DetectedMapping {
  const delimiter = detectDelimiter(content);
  const rows = parseCsv(content, delimiter);
  const problems: string[] = [];

  // Banks often put the account holder's name, branch and period before the
  // table. The real header row is the first one that looks like it has a
  // date and an amount.
  const headerIndex = rows.findIndex(
    (row) =>
      row.length >= 3 &&
      findColumn(row, HEADER_HINTS.date) !== undefined &&
      (findColumn(row, HEADER_HINTS.amount) !== undefined ||
        findColumn(row, HEADER_HINTS.credit) !== undefined),
  );

  if (headerIndex < 0) {
    return {
      mapping: null,
      header: rows[0] ?? [],
      delimiter,
      problems: [
        "Nao foi possivel identificar a linha de cabecalho. Configure as colunas manualmente.",
      ],
    };
  }

  const header = rows[headerIndex]!;
  const dateColumn = findColumn(header, HEADER_HINTS.date);
  const descriptionColumn = findColumn(header, HEADER_HINTS.description);
  const amountColumn = findColumn(header, HEADER_HINTS.amount);
  const debitColumn = findColumn(header, HEADER_HINTS.debit);
  const creditColumn = findColumn(header, HEADER_HINTS.credit);

  if (descriptionColumn === undefined) {
    problems.push("Nao identifiquei a coluna de historico.");
  }
  if (amountColumn === undefined && (debitColumn === undefined || creditColumn === undefined)) {
    problems.push("Nao identifiquei a coluna de valor.");
  }

  if (dateColumn === undefined || problems.length > 0) {
    return { mapping: null, header, delimiter, problems };
  }

  return {
    mapping: {
      delimiter,
      skipRows: headerIndex,
      hasHeader: true,
      dateColumn,
      descriptionColumn: descriptionColumn ?? 1,
      ...(amountColumn !== undefined ? { amountColumn } : { debitColumn, creditColumn }),
      documentColumn: findColumn(header, HEADER_HINTS.document),
    },
    header,
    delimiter,
    problems,
  };
}

/**
 * Converts the CSV date.
 *
 * Brazilian format: dd/mm/yyyy. The day-month order is not guessed — in
 * "05/03/2025" both readings are valid, and picking the wrong one would
 * shift the whole month with nothing to catch it. This system is Brazilian,
 * so the rule is fixed and documented, rather than heuristic.
 */
export function parseCsvDate(value: string): IsoDate {
  const raw = value.trim();

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) {
    const date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    if (!isIsoDate(date)) throw new ImportError(`Data inexistente no calendario: "${value}"`);
    return date;
  }

  const br = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(raw);
  if (br) {
    const day = br[1]!.padStart(2, "0");
    const month = br[2]!.padStart(2, "0");
    const yearRaw = br[3]!;
    // Two-digit year: 00-69 becomes 2000-2069; 70-99 becomes 1970-1999.
    const year =
      yearRaw.length === 4
        ? yearRaw
        : Number(yearRaw) <= 69
          ? `20${yearRaw.padStart(2, "0")}`
          : `19${yearRaw}`;

    const date = `${year}-${month}-${day}`;
    if (!isIsoDate(date)) throw new ImportError(`Data inexistente no calendario: "${value}"`);
    return date;
  }

  throw new ImportError(`Data invalida: "${value}" (esperado dd/mm/aaaa ou aaaa-mm-dd)`);
}

function cell(
  row: readonly string[],
  header: readonly string[],
  ref: ColumnRef | undefined,
): string {
  if (ref === undefined) return "";
  if (typeof ref === "number") return row[ref] ?? "";

  const normalized = normalizeText(ref);
  const index = header.findIndex((title) => normalizeText(title) === normalized);
  return index >= 0 ? (row[index] ?? "") : "";
}

export function parseStatementCsv(content: string, mapping: CsvMapping): CanonicalStatement {
  const rows = parseCsv(content, mapping.delimiter);
  const skip = mapping.skipRows ?? 0;
  const header = mapping.hasHeader !== false ? (rows[skip] ?? []) : [];
  const dataRows = rows.slice(skip + (mapping.hasHeader !== false ? 1 : 0));

  if (dataRows.length === 0) {
    throw new ImportError("O arquivo nao tem nenhuma linha de movimento.");
  }

  const warnings: string[] = [];

  const rawLines = dataRows.flatMap((row, index) => {
    const lineNumber = skip + index + 2;
    const rawDate = cell(row, header, mapping.dateColumn);

    // Banks close the file with a total or balance line. Without a valid
    // date, it's not a transaction.
    if (rawDate.trim() === "") return [];

    try {
      const amount = readAmount(row, header, mapping);
      if (amount === 0) return [];

      return [
        {
          postedAt: parseCsvDate(rawDate),
          amount,
          memo: cell(row, header, mapping.descriptionColumn).trim(),
          checkNumber: cell(row, header, mapping.documentColumn).trim() || undefined,
        },
      ];
    } catch (error) {
      warnings.push(
        `Linha ${lineNumber} ignorada: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  });

  const lines: CanonicalLine[] = assignDedupKeys(rawLines);

  const duplicates = countDuplicateContent(rawLines);
  if (duplicates > 0) {
    warnings.push(
      `${duplicates} movimento(s) com data, valor e historico identicos a outro do mesmo arquivo. ` +
        "Foram mantidos, mas confira: CSV nao traz identificador do banco, entao a reimportacao " +
        "desse dia pode nao distinguir os repetidos. Prefira o OFX quando o banco oferecer.",
    );
  }

  const dates = lines.map((line) => line.postedAt).sort();

  return {
    source: "csv",
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    lines,
    warnings,
  };
}

function readAmount(row: readonly string[], header: readonly string[], mapping: CsvMapping): Cents {
  if (mapping.amountColumn !== undefined) {
    const raw = cell(row, header, mapping.amountColumn).trim();
    if (raw === "") throw new ImportError("Valor vazio");
    const amount = parseUserInput(raw);
    return mapping.invertSign ? -amount : amount;
  }

  const debitRaw = cell(row, header, mapping.debitColumn).trim();
  const creditRaw = cell(row, header, mapping.creditColumn).trim();

  // Separate columns: the value comes with no sign, and the column is what
  // tells the direction.
  const debit = debitRaw === "" ? 0 : Math.abs(parseUserInput(debitRaw));
  const credit = creditRaw === "" ? 0 : Math.abs(parseUserInput(creditRaw));

  if (debit !== 0 && credit !== 0) {
    throw new ImportError("Linha com valor em debito e em credito ao mesmo tempo");
  }

  return credit - debit;
}

function countDuplicateContent(
  lines: ReadonlyArray<{ postedAt: IsoDate; amount: Cents; memo: string }>,
): number {
  const seen = new Set<string>();
  let duplicates = 0;

  for (const line of lines) {
    const key = `${line.postedAt}|${line.amount}|${normalizeText(line.memo)}`;
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }

  return duplicates;
}
