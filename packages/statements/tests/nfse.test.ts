import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fromDb } from "@aec/domain";
import { describe, expect, it } from "vitest";

import { decodeInvoiceXml, parseNfse } from "../src/universal/nfse";
import { ImportError } from "../src/universal/types";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

/** Atalho pros testes de nota unica: pega a (unica) nota do resultado. */
function parseOne(xml: string) {
  const result = parseNfse(xml);
  expect(result.errors).toEqual([]);
  expect(result.invoices).toHaveLength(1);
  return result.invoices[0]!;
}

describe("parseNfse — ABRASF v2", () => {
  it("le numero, data, valor e cliente do layout ABRASF v2", () => {
    const invoice = parseOne(readFixture("nfse-abrasf-v2.xml"));

    expect(invoice.number).toBe("1001");
    expect(invoice.verificationCode).toBe("AB12CD34");
    expect(invoice.issuedOn).toBe("2025-04-01");
    expect(invoice.amount).toBe(fromDb("1000.00"));
    expect(invoice.clientName).toBe("Cliente XYZ Ltda");
    expect(invoice.clientTaxId).toBe("22333444000155");
  });

  it("nao confunde o CNPJ do prestador com o do tomador (busca escopada)", () => {
    const invoice = parseOne(readFixture("nfse-abrasf-v2.xml"));
    // O prestador (11222333000181) nao pode vazar para clientTaxId.
    expect(invoice.clientTaxId).not.toBe("11222333000181");
  });

  it("soma as retencoes declaradas no XML, mesmo fora de ValoresNfse", () => {
    const invoice = parseOne(readFixture("nfse-abrasf-v2.xml"));
    // ValorIr (15) + ValorCsll (10) + ValorInss (40) = 65.00
    expect(invoice.withheldAmount).toBe(fromDb("65.00"));
  });

  it("nao gera warning quando todos os campos esperados sao encontrados", () => {
    const invoice = parseOne(readFixture("nfse-abrasf-v2.xml"));
    expect(invoice.warnings).toEqual([]);
  });
});

describe("parseNfse — padrao nacional (DPS)", () => {
  it("le numero, data, valor e cliente do layout nacional novo", () => {
    const invoice = parseOne(readFixture("nfse-padrao-nacional.xml"));

    expect(invoice.number).toBe("2002");
    expect(invoice.verificationCode).toBe("XYZ987");
    expect(invoice.issuedOn).toBe("2025-04-05");
    expect(invoice.amount).toBe(fromDb("800.00"));
    expect(invoice.clientName).toBe("Cliente ABC ME");
    expect(invoice.clientTaxId).toBe("55666777000188");
  });

  it("soma as retencoes do padrao nacional (vRetIRRF + vRetCSLL)", () => {
    const invoice = parseOne(readFixture("nfse-padrao-nacional.xml"));
    expect(invoice.withheldAmount).toBe(fromDb("20.00"));
  });
});

// Fixture anonimizada a partir de um XML real (Salvador/BA — a prefeitura
// exporta a "consulta de NFS-e por periodo" como UM arquivo com dezenas de
// notas dentro de ListaNfse/CompNfse). Nomes, CNPJ/CPF, codigos de
// verificacao e enderecos sao todos inventados; a estrutura, ordem de tags
// e formato de valores reproduzem o arquivo real.
describe("parseNfse — lote real (Salvador/BA, varias notas por arquivo)", () => {
  it("le as 3 notas do lote, cada uma com seus proprios dados", () => {
    const result = parseNfse(readFixture("nfse-lote-salvador.xml"));

    expect(result.errors).toEqual([]);
    expect(result.invoices).toHaveLength(3);
    expect(result.invoices.map((i) => i.number)).toEqual(["9001", "9002", "9003"]);
    expect(result.invoices.map((i) => i.amount)).toEqual([
      fromDb("586.00"),
      fromDb("2527.00"),
      fromDb("648.00"),
    ]);
  });

  it("nao mistura o tomador de uma nota com o de outra", () => {
    const result = parseNfse(readFixture("nfse-lote-salvador.xml"));

    expect(result.invoices[0]!.clientName).toBe("Cliente Um Patrimonial Ltda");
    expect(result.invoices[0]!.clientTaxId).toBe("64060087000175");
    expect(result.invoices[1]!.clientName).toBe("Fulano de Tal Gestão Ltda");
    expect(result.invoices[1]!.clientTaxId).toBe("06922341449"); // CPF, nao CNPJ
    expect(result.invoices[2]!.clientName).toBe("GP Participacoes Ltda");
    expect(result.invoices[2]!.clientTaxId).toBe("07651123000131");
  });

  it("nao vaza o CNPJ do prestador (igual nas 3 notas) para nenhum tomador", () => {
    const result = parseNfse(readFixture("nfse-lote-salvador.xml"));
    for (const invoice of result.invoices) {
      expect(invoice.clientTaxId).not.toBe("05434767000142");
    }
  });

  it("um XML de nota unica continua virando uma lista de 1 (nao quebra o caso comum)", () => {
    const result = parseNfse(readFixture("nfse-abrasf-v2.xml"));
    expect(result.invoices).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });
});

