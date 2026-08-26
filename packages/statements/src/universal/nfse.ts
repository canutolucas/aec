/**
 * Leitor de NFS-e (nota fiscal de serviço eletrônica) em XML.
 *
 * Ao contrário da NFe de mercadoria (padrão SEFAZ nacional único), a NFS-e é
 * MUNICIPAL: cada prefeitura roda seu próprio sistema, e o layout varia —
 * ABRASF v1, ABRASF v2, o padrão nacional novo (DPS/NFSe), ou algo
 * inteiramente próprio da cidade. Não existe um "o" schema de NFS-e.
 *
 * A estratégia aqui é DELIBERADAMENTE tolerante: em vez de exigir um caminho
 * fixo (`a.b.c.d`), procura o primeiro nó cujo nome bate com uma lista de
 * sinônimos conhecidos, em qualquer profundidade da árvore. Isso é o que
 * permite ler ABRASF v1, ABRASF v2 e o padrão nacional com o MESMO código —
 * eles usam nomes de tag diferentes para a mesma informação, mas a
 * informação em si (número, data, valor, cliente) é a mesma.
 *
 * Validado contra um XML real (Salvador/BA, ABRASF v1): a prefeitura exporta
 * a "consulta de NFS-e por período" como um ÚNICO arquivo contendo dezenas
 * de notas (`ConsultarNfseResposta > ListaNfse > CompNfse[]`), não um XML por
 * nota como se assumiu antes de ver o arquivo real. Por isso `parseNfse`
 * devolve uma LISTA de notas, nunca uma só — ver `findInvoiceEnvelopes`
 * abaixo. Esse mesmo arquivo real também veio em ISO-8859-1 (acentos
 * corrompem se decodificados como UTF-8 direto) — ver `decodeInvoiceXml`.
 */

import { type Cents, fromDb, isIsoDate, type IsoDate } from "@aec/domain";
import { XMLParser } from "fast-xml-parser";

import { ImportError } from "./types";

export interface CanonicalInvoice {
  readonly number: string;
  readonly series?: string;
  readonly verificationCode?: string;
  readonly issuedOn: IsoDate;
  /** Valor bruto do serviço — o valor da nota, antes de qualquer retenção. */
  readonly amount: Cents;
  /** Soma das retenções que o próprio XML declara (IR/CSLL/PIS/COFINS/INSS/ISS retido). So informativo. */
  readonly withheldAmount: Cents;
  readonly clientName: string;
  /** CNPJ ou CPF do tomador, só dígitos. */
  readonly clientTaxId?: string;
  readonly warnings: readonly string[];
}

type XmlNode = string | number | readonly XmlNode[] | { readonly [key: string]: XmlNode };

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false, // mantém tudo como string: valor monetário e data precisam do parsing tolerante abaixo, não da conversão automática da lib.
});

