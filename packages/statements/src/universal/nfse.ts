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
 * IMPORTANTE: os sinônimos abaixo foram verificados contra a documentação
 * pública do ABRASF e do padrão nacional (gov.br/nfse), não contra um XML
 * real emitido por uma prefeitura específica — municípios frequentemente têm
 * pequenas variações (maiúsculas/minúsculas, campos extras, um schema quase
 * mas não exatamente igual ao documentado). Um XML real de teste é o que
 * confirma se a lista de sinônimos cobre o caso de uso real; até lá, isto é
 * a melhor aproximação possível sem esse arquivo.
 */

import { type Cents, fromDb, isIsoDate,type IsoDate } from "@aec/domain";
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

export function parseNfse(xml: string): CanonicalInvoice {
  let tree: XmlNode;
  try {
    tree = parser.parse(xml) as XmlNode;
  } catch (error) {
    throw new ImportError(
      `Não foi possível ler este XML: ${error instanceof Error ? error.message : "erro desconhecido"}`,
    );
  }

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
