/**
 * Leitor de extrato em CSV.
 *
 * CSV nao tem padrao: cada banco escolhe separador, ordem de coluna, formato de
 * data e como representar saida — ora sinal negativo, ora uma coluna de debito
 * separada. Por isso o mapeamento de colunas e explicito e fica salvo por banco:
 * quem configura uma vez nao configura de novo no mes seguinte.
 *
 * `detectMapping` propoe o mapeamento a partir dos titulos das colunas, e quem
 * opera confirma ou corrige. Adivinhar sem confirmacao seria pior do que pedir:
 * um mapeamento errado importa o extrato inteiro trocado, e o erro so aparece no
 * fechamento.
 */

import { type IsoDate, isIsoDate } from "@/lib/domain/dates";
import { type Cents, parseUserInput } from "@/lib/domain/money";
import { normalizeText } from "@/lib/domain/matching";
import { assignDedupKeys } from "./dedup";
import { type CanonicalLine, type CanonicalStatement, ImportError } from "./types";

/** Coluna referenciada pelo titulo ou pela posicao (base zero). */
export type ColumnRef = string | number;

export interface CsvMapping {
  readonly delimiter?: string;
  /** Linhas de cabecalho do banco a pular antes da tabela. */
  readonly skipRows?: number;
  readonly hasHeader?: boolean;
  readonly dateColumn: ColumnRef;
  readonly descriptionColumn: ColumnRef;
  /** Coluna unica com valor assinado. Alternativa a debito/credito separados. */
  readonly amountColumn?: ColumnRef;
  /** Bancos que separam entrada e saida em colunas distintas. */
  readonly debitColumn?: ColumnRef;
  readonly creditColumn?: ColumnRef;
  readonly documentColumn?: ColumnRef;
  /** Quando o banco exporta saida como positivo em coluna unica. */
  readonly invertSign?: boolean;
}

const DELIMITERS = [";", ",", "\t", "|"] as const;

/**
 * Descobre o separador contando qual deles produz o mesmo numero de colunas de
 * forma mais consistente entre as linhas. Contar ocorrencias simples erraria em
 * memo que contem virgula, que e a norma em descricao bancaria.
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

/** Divide uma linha respeitando aspas e aspas duplicadas ("" dentro do campo). */
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

/** Divide o arquivo em linhas, respeitando quebra de linha dentro de campo entre aspas. */
export function parseCsv(content: string, delimiter?: string): string[][] {
  const clean = content.replace(/^﻿/, "");
  const sep = delimiter ?? detectDelimiter(clean);

  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < clean.length; index++) {
    const char = clean[index]!;

    if (char === '"') {
      const isEscapedQuote = inQuotes && clean[index + 1] === '"';
      if (isEscapedQuote) {
        // Aspas duplicadas dentro do campo: consome as duas e segue dentro das aspas.
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
  description: ["historico", "descricao", "lancamento", "memo", "detalhe", "description", "historico complementar"],
  amount: ["valor", "valor r", "montante", "amount", "vlr"],
  debit: ["debito", "saida", "saidas", "pagamento", "debit"],
  credit: ["credito", "entrada", "entradas", "recebimento", "credit"],
  document: ["documento", "doc", "numero documento", "num doc", "n documento"],
} as const;

function findColumn(header: readonly string[], hints: readonly string[]): number | undefined {
  const normalized = header.map((title) => normalizeText(title));

  // Titulo exato primeiro; so depois aceita conter o termo, para "valor" nao
  // capturar "valor do saldo" quando existe uma coluna "valor" de verdade.
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
 * Propoe um mapeamento a partir dos titulos das colunas. O resultado e uma
 * sugestao para quem opera confirmar, nunca uma decisao automatica.
 */
export function detectMapping(content: string): DetectedMapping {
  const delimiter = detectDelimiter(content);
  const rows = parseCsv(content, delimiter);
  const problems: string[] = [];

  // Bancos costumam colocar nome, agencia e periodo antes da tabela. A linha de
  // cabecalho de verdade e a primeira que tem algo parecido com data e valor.
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
      problems: ["Nao foi possivel identificar a linha de cabecalho. Configure as colunas manualmente."],
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
      ...(amountColumn !== undefined
        ? { amountColumn }
        : { debitColumn, creditColumn }),
      documentColumn: findColumn(header, HEADER_HINTS.document),
    },
    header,
    delimiter,
    problems,
  };
}

/**
 * Converte a data do CSV.
 *
 * Formato brasileiro: dd/mm/aaaa. A ordem dia-mes nao e adivinhada — em
 * "05/03/2025" as duas leituras sao validas, e escolher errado deslocaria o mes
 * inteiro sem nada acusar. Este sistema e brasileiro, entao a regra e fixa e
 * documentada, em vez de heuristica.
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
    // Ano de dois digitos: 00-69 vira 2000-2069; 70-99 vira 1970-1999.
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

function cell(row: readonly string[], header: readonly string[], ref: ColumnRef | undefined): string {
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

    // Bancos fecham o arquivo com linha de total ou de saldo. Sem data valida,
    // nao e movimento.
    if (rawDate.trim() === "") return [];

    try {
      const amount = readAmount(row, header, mapping);
      if (amount === 0) return [];

      return [{
        postedAt: parseCsvDate(rawDate),
        amount,
        memo: cell(row, header, mapping.descriptionColumn).trim(),
        checkNumber: cell(row, header, mapping.documentColumn).trim() || undefined,
      }];
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

function readAmount(
  row: readonly string[],
  header: readonly string[],
  mapping: CsvMapping,
): Cents {
  if (mapping.amountColumn !== undefined) {
    const raw = cell(row, header, mapping.amountColumn).trim();
    if (raw === "") throw new ImportError("Valor vazio");
    const amount = parseUserInput(raw);
    return mapping.invertSign ? -amount : amount;
  }

  const debitRaw = cell(row, header, mapping.debitColumn).trim();
  const creditRaw = cell(row, header, mapping.creditColumn).trim();

  // Colunas separadas: o valor vem sem sinal, e a coluna e que diz o sentido.
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
