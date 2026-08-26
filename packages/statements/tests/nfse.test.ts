import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fromDb } from "@aec/domain";
import { describe, expect, it } from "vitest";

import { parseNfse } from "../src/universal/nfse";
import { ImportError } from "../src/universal/types";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

describe("parseNfse — ABRASF v2", () => {
  it("le numero, data, valor e cliente do layout ABRASF v2", () => {
    const invoice = parseNfse(readFixture("nfse-abrasf-v2.xml"));

    expect(invoice.number).toBe("1001");
    expect(invoice.verificationCode).toBe("AB12CD34");
    expect(invoice.issuedOn).toBe("2025-04-01");
    expect(invoice.amount).toBe(fromDb("1000.00"));
    expect(invoice.clientName).toBe("Cliente XYZ Ltda");
    expect(invoice.clientTaxId).toBe("22333444000155");
  });

  it("nao confunde o CNPJ do prestador com o do tomador (busca escopada)", () => {
    const invoice = parseNfse(readFixture("nfse-abrasf-v2.xml"));
    // O prestador (11222333000181) nao pode vazar para clientTaxId.
    expect(invoice.clientTaxId).not.toBe("11222333000181");
  });

  it("soma as retencoes declaradas no XML, mesmo fora de ValoresNfse", () => {
    const invoice = parseNfse(readFixture("nfse-abrasf-v2.xml"));
    // ValorIr (15) + ValorCsll (10) + ValorInss (40) = 65.00
    expect(invoice.withheldAmount).toBe(fromDb("65.00"));
  });

  it("nao gera warning quando todos os campos esperados sao encontrados", () => {
    const invoice = parseNfse(readFixture("nfse-abrasf-v2.xml"));
    expect(invoice.warnings).toEqual([]);
  });
});

describe("parseNfse — padrao nacional (DPS)", () => {
  it("le numero, data, valor e cliente do layout nacional novo", () => {
    const invoice = parseNfse(readFixture("nfse-padrao-nacional.xml"));

    expect(invoice.number).toBe("2002");
    expect(invoice.verificationCode).toBe("XYZ987");
    expect(invoice.issuedOn).toBe("2025-04-05");
    expect(invoice.amount).toBe(fromDb("800.00"));
    expect(invoice.clientName).toBe("Cliente ABC ME");
    expect(invoice.clientTaxId).toBe("55666777000188");
  });

  it("soma as retencoes do padrao nacional (vRetIRRF + vRetCSLL)", () => {
    const invoice = parseNfse(readFixture("nfse-padrao-nacional.xml"));
    expect(invoice.withheldAmount).toBe(fromDb("20.00"));
  });
});

describe("parseNfse — tolerancia e casos de borda", () => {
  it("aceita data em formato DD/MM/AAAA (municipios mais antigos)", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>05/04/2025</DataEmissao><ValorServicos>100.00</ValorServicos></Nfse>`;
    const invoice = parseNfse(xml);
    expect(invoice.issuedOn).toBe("2025-04-05");
  });

  it("cai para ValorLiquidoNfse quando ValorServicos nao existe, com warning", () => {
    const xml = `<Nfse><Numero>11</Numero><DataEmissao>2025-04-01</DataEmissao><ValorLiquidoNfse>500.00</ValorLiquidoNfse></Nfse>`;
    const invoice = parseNfse(xml);
    expect(invoice.amount).toBe(fromDb("500.00"));
    expect(invoice.withheldAmount).toBe(0);
    expect(invoice.warnings.some((w) => w.includes("valor líquido"))).toBe(true);
  });

  it("recusa XML sem numero", () => {
    const xml = `<Nfse><DataEmissao>2025-04-01</DataEmissao><ValorServicos>100.00</ValorServicos></Nfse>`;
    expect(() => parseNfse(xml)).toThrow(ImportError);
  });

  it("recusa XML sem data de emissao", () => {
    const xml = `<Nfse><Numero>10</Numero><ValorServicos>100.00</ValorServicos></Nfse>`;
    expect(() => parseNfse(xml)).toThrow(ImportError);
  });

  it("recusa XML sem valor nenhum", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>2025-04-01</DataEmissao></Nfse>`;
    expect(() => parseNfse(xml)).toThrow(ImportError);
  });

  it("recusa um XML malformado", () => {
    expect(() => parseNfse("<Nfse><Numero>10</Nfse>")).toThrow(ImportError);
  });

  it("avisa quando nao acha a secao do tomador", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>2025-04-01</DataEmissao><ValorServicos>100.00</ValorServicos></Nfse>`;
    const invoice = parseNfse(xml);
    expect(invoice.warnings.some((w) => w.includes("tomador"))).toBe(true);
    expect(invoice.clientTaxId).toBeUndefined();
  });

  it("avisa quando o CNPJ/CPF do cliente veio com formato inesperado", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>2025-04-01</DataEmissao><ValorServicos>100.00</ValorServicos><Tomador><Cnpj>123</Cnpj><RazaoSocial>X</RazaoSocial></Tomador></Nfse>`;
    const invoice = parseNfse(xml);
    expect(invoice.warnings.some((w) => w.includes("formato inesperado"))).toBe(true);
  });

  it("aceita CPF (11 digitos) alem de CNPJ (14 digitos)", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>2025-04-01</DataEmissao><ValorServicos>100.00</ValorServicos><Tomador><Cpf>12345678901</Cpf><RazaoSocial>Pessoa Fisica</RazaoSocial></Tomador></Nfse>`;
    const invoice = parseNfse(xml);
    expect(invoice.clientTaxId).toBe("12345678901");
    expect(invoice.warnings).toEqual([]);
  });

  it("tolera valor com virgula decimal", () => {
    const xml = `<Nfse><Numero>10</Numero><DataEmissao>2025-04-01</DataEmissao><ValorServicos>1.234,56</ValorServicos></Nfse>`;
    const invoice = parseNfse(xml);
    expect(invoice.amount).toBe(fromDb("1234.56"));
  });
});
