/**
 * OFX reader.
 *
 * Has to handle the two dialects that circulate for real:
 *
 *   OFX 1.x — SGML, with an `OFXHEADER:100` header and leaf tags that are NOT
 *             closed (`<TRNAMT>-1800.00` is the whole value). This is what
 *             practically every Brazilian bank exports.
 *   OFX 2.x — well-formed XML, with every tag closed.
 *
 * The reader below accepts both with the same code, tolerating a missing
 * closing tag instead of requiring valid XML. A strict XML parser would
 * reject the file from Itaú, which is exactly the use case.
 *
 * A note on language: every user-facing string below (ImportError messages,
 * warnings) is deliberately kept in Portuguese. These are direct,
 * actionable instructions read by the accountant operating the system —
 * "ask the bank for the rest of the statement" — not internal diagnostics,
 * and the product's screen text stays in Portuguese throughout. Everything
 * else — identifiers, comments, control flow — is in English like the rest
 * of the codebase.
 */

import { type Cents, fromDb, isIsoDate, type IsoDate, sum } from "@aec/domain";

import { assignDedupKeys } from "./dedup";
import {
  type CanonicalLine,
  type CanonicalStatement,
  ImportError,
  type StatementIntegrity,
} from "./types";

interface OfxNode {
  readonly tag: string;
  readonly children: OfxNode[];
  value?: string;
}

/**
 * Decodes the file's bytes.
 *
 * OFX 1.x declares the encoding in its header, and Brazilian banks often use
 * CHARSET:1252 — reading that file as UTF-8 turns "JOSÉ" into "JOSÃ‰" in the
 * memo, and the memo is what feeds the categorization rules.
 */
export function decodeOfx(bytes: Uint8Array): string {
  const preview = new TextDecoder("latin1").decode(bytes.slice(0, 512));

  const charset = /CHARSET\s*:\s*([\w-]+)/i.exec(preview)?.[1]?.toUpperCase();
  const encoding = /ENCODING\s*:\s*([\w-]+)/i.exec(preview)?.[1]?.toUpperCase();
  const xmlEncoding = /<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i.exec(preview)?.[1];

  const declared = xmlEncoding ?? charset ?? encoding;
  const label = normalizeEncodingLabel(declared);

  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function normalizeEncodingLabel(declared: string | undefined): string {
  if (declared === undefined) return "utf-8";
  const upper = declared.toUpperCase();
  if (upper === "1252" || upper === "CP1252" || upper === "WINDOWS-1252") return "windows-1252";
  if (upper === "8859-1" || upper === "ISO-8859-1" || upper === "LATIN1") return "windows-1252";
  if (upper === "USASCII" || upper === "US-ASCII") return "windows-1252";
  if (upper === "UNICODE" || upper === "UTF-8") return "utf-8";
  return declared.toLowerCase();
}

/**
 * Builds the document tree.
 *
 * The rule that resolves SGML and XML at once: an opening tag followed by
 * text is a leaf; followed by another tag, it's a container. A closing tag
 * only pops the stack if it matches the open container — so an XML
 * `</TRNAMT>`, which closes a leaf, is simply ignored instead of closing
 * `<STMTTRN>` by mistake.
 */
function parseTree(content: string): OfxNode {
  const body = content.slice(Math.max(0, content.indexOf("<OFX>")));
  const root: OfxNode = { tag: "#root", children: [] };
  const stack: OfxNode[] = [root];

  const tokens = /<(\/?)([A-Za-z0-9._:]+)>([^<]*)/g;
  let token: RegExpExecArray | null;

  while ((token = tokens.exec(body)) !== null) {
    const [, slash, rawTag, rawText] = token;
    const tag = rawTag!.toUpperCase();
    const text = decodeEntities(rawText!.trim());
    const current = stack[stack.length - 1]!;

    if (slash === "/") {
      if (current.tag === tag && stack.length > 1) {
        stack.pop();
      }
      continue;
    }

    if (text !== "") {
      current.children.push({ tag, children: [], value: text });
      continue;
    }

    const container: OfxNode = { tag, children: [] };
    current.children.push(container);
    stack.push(container);
  }

  return root;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/gi, "&");
}

function findAll(node: OfxNode, tag: string): OfxNode[] {
  const found: OfxNode[] = [];
  const walk = (current: OfxNode): void => {
    for (const child of current.children) {
      if (child.tag === tag) found.push(child);
      walk(child);
    }
  };
  walk(node);
  return found;
}

function findFirst(node: OfxNode, tag: string): OfxNode | undefined {
  return findAll(node, tag)[0];
}