describe("decodeInvoiceXml", () => {
  it("respeita o encoding=ISO-8859-1 do prolog — acento nao vira mojibake", () => {
    const xml = `<?xml version='1.0' encoding='ISO-8859-1'?><Nfse><RazaoSocial>Antônio Magalhães</RazaoSocial></Nfse>`;
    // Codifica manualmente como Latin-1 (1 byte por caractere, sem UTF-8
    // multi-byte) — exatamente o que o arquivo real da prefeitura traz.
    const latin1Bytes = Uint8Array.from(xml, (ch) => ch.charCodeAt(0));
    const decoded = decodeInvoiceXml(latin1Bytes.buffer as ArrayBuffer);
    expect(decoded).toContain("Antônio Magalhães");
  });

  it("usa UTF-8 quando o prolog nao declara encoding (o caso comum)", () => {
    const xml = `<Nfse><RazaoSocial>Gestão Ltda</RazaoSocial></Nfse>`;
    const bytes = new TextEncoder().encode(xml);
    expect(decodeInvoiceXml(bytes.buffer as ArrayBuffer)).toBe(xml);
  });
});

describe("parseNfse — tolerancia e casos de borda", () => {
  it("aceita data em formato DD/MM/AAAA (municipios mais antigos)", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>05/04/2025</DataEmissao><ValorServicos>100.00</ValorServicos></Nfse>`;
    const invoice = parseOne(xml);
    expect(invoice.issuedOn).toBe("2025-04-05");
  });

  it("cai para ValorLiquidoNfse quando ValorServicos nao existe, com warning", () => {
    const xml = `<Nfse><Numero>11</Numero><DataEmissao>2025-04-01</DataEmissao><ValorLiquidoNfse>500.00</ValorLiquidoNfse></Nfse>`;
    const invoice = parseOne(xml);
    expect(invoice.amount).toBe(fromDb("500.00"));
    expect(invoice.withheldAmount).toBe(0);
    expect(invoice.warnings.some((w) => w.includes("valor líquido"))).toBe(true);
  });

  it("recusa XML sem numero — vira um erro no resultado, nao uma excecao", () => {
    const xml = `<Nfse><DataEmissao>2025-04-01</DataEmissao><ValorServicos>100.00</ValorServicos></Nfse>`;
    const result = parseNfse(xml);
    expect(result.invoices).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Número da nota não encontrado");
  });

  it("recusa XML sem data de emissao", () => {
    const xml = `<Nfse><Numero>10</Numero><ValorServicos>100.00</ValorServicos></Nfse>`;
    const result = parseNfse(xml);
    expect(result.invoices).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("recusa XML sem valor nenhum", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>2025-04-01</DataEmissao></Nfse>`;
    const result = parseNfse(xml);
    expect(result.invoices).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("recusa um XML malformado (erro de sintaxe continua lancando excecao)", () => {
    // fast-xml-parser e tolerante a tag de fechamento com nome errado (isso
    // vira "numero nao encontrado" em result.errors, nao uma excecao) — o
    // que realmente nao da pra parsear e uma tag NUNCA fechada.
    expect(() => parseNfse("<Nfse><Numero>10</Numero")).toThrow(ImportError);
  });

  it("avisa quando nao acha a secao do tomador", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>2025-04-01</DataEmissao><ValorServicos>100.00</ValorServicos></Nfse>`;
    const invoice = parseOne(xml);
    expect(invoice.warnings.some((w) => w.includes("tomador"))).toBe(true);
    expect(invoice.clientTaxId).toBeUndefined();
  });

  it("avisa quando o CNPJ/CPF do cliente veio com formato inesperado", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>2025-04-01</DataEmissao><ValorServicos>100.00</ValorServicos><Tomador><Cnpj>123</Cnpj><RazaoSocial>X</RazaoSocial></Tomador></Nfse>`;
    const invoice = parseOne(xml);
    expect(invoice.warnings.some((w) => w.includes("formato inesperado"))).toBe(true);
  });

  it("aceita CPF (11 digitos) alem de CNPJ (14 digitos)", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>2025-04-01</DataEmissao><ValorServicos>100.00</ValorServicos><Tomador><Cpf>12345678901</Cpf><RazaoSocial>Pessoa Fisica</RazaoSocial></Tomador></Nfse>`;
    const invoice = parseOne(xml);
    expect(invoice.clientTaxId).toBe("12345678901");
    expect(invoice.warnings).toEqual([]);
  });

  it("tolera valor com virgula decimal", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>2025-04-01</DataEmissao><ValorServicos>1.234,56</ValorServicos></Nfse>`;
    const invoice = parseOne(xml);
    expect(invoice.amount).toBe(fromDb("1234.56"));
  });
});
