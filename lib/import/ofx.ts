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
import { type Cents, fromDb, sum } from "@/lib/domain/money";
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
    throw new ImportError(`Data OFX inválida: "${value}"`);
  }

  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  if (!isIsoDate(iso)) {
    throw new ImportError(`Data OFX inexistente no calendário: "${value}"`);
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
    throw new ImportError(`Valor OFX inválido: "${value}"`);
  }

  return fromDb(normalized.replace(/^\+/, ""));
}

/**
 * CNPJ ou CPF em qualquer lugar do memo.
 *
 * Extracao deliberadamente generica: um documento no memo e inequivoco em
 * qualquer banco, entao vale a pena procurar sempre. O NOME nao e extraido —
 * cada banco monta o memo do seu jeito, e recortar nome por posicao daria certo
 * em um e errado nos outros. Quando o banco poe o documento, ele e a chave mais
 * confiavel de contraparte que existe: nao muda, nao abrevia e nao e truncado.
 */
function documentoNoMemo(memo: string): string | undefined {
  const encontrado = /(?<![\d.])(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})(?![\d-])/.exec(memo);
  return encontrado ? encontrado[1]!.replace(/\D/g, "") : undefined;
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
        counterpartyDocument: documentoNoMemo(combined),
      }];
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

  // Data em que o banco gerou o arquivo. E a chave para nao acreditar em um
  // periodo que o extrato nao pode atestar.
  const geradoEm = readDate(findFirst(root, "SONRS"), "DTSERVER");

  // O periodo que o extrato ATESTA nao e o que ele declara.
  //
  // Um arquivo pedido no dia 25 para o mes inteiro sai com DTEND no dia 31, e o
  // LEDGERBAL com DTASOF no dia 31, mas nao tem como conter o que ainda nao
  // aconteceu. Gravar 31 faria o sistema tratar o mes como coberto, e os dias
  // seguintes nunca seriam cobrados de ninguem.
  //
  // Repare que o corte e pela data de GERACAO, e nao pelo ultimo lancamento:
  // ausencia de movimento entre o dia 21 e o 25 e informacao legitima do extrato,
  // e nao lacuna.
  const periodEnd =
    declaredEnd !== undefined && geradoEm !== undefined && geradoEm < declaredEnd
      ? geradoEm
      : declaredEnd;

  if (declaredEnd !== undefined && periodEnd !== undefined && periodEnd < declaredEnd) {
    warnings.push(
      `O arquivo diz cobrir até ${formatarData(declaredEnd)}, mas foi gerado em ` +
        `${formatarData(periodEnd)} e não pode conter o que veio depois. O período importado vai ` +
        "até a data de geração; peça o extrato do restante antes de fechar o mês.",
    );
  }

  const integrity = conferir(lines, declaredClosing);
  if (!integrity.ok) warnings.push(...integrity.problems);

  const comDocumento = lines.filter((line) => line.counterpartyDocument !== undefined).length;
  if (comDocumento > 0) {
    warnings.push(
      `${comDocumento} de ${lines.length} transações trazem CNPJ ou CPF no histórico. ` +
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
    // Nao o DTASOF cru: se o arquivo foi gerado antes, o saldo e daquela data.
    ledgerBalanceDate:
      declaredClosingDate !== undefined && geradoEm !== undefined && geradoEm < declaredClosingDate
        ? geradoEm
        : declaredClosingDate,
    lines,
    integrity,
    warnings,
  };
}

/**
 * Confere o que da para conferir em um OFX.
 *
 * Menos do que um PDF permite, e vale ser explicito sobre isso: o OFX traz o
 * saldo final (LEDGERBAL) mas nao o inicial, e nao traz saldo por dia. Sem o
 * saldo de partida, o arquivo nao consegue provar sozinho que nenhuma transacao
 * se perdeu — ele so afirma um total.
 *
 * O que fica registrado e o saldo inicial IMPLICADO: saldo final menos o
 * movimento lido. A aplicacao compara esse numero com o saldo que ela ja tem
 * para a conta na vespera do periodo; batendo, o extrato esta integro. E a mesma
 * conferencia do PDF, so que fechada do lado de fora.
 */
function conferir(
  lines: readonly CanonicalLine[],
  declaredClosing: Cents | undefined,
): StatementIntegrity {
  const computedInflow = sum(lines.filter((line) => line.amount > 0).map((line) => line.amount));
  const computedOutflow = -sum(lines.filter((line) => line.amount < 0).map((line) => line.amount));

  return {
    declaredClosing,
    // Saldo inicial implicado pelo arquivo, para a aplicacao confrontar.
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
function formatarData(data: IsoDate): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
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