/** Acha o primeiro valor folha cuja tag bate com um dos nomes candidatos, em qualquer profundidade. */
function findValue(node: XmlNode | undefined, candidates: readonly string[]): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === "string" || typeof node === "number") return undefined;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findValue(item, candidates);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  // Prioriza um filho DIRETO cujo nome bate, antes de descer mais fundo —
  // evita que uma tag de mesmo nome, mas bem mais profunda na árvore (uma
  // coincidência em outro contexto), ganhe de uma tag claramente no lugar
  // certo.
  for (const [key, value] of Object.entries(node)) {
    if (candidates.some((c) => c.toLowerCase() === key.toLowerCase())) {
      if (typeof value === "string" || typeof value === "number") return String(value);
    }
  }
  for (const value of Object.values(node)) {
    const found = findValue(value, candidates);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Acha a primeira SUBARVORE cujo nome bate — usado para escopar a busca do tomador, não misturar com o prestador. */
function findSubtree(
  node: XmlNode | undefined,
  candidates: readonly string[],
): XmlNode | undefined {
  if (node === undefined || node === null || typeof node === "string" || typeof node === "number") {
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findSubtree(item, candidates);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  for (const [key, value] of Object.entries(node)) {
    if (candidates.some((c) => c.toLowerCase() === key.toLowerCase())) {
      return value;
    }
  }
  for (const value of Object.values(node)) {
    const found = findSubtree(value, candidates);
    if (found !== undefined) return found;
  }
  return undefined;
}

const TOMADOR_KEYS = ["tomador", "tomadorservico", "toma"];
const NUMBER_KEYS = ["numero", "numeronfse", "nnfse", "nnf"];
const SERIES_KEYS = ["serie", "serienfse"];
const VERIFICATION_KEYS = ["codigoverificacao", "codverificacao", "cverif"];
const DATE_KEYS = ["dataemissao", "dhemi", "demi", "dataemissaorps"];
const AMOUNT_KEYS = [
  "valorservicos",
  "vservprest",
  "vserv",
  "valortotalservicos",
  "valortotalnfse",
];
// So usado se nenhuma das chaves acima existir — ValorLiquidoNfse já é o
// valor DEPOIS de descontar retenção, então nesse caso withheldAmount fica
// 0 mesmo que o XML declare retenção em outro lugar (aproximação aceitável:
// withheld_amount é só informativo, nunca usado em cálculo de saldo).
const NET_AMOUNT_FALLBACK_KEYS = ["valorliquidonfse", "vliq"];
const CLIENT_TAX_ID_KEYS = ["cnpj", "cpf"];
const CLIENT_NAME_KEYS = ["razaosocial", "xnome", "nome"];
const WITHHELD_KEYS = [
  "valorir",
  "valorcsll",
  "valorpis",
  "valorcofins",
  "valorinss",
  "valoriss",
  "vretcp",
  "vretirrf",
  "vretcsll",
  "vretpis",
  "vretcofins",
  "vretiss",
];

function parseNfseDate(value: string): IsoDate {
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (iso) {
    if (!isIsoDate(iso[1]!)) {
      throw new ImportError(`Data da NFS-e inexistente no calendário: "${value}"`);
    }
    return iso[1]! as IsoDate;
  }

  // DD/MM/AAAA: alguns sistemas municipais mais antigos exportam neste formato.
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value.trim());
  if (br) {
    const [, day, month, year] = br;
    const candidate = `${year}-${month}-${day}`;
    if (!isIsoDate(candidate)) {
      throw new ImportError(`Data da NFS-e inexistente no calendário: "${value}"`);
    }
    return candidate as IsoDate;
  }

  throw new ImportError(`Não foi possível reconhecer a data da NFS-e: "${value}"`);
}

/** Mesma tolerância a vírgula/ponto decimal que parseOfxAmount (ofx.ts) — o XSD da NFS-e manda ponto, mas vale ser tolerante. */
function parseNfseAmount(value: string, field: string): Cents {
  const raw = value.trim().replace(/\s|R\$/gi, "");
  if (raw === "") throw new ImportError(`${field} vazio na NFS-e`);

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
    throw new ImportError(`${field} inválido na NFS-e: "${value}"`);
  }
  return fromDb(normalized);
}

/** Só dígitos — mesmo formato que counterparties.tax_id e bank_accounts já usam. */
function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Um nó "parece" uma nota quando ele sozinho já tem número, data e valor — o suficiente pra extrair uma CanonicalInvoice sem olhar pros vizinhos. */
function looksLikeInvoice(node: XmlNode): boolean {
  if (node === undefined || node === null || typeof node === "string" || typeof node === "number") {
    return false;
  }
  return (
    findValue(node, NUMBER_KEYS) !== undefined &&
    findValue(node, DATE_KEYS) !== undefined &&
    (findValue(node, AMOUNT_KEYS) !== undefined ||
      findValue(node, NET_AMOUNT_FALLBACK_KEYS) !== undefined)
  );
}

/**
 * Acha os "envelopes" de nota dentro do XML — um por nota.
 *
 * A maioria dos layouts documentados traz uma nota só por arquivo, mas o
 * XML real de Salvador/BA prova que isso não é universal: a prefeitura
 * exporta a consulta por período como um lote único, com um `<CompNfse>`
 * por nota dentro de `<ListaNfse>`. Em vez de procurar por um nome de tag
 * de "lote" específico (que mudaria de município pra município, como tudo
 * aqui), a busca é por FORMATO: percorre a árvore em largura (BFS) e para
 * na primeira array de nós onde ALGUM item parece nota sozinho — essa é a
 * lista de notas do lote. É "algum", não "todos", de propósito: uma nota
 * malformada dentro de um lote de 40+ não pode impedir de achar as outras
 * 39 — quem trata a nota ruim individualmente é parseNfse, que devolve o
 * erro dela em vez de derrubar o lote inteiro. Se nenhum item parecer nota,
 * o documento inteiro vira uma nota só (o caso comum, preservando o
 * comportamento de antes deste arquivo real).
 */
function findInvoiceEnvelopes(tree: XmlNode): readonly XmlNode[] {
  const queue: XmlNode[] = [tree];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (node === null || typeof node === "string" || typeof node === "number") continue;
    if (Array.isArray(node)) {
      if (node.length > 0 && node.some((item) => looksLikeInvoice(item))) {
        return node;
      }
      for (const item of node) queue.push(item);
      continue;
    }
    for (const value of Object.values(node)) queue.push(value);
  }
  return [tree];
}

/**
 * Decodifica os bytes brutos do XML respeitando o encoding declarado no
 * prolog (`<?xml ... encoding="..."?>`).
 *
 * O XML real de Salvador/BA veio em ISO-8859-1 — `File.text()` do navegador
 * sempre decodifica como UTF-8, o que transforma todo acento (nome de
 * cliente, endereço, discriminação do serviço) em mojibake silencioso. O
 * prolog em si é sempre ASCII puro (aspas, letras, "="), então ler só os
 * primeiros bytes como Latin-1 pra descobrir o encoding declarado é seguro
 * mesmo sem ainda saber o encoding do resto do arquivo.
 */