function childValue(node: OfxNode, tag: string): string | undefined {
  return node.children.find((child) => child.tag === tag)?.value;
}

/**
 * Converts DTPOSTED into a calendar date.
 *
 * The format is `YYYYMMDD` or `YYYYMMDDHHMMSS[-3:BRT]`. Only the first eight
 * digits are used, ON PURPOSE: converting "20250301000000[-3:BRT]" into an
 * instant and then formatting it would push the March 1st transaction to
 * February 28th of the previous month. The date the bank reports is already
 * the local date of the movement.
 */
export function parseOfxDate(value: string): IsoDate {
  const digits = value.trim().replace(/^\[|\]$/g, "");
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(digits);
  if (!match) {
    throw new ImportError(`Data OFX inválida: "${value}"`);
  }

  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isIsoDate(iso)) {
    throw new ImportError(`Data OFX inexistente no calendário: "${value}"`);
  }
  return iso;
}

/**
 * Converts TRNAMT into cents.
 *
 * The spec mandates a dot as the decimal separator, but some Brazilian
 * exporters use a comma. When both separators show up, the last one is the
 * decimal.
 */
export function parseOfxAmount(value: string): Cents {
  const raw = value.trim().replace(/\s|R\$/gi, "");
  if (raw === "") {
    throw new ImportError("Valor OFX vazio");
  }

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");

  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    normalized =
      lastComma > lastDot ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = raw.replace(",", ".");
  } else {
    normalized = raw;
  }

  if (!/^[+-]?\d*\.?\d*$/.test(normalized) || /^[+-]?\.?$/.test(normalized)) {
    throw new ImportError(`Valor OFX inválido: "${value}"`);
  }

  return fromDb(normalized.replace(/^\+/, ""));
}

/**
 * A CNPJ or CPF anywhere in the memo.
 *
 * Deliberately generic extraction: a document number in the memo is
 * unambiguous for any bank, so it's always worth looking for. The NAME is
 * not extracted — every bank assembles its memo its own way, and cutting the
 * name out by position would work for one and fail for the others. When the
 * bank puts the document number in, it's the most reliable counterparty key
 * there is: it doesn't change, doesn't abbreviate and isn't truncated.
 */
function documentInMemo(memo: string): string | undefined {
  const found =
    /(?<![\d.])(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})(?![\d-])/.exec(memo);
  return found ? found[1]!.replace(/\D/g, "") : undefined;
}

