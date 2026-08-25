import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeOfx, parseOfx, parseOfxAmount, parseOfxDate } from "@/lib/import/ofx";
import { ImportError } from "@/lib/import/types";
import { toDb } from "@/lib/domain/money";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
    "utf8",
  );
}

describe("data do OFX", () => {
  it("le o formato curto", () => {
    expect(parseOfxDate("20250305")).toBe("2025-03-05");
  });

  it("usa a data local do banco e nao converte o fuso", () => {
    // O bug que este teste tranca: interpretar "20250301000000[-3:BRT]" como
    // instante e formatar depois levaria o lancamento do dia 1o para o dia 28
    // do mes anterior, e o mes fecharia errado.
    expect(parseOfxDate("20250301000000[-3:BRT]")).toBe("2025-03-01");
    expect(parseOfxDate("20250301120000[-3:BRT]")).toBe("2025-03-01");
    expect(parseOfxDate("20250101000000[-3:BRT]")).toBe("2025-01-01");
  });

  it("recusa data invalida em vez de inventar uma", () => {
    expect(() => parseOfxDate("2025-03-05")).toThrow(ImportError);
    expect(() => parseOfxDate("20250230")).toThrow(ImportError);
    expect(() => parseOfxDate("")).toThrow(ImportError);
  });
});

describe("valor do OFX", () => {
  it("le o formato da especificacao, com ponto decimal", () => {
    expect(toDb(parseOfxAmount("2500.00"))).toBe("2500.00");
    expect(toDb(parseOfxAmount("-1800.00"))).toBe("-1800.00");
    expect(toDb(parseOfxAmount("+99.90"))).toBe("99.90");
  });

  it("aceita virgula decimal, que alguns exportadores brasileiros emitem", () => {
    expect(toDb(parseOfxAmount("2500,00"))).toBe("2500.00");
    expect(toDb(parseOfxAmount("-1.800,50"))).toBe("-1800.50");
  });

  it("resolve os dois separadores pelo ultimo", () => {
    expect(toDb(parseOfxAmount("1,800.50"))).toBe("1800.50");
    expect(toDb(parseOfxAmount("1.800,50"))).toBe("1800.50");
  });

  it("recusa lixo em vez de devolver zero silencioso", () => {
    for (const value of ["", "abc", "R$", "1.2.3,4,5"]) {
      expect(() => parseOfxAmount(value), value).toThrow(ImportError);
    }
  });
});

describe("OFX 1.x em SGML (o que os bancos brasileiros exportam)", () => {
  const extrato = parseOfx(fixture("extrato-ofx1-sgml.ofx"));

  it("le as tags de folha sem fechamento", () => {
    expect(extrato.lines).toHaveLength(3);
  });

  it("identifica banco, conta e periodo", () => {
    expect(extrato.bankId).toBe("341");
    expect(extrato.accountId).toBe("56789-0");
    expect(extrato.periodStart).toBe("2025-03-01");
    expect(extrato.periodEnd).toBe("2025-03-31");
  });

  it("captura o saldo que o banco declara", () => {
    // Sem isso a conciliacao so compara linha a linha e nunca afirma que o
    // total esta certo.
    expect(toDb(extrato.ledgerBalance!)).toBe("10600.10");
    expect(extrato.ledgerBalanceDate).toBe("2025-03-31");
  });

  it("le valores com sinal correto", () => {
    expect(extrato.lines.map((l) => toDb(l.amount))).toEqual([
      "2500.00",
      "-1800.00",
      "-99.90",
    ]);
  });

  it("junta NAME e MEMO, que os bancos preenchem de forma inconsistente", () => {
    expect(extrato.lines[0]!.memo).toBe("TED RECEBIDA - CLIENTE ALFA COMERCIO LTDA");
    expect(extrato.lines[2]!.memo).toBe("TARIFA MANUTENCAO CONTA");
  });

  it("usa o FITID do banco como chave de deduplicacao", () => {
    expect(extrato.lines[0]!.fitid).toBe("2025030500001");
    expect(extrato.lines[0]!.dedupKey).toBe("fitid:2025030500001");
  });

  it("nao acusa problema em arquivo bem formado", () => {
    expect(extrato.warnings).toEqual([]);
  });

  it("reimportar o mesmo arquivo produz exatamente as mesmas chaves", () => {
    // A propriedade que garante que reimportar nunca duplica movimento.
    const denovo = parseOfx(fixture("extrato-ofx1-sgml.ofx"));
    expect(denovo.lines.map((l) => l.dedupKey)).toEqual(extrato.lines.map((l) => l.dedupKey));
  });
});

describe("OFX 2.x em XML", () => {
  const extrato = parseOfx(fixture("extrato-ofx2-xml.ofx"));

  it("le o mesmo conteudo com o mesmo codigo", () => {
    expect(extrato.lines).toHaveLength(2);
    expect(extrato.bankId).toBe("237");
    expect(extrato.accountId).toBe("0001234567");
  });

  it("nao se confunde com as tags de fechamento das folhas", () => {
    // Em XML, `</TRNAMT>` fecha uma folha. Tratar isso como fechamento de
    // container encerraria o <STMTTRN> cedo demais e perderia campos.
    expect(extrato.lines[1]).toMatchObject({
      postedAt: "2025-04-15",
      fitid: "ABC-002",
      checkNumber: "000123",
    });
    expect(toDb(extrato.lines[1]!.amount)).toBe("-320.75");
  });

  it("decodifica entidades XML no memo", () => {
    expect(extrato.lines[0]!.memo).toBe("PIX RECEBIDO JOAO & MARIA ME");
  });

  it("le o saldo declarado", () => {
    expect(toDb(extrato.ledgerBalance!)).toBe("1179.75");
  });
});