export function decodeInvoiceXml(bytes: ArrayBuffer): string {
  const head = new TextDecoder("iso-8859-1").decode(bytes.slice(0, 200));
  const declared = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase();
  try {
    return new TextDecoder(declared ?? "utf-8").decode(bytes);
  } catch {
    // Encoding declarado mas desconhecido do TextDecoder (raro) — UTF-8 é a
    // aposta mais segura de qualquer forma.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export interface NfseParseResult {
  readonly invoices: readonly CanonicalInvoice[];
  /**
   * Notas do lote que não puderam ser lidas — uma mensagem pronta por item,
   * nunca descartada em silêncio (mesmo espírito do `failed` de
   * `importarNotas`). Um XML de nota única que falha entra aqui como um
   * único erro, com `invoices` vazio.
   */
  readonly errors: readonly string[];
}

export function parseNfse(xml: string): NfseParseResult {
  let tree: XmlNode;
  try {
    tree = parser.parse(xml) as XmlNode;
  } catch (error) {
    throw new ImportError(
      `Não foi possível ler este XML: ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
  }

  const envelopes = findInvoiceEnvelopes(tree);
  const multiple = envelopes.length > 1;
  const invoices: CanonicalInvoice[] = [];
  const errors: string[] = [];

  envelopes.forEach((envelope, index) => {
    try {
      invoices.push(parseInvoiceNode(envelope));
    } catch (error) {
      const message =
        error instanceof ImportError ? error.message : "Erro desconhecido ao ler a nota.";
      errors.push(
        multiple ? `Nota ${index + 1} de ${envelopes.length} no arquivo: ${message}` : message,
      );
    }
  });

  return { invoices, errors };
}

/** Extrai uma nota de UM envelope (uma nota sozinha, ou um item do lote — ver findInvoiceEnvelopes). */
function parseInvoiceNode(tree: XmlNode): CanonicalInvoice {
  const warnings: string[] = [];

  const number = findValue(tree, NUMBER_KEYS);
  if (!number) throw new ImportError("Número da nota não encontrado no XML.");

  const rawDate = findValue(tree, DATE_KEYS);
  if (!rawDate) throw new ImportError("Data de emissão não encontrada no XML.");
  const issuedOn = parseNfseDate(rawDate);

  let rawAmount = findValue(tree, AMOUNT_KEYS);
  let amount: Cents;
  let withheldAmount = 0;
  if (rawAmount) {
    amount = parseNfseAmount(rawAmount, "Valor dos serviços");
    for (const key of WITHHELD_KEYS) {
      const raw = findValue(tree, [key]);
      if (raw) withheldAmount += parseNfseAmount(raw, key);
    }
  } else {
    rawAmount = findValue(tree, NET_AMOUNT_FALLBACK_KEYS);
    if (!rawAmount) throw new ImportError("Valor da nota não encontrado no XML.");
    amount = parseNfseAmount(rawAmount, "Valor líquido da NFS-e");
    warnings.push(
      "Só o valor líquido (depois de retenção) foi encontrado — o valor bruto do serviço não veio no XML neste layout. A retenção não pôde ser calculada separadamente.",
    );
  }

  const tomador = findSubtree(tree, TOMADOR_KEYS);
  const clientTaxIdRaw = findValue(tomador ?? tree, CLIENT_TAX_ID_KEYS);
  const clientName = findValue(tomador ?? tree, CLIENT_NAME_KEYS);

  if (!tomador) {
    warnings.push(
      "Não foi possível localizar a seção do tomador (cliente) no XML — nome e CNPJ/CPF, se preenchidos, vieram de uma busca sem escopo e podem estar errados.",
    );
  }
  if (!clientName) {
    warnings.push("Nome do cliente (tomador) não encontrado no XML.");
  }
  if (!clientTaxIdRaw) {
    warnings.push(
      "CNPJ/CPF do cliente não encontrado no XML — a conciliação do recebimento vai depender só de valor e data, menos confiável.",
    );
  }

  const clientTaxId = clientTaxIdRaw ? onlyDigits(clientTaxIdRaw) : undefined;
  if (clientTaxId && clientTaxId.length !== 11 && clientTaxId.length !== 14) {
    warnings.push(`CNPJ/CPF do cliente veio com formato inesperado: "${clientTaxIdRaw}".`);
  }

  return {
    number: number.trim(),
    series: findValue(tree, SERIES_KEYS)?.trim(),
    verificationCode: findValue(tree, VERIFICATION_KEYS)?.trim(),
    issuedOn,
    amount,
    withheldAmount,
    clientName: clientName?.trim() ?? "Cliente não identificado",
    clientTaxId,
    warnings,
  };
}
