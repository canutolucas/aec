/**
 * Leitor de OFX.
 *
 * Precisa aguentar os dois dialetos que circulam de verdade:
 *
 *   OFX 1.x — SGML, com cabecalho `OFXHEADER:100` e tags de folha que NAO sao
 *             fechadas (`<TRNAMT>-1800.00` e o valor todo). E o que praticamente
 *             todo banco brasileiro exporta.
 *   OFX 2.x — XML bem formado, com todas as tags fechadas.
 *
 * O leitor abaixo aceita os dois com o mesmo codigo, tolerando fechamento de tag
 * ausente em vez de exigir XML valido. Um parser de XML estrito rejeitaria o
 * arquivo do Itau, que e justamente o caso de uso.
 */

import { type IsoDate, isIsoDate } from "@/lib/domain/dates";
import { type Cents, fromDb } from "@/lib/domain/money";
import { assignDedupKeys } from "./dedup";
import { type CanonicalLine, type CanonicalStatement, ImportError } from "./types";

interface OfxNode {
  readonly tag: string;
  readonly children: OfxNode[];
  value?: string;
}

/**
 * Decodifica os bytes do arquivo.
 *
 * OFX 1.x declara a codificacao no cabecalho, e os bancos brasileiros costumam
 * usar CHARSET:1252 — ler esse arquivo como UTF-8 transforma "JOSÉ" em "JOSÃ‰"
 * no memo, e o memo e o que alimenta as regras de categorizacao.
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
 * Monta a arvore do documento.
 *
 * A regra que resolve SGML e XML de uma vez: uma tag de abertura seguida de
 * texto e uma folha; seguida de outra tag, e um container. E uma tag de
 * fechamento so desempilha se corresponder ao container aberto — assim o
 * `</TRNAMT>` do XML, que fecha uma folha, e simplesmente ignorado em vez de
 * fechar o `<STMTTRN>` por engano.
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
 * Converte DTPOSTED para data de calendario.
 *
 * O formato e `YYYYMMDD` ou `YYYYMMDDHHMMSS[-3:BRT]`. So os oito primeiros
 * digitos sao usados, DE PROPOSITO: converter "20250301000000[-3:BRT]" para um
 * instante e depois formatar levaria o lancamento do dia 1o para o dia 28 do mes
 * anterior. A data que o banco informa ja e a data local do movimento.
 */
export function parseOfxDate(value: string): IsoDate {
  const digits = value.trim().replace(/^\[|\]$/g, "");
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(digits);
  if (!match) {
    throw new ImportError(`Data OFX invalida: "${value}"`);
  }

  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isIsoDate(iso)) {
    throw new ImportError(`Data OFX inexistente no calendario: "${value}"`);
  }
  return iso;
}

/**
 * Converte TRNAMT para centavos.
 *
 * A especificacao manda ponto como decimal, mas ha exportador brasileiro que
 * emite virgula. Quando aparecem os dois separadores, o ultimo e o decimal.
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
      lastComma > lastDot
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = raw.replace(",", ".");
  } else {
    normalized = raw;
  }

  if (!/^[+-]?\d*\.?\d*$/.test(normalized) || /^[+-]?\.?$/.test(normalized)) {
    throw new ImportError(`Valor OFX invalido: "${value}"`);
  }

  return fromDb(normalized.replace(/^\+/, ""));
}

export function parseOfx(input: string | Uint8Array): CanonicalStatement {
  const content = typeof input === "string" ? input : decodeOfx(input);

  if (!/<OFX>/i.test(content)) {
    throw new ImportError(
      "Arquivo nao parece ser um OFX: nao contem a secao <OFX>. Confira se o download do banco foi concluido.",
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
      warnings.push(`Transacao ${index + 1} ignorada: falta data ou valor.`);
      return [];
    }

    try {
      // NAME e o contraparte, MEMO e a observacao. Bancos preenchem ora um, ora
      // outro, ora os dois — juntar os dois preserva o que alimenta as regras.
      const name = childValue(node, "NAME") ?? "";
      const memo = childValue(node, "MEMO") ?? "";
      const combined = [name, memo]
        .map((part) => part.trim())
        .filter((part) => part !== "")
        .filter((part, position, all) => all.indexOf(part) === position)
        .join(" - ");

      return [{
        postedAt: parseOfxDate(posted),
        amount: parseOfxAmount(amount),
        memo: combined,
        fitid: childValue(node, "FITID"),
        checkNumber: childValue(node, "CHECKNUM"),
      }];
    } catch (error) {
      warnings.push(
        `Transacao ${index + 1} ignorada: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  });

  const lines: CanonicalLine[] = assignDedupKeys(rawLines);

  const withoutFitid = lines.filter((line) => line.fitid === undefined || line.fitid === "").length;
  if (withoutFitid > 0) {
    warnings.push(
      `${withoutFitid} de ${lines.length} transacoes vieram sem FITID. A deduplicacao dessas usa data, valor e memo.`,
    );
  }

  return {
    source: "ofx",
    bankId: account ? childValue(account, "BANKID") : undefined,
    accountId: account ? childValue(account, "ACCTID") : undefined,
    periodStart: readDate(transactionList, "DTSTART"),
    periodEnd: readDate(transactionList, "DTEND"),
    ledgerBalance: ledger ? readAmount(ledger, "BALAMT") : undefined,
    ledgerBalanceDate: readDate(ledger, "DTASOF"),
    lines,
    warnings,
  };
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