describe("codificacao de caracteres", () => {
  it("le acento de arquivo CHARSET:1252 sem corromper o memo", () => {
    // Ler um arquivo 1252 como UTF-8 transforma "JOSE" com acento em lixo, e o
    // memo e justamente o que alimenta as regras de categorizacao.
    const cabecalho = "OFXHEADER:100\nVERSION:102\nCHARSET:1252\n\n";
    const corpo =
      "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN>" +
      "<DTPOSTED>20250305<TRNAMT>-100.00<FITID>X1<MEMO>PAGAMENTO JOSÉ MÁRCIO" +
      "</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>";

    // Monta os bytes em windows-1252: cada caractere vira um byte so.
    const texto = cabecalho + corpo;
    const bytes = Uint8Array.from([...texto].map((char) => char.charCodeAt(0)));

    expect(decodeOfx(bytes)).toContain("JOSÉ MÁRCIO");
    expect(parseOfx(bytes).lines[0]!.memo).toBe("PAGAMENTO JOSÉ MÁRCIO");
  });

  it("le arquivo UTF-8 declarado no XML", () => {
    const texto =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      "<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20250305</DTPOSTED>" +
      "<TRNAMT>-100.00</TRNAMT><FITID>X1</FITID><MEMO>PAGAMENTO JOSÉ</MEMO>" +
      "</STMTTRN></BANKTRANLIST></OFX>";
    const bytes = new TextEncoder().encode(texto);

    expect(parseOfx(bytes).lines[0]!.memo).toBe("PAGAMENTO JOSÉ");
  });
});

describe("arquivo com problema", () => {
  it("recusa arquivo que nao e OFX, com mensagem acionavel", () => {
    expect(() => parseOfx("isto nao e um extrato")).toThrow(ImportError);
    expect(() => parseOfx("isto nao e um extrato")).toThrow(/download do banco/);
  });

  it("ignora a transacao quebrada e importa o resto, avisando", () => {
    // Perder o extrato inteiro por causa de uma linha defeituosa seria pior do
    // que importar o que da e apontar o que ficou de fora.
    const conteudo =
      "<OFX><BANKTRANLIST>" +
      "<STMTTRN><DTPOSTED>20250305<TRNAMT>100.00<FITID>OK1<MEMO>BOA</STMTTRN>" +
      "<STMTTRN><DTPOSTED>20250306<TRNAMT>xxx<FITID>RUIM<MEMO>QUEBRADA</STMTTRN>" +
      "<STMTTRN><TRNAMT>50.00<FITID>SEMDATA<MEMO>SEM DATA</STMTTRN>" +
      "</BANKTRANLIST></OFX>";

    const extrato = parseOfx(conteudo);

    expect(extrato.lines).toHaveLength(1);
    expect(extrato.lines[0]!.fitid).toBe("OK1");
    expect(extrato.warnings).toHaveLength(2);
    expect(extrato.warnings[0]).toContain("ignorada");
  });

  it("avisa quando o banco nao mandou FITID", () => {
    const conteudo =
      "<OFX><BANKTRANLIST>" +
      "<STMTTRN><DTPOSTED>20250305<TRNAMT>100.00<MEMO>SEM FITID</STMTTRN>" +
      "</BANKTRANLIST></OFX>";

    const extrato = parseOfx(conteudo);
    expect(extrato.warnings.join(" ")).toContain("sem FITID");
    expect(extrato.lines[0]!.dedupKey).toMatch(/^c:2025-03-05/);
  });

  it("aceita extrato sem nenhuma transacao no periodo", () => {
    const extrato = parseOfx("<OFX><BANKTRANLIST><DTSTART>20250301<DTEND>20250331</BANKTRANLIST></OFX>");
    expect(extrato.lines).toEqual([]);
    expect(extrato.periodStart).toBe("2025-03-01");
  });
});

describe("deduplicacao sem FITID", () => {
  it("preserva duas transacoes identicas no mesmo dia", () => {
    // Duas parcelas iguais do mesmo fornecedor no mesmo dia acontecem. Descartar
    // a segunda como duplicata faria o extrato fechar com diferenca — exatamente
    // o problema que a importacao existe para resolver.
    const conteudo =
      "<OFX><BANKTRANLIST>" +
      "<STMTTRN><DTPOSTED>20250305<TRNAMT>-50.00<MEMO>PEDAGIO</STMTTRN>" +
      "<STMTTRN><DTPOSTED>20250305<TRNAMT>-50.00<MEMO>PEDAGIO</STMTTRN>" +
      "</BANKTRANLIST></OFX>";

    const extrato = parseOfx(conteudo);

    expect(extrato.lines).toHaveLength(2);
    expect(extrato.lines[0]!.dedupKey).not.toBe(extrato.lines[1]!.dedupKey);
  });
});