export function parseOfx(input: string | Uint8Array): CanonicalStatement {
  const content = typeof input === "string" ? input : decodeOfx(input);

  if (!/<OFX>/i.test(content)) {
    throw new ImportError(
      "Arquivo não parece ser um OFX: não contém a seção <OFX>. Confira se o download do banco foi concluído.",
    );
  }

  const root = parseTree(content);
  const warnings: string[] = [];

  const account = findFirst(root, "BANKACCTFROM") ?? findFirst(root, "CCACCTFROM");
  const transactionList = findFirst(root, "BANKTRANLIST");
  const ledger = findFirst(root, "LEDGERBAL");

  const rawLines = findAll(root, "STMTTRN").flatMap((node, index) => {
    const posted = childValue(node, "DTPOSTED");
    const amount = childValue(node, "TRNAMT");

    if (posted === undefined || amount === undefined) {
      warnings.push(`Transação ${index + 1} ignorada: falta data ou valor.`);
      return [];
    }

    try {
      // NAME is the counterparty, MEMO is the note. Banks fill in one, the
      // other, or both — joining the two preserves what feeds the rules.
      const name = childValue(node, "NAME") ?? "";
      const memo = childValue(node, "MEMO") ?? "";
      const combined = [name, memo]
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .filter((part, position, all) => all.indexOf(part) === position)
        .join(" - ");

      return [
        {
          postedAt: parseOfxDate(posted),
          amount: parseOfxAmount(amount),
          memo: combined,
          fitid: childValue(node, "FITID"),
          checkNumber: childValue(node, "CHECKNUM"),
          counterpartyDocument: documentInMemo(combined),
        },
      ];
    } catch (error) {
      warnings.push(
        `Transação ${index + 1} ignorada: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  });

  const lines: CanonicalLine[] = assignDedupKeys(rawLines);

  const withoutFitid = lines.filter((line) => line.fitid === undefined || line.fitid === "").length;
  if (withoutFitid > 0) {
    warnings.push(
      `${withoutFitid} de ${lines.length} transações vieram sem FITID. A deduplicação dessas usa data, valor e memo.`,
    );
  }

  const declaredStart = readDate(transactionList, "DTSTART");
  const declaredEnd = readDate(transactionList, "DTEND");
  const declaredClosing = ledger ? readAmount(ledger, "BALAMT") : undefined;
  const declaredClosingDate = readDate(ledger, "DTASOF");

  // The date the bank generated the file. This is the key to not trusting a
  // period the statement can't actually attest to.
  const generatedAt = readDate(findFirst(root, "SONRS"), "DTSERVER");

  // The period the statement ATTESTS TO is not the one it declares.
  //
  // A file requested on the 25th for the whole month comes out with DTEND on
  // the 31st, and LEDGERBAL with DTASOF on the 31st, but it has no way to
  // contain what hasn't happened yet. Recording the 31st would make the
  // system treat the month as covered, and the following days would never
  // get charged to anyone.
  //
  // Note the cutoff is by the GENERATION date, not by the last transaction:
  // no movement between the 21st and the 25th is legitimate information from
  // the statement, not a gap.
  const periodEnd =
    declaredEnd !== undefined && generatedAt !== undefined && generatedAt < declaredEnd
      ? generatedAt
      : declaredEnd;

  if (declaredEnd !== undefined && periodEnd !== undefined && periodEnd < declaredEnd) {
    warnings.push(
      `O arquivo diz cobrir até ${formatDate(declaredEnd)}, mas foi gerado em ` +
        `${formatDate(periodEnd)} e não pode conter o que veio depois. O período importado vai ` +
        "até a data de geração; peça o extrato do restante antes de fechar o mês.",
    );
  }

  const integrity = check(lines, declaredClosing);
  if (!integrity.ok) warnings.push(...integrity.problems);

  const withDocument = lines.filter((line) => line.counterpartyDocument !== undefined).length;
  if (withDocument > 0) {
    warnings.push(
      `${withDocument} de ${lines.length} transações trazem CNPJ ou CPF no histórico. ` +
        "Regras de categorização por documento são mais confiáveis que por nome.",
    );
  }

  return {
    source: "ofx",
    bankId: account ? childValue(account, "BANKID") : undefined,
    accountId: account ? childValue(account, "ACCTID") : undefined,
    periodStart: declaredStart,
    periodEnd,
    ledgerBalance: declaredClosing,
    // Not the raw DTASOF: if the file was generated earlier, the balance is as of that date.
    ledgerBalanceDate:
      declaredClosingDate !== undefined &&
      generatedAt !== undefined &&
      generatedAt < declaredClosingDate
        ? generatedAt
        : declaredClosingDate,
    lines,
    integrity,
    warnings,
  };
}

/**
 * Checks whatever can be checked in an OFX file.
 *
 * Less than a PDF allows, and it's worth being explicit about that: OFX
 * carries the closing balance (LEDGERBAL) but not the opening one, and no
 * per-day balance. Without a starting balance, the file can't prove on its
 * own that no transaction was lost — it only asserts a total.
 *
 * What gets recorded is the IMPLIED opening balance: closing balance minus
 * the movement read. The application compares that number against the
 * balance it already has for the account on the eve of the period; if it
 * matches, the statement is sound. It's the same check the PDF does, just
 * closed from the outside.
 */
function check(
  lines: readonly CanonicalLine[],
  declaredClosing: Cents | undefined,
): StatementIntegrity {
  const computedInflow = sum(lines.filter((line) => line.amount > 0).map((line) => line.amount));
  const computedOutflow = -sum(lines.filter((line) => line.amount < 0).map((line) => line.amount));

  return {
    declaredClosing,
    // Opening balance implied by the file, for the application to cross-check.
    declaredOpening:
      declaredClosing === undefined
        ? undefined
        : declaredClosing - (computedInflow - computedOutflow),
    computedInflow,
    computedOutflow,
    computedClosing: declaredClosing,
    dailyChecks: [],
    ok: true,
    problems: [],
  };
}

/** 2026-08-25 -> 25/08/2026 */
function formatDate(date: IsoDate): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function readDate(node: OfxNode | undefined, tag: string): IsoDate | undefined {
  const raw = node ? childValue(node, tag) : undefined;
  if (raw === undefined) return undefined;
  try {
    return parseOfxDate(raw);
  } catch {
    return undefined;
  }
}

function readAmount(node: OfxNode, tag: string): Cents | undefined {
  const raw = childValue(node, tag);
  if (raw === undefined) return undefined;
  try {
    return parseOfxAmount(raw);
  } catch {
    return undefined;
  }
}
