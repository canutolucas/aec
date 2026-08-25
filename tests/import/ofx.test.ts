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

/**
 * Casos aprendidos com um OFX real do Cora.
 *
 * A fixture e anonimizada (gerada por tests/local/gerar-fixture-ofx.test.ts) mas
 * preserva o que caracteriza o arquivo do banco: cabecalho SGML com tags de
 * fechamento no estilo XML, ENCODING:UTF-8 sem CHARSET, DTSERVER anterior ao
 * DTEND, FITID em UUID e memo no formato "tipo - nome - documento".
 */
describe("OFX real do Cora", () => {
  const extrato = parseOfx(fixture("extrato-cora.ofx"));

  it("le o dialeto hibrido: cabecalho SGML com tags fechadas", () => {
    // O arquivo declara DATA:OFXSGML e VERSION:102, mas fecha todas as tags como
    // XML. Nem o caminho puramente SGML nem o puramente XML dariam conta sozinhos.
    expect(extrato.lines).toHaveLength(43);
    expect(extrato.bankId).toBe("0403");
    expect(extrato.accountId).toBe("12345678");
  });

  it("respeita ENCODING:UTF-8 declarado sem CHARSET", () => {
    const comAcento = extrato.lines.filter((linha) => /[áéíóúâêôãõç]/i.test(linha.memo));
    expect(comAcento.length).toBeGreaterThan(0);
  });

  it("preserva & cru no memo, que e valido em SGML", () => {
    // Em XML, um & solto seria erro. Em SGML nao e, e o banco escreve assim.
    expect(extrato.lines.some((linha) => linha.memo.includes(" & "))).toBe(true);
  });

  it("usa o FITID como chave de deduplicacao, sem colisao", () => {
    expect(extrato.lines.every((linha) => linha.dedupKey.startsWith("fitid:"))).toBe(true);
    expect(new Set(extrato.lines.map((l) => l.dedupKey)).size).toBe(43);
  });

  it("nao desloca a data por causa do fuso declarado", () => {
    // As datas vem como 20260801000000[0:GMT]. Meia-noite GMT e 21h do dia
    // ANTERIOR no Brasil: tratar como instante jogaria todo lancamento um dia
    // para tras e o mes fecharia errado.
    expect(extrato.lines.map((l) => l.postedAt).every((d) => d >= "2026-08-01" && d <= "2026-08-31")).toBe(true);
    expect(extrato.lines.some((linha) => linha.postedAt === "2026-08-01")).toBe(true);
  });
});

describe("periodo que o OFX de fato atesta", () => {
  const extrato = parseOfx(fixture("extrato-cora.ofx"));

  it("corta o periodo na data de geracao, e nao no DTEND declarado", () => {
    // O arquivo declara DTEND em 31/08 e LEDGERBAL com DTASOF em 31/08, mas foi
    // gerado em 25/08 — nao pode conter o que ainda nao aconteceu. Gravar 31/08
    // faria o sistema tratar agosto como coberto, e os dias 26 a 31 nunca seriam
    // cobrados de ninguem.
    expect(extrato.periodStart).toBe("2026-08-01");
    expect(extrato.periodEnd).toBe("2026-08-25");
    expect(extrato.ledgerBalanceDate).toBe("2026-08-25");
  });

  it("avisa que o periodo declarado nao foi coberto", () => {
    expect(extrato.warnings.join(" ")).toMatch(/diz cobrir at[eé] 31\/08\/2026/);
    expect(extrato.warnings.join(" ")).toMatch(/pe[cç]a o extrato do restante/);
  });

  it("corta pela data de geracao, e nao pelo ultimo lancamento", () => {
    // A diferenca importa: nao haver movimento entre o dia 21 e o 25 e
    // informacao legitima do extrato, nao lacuna. Cortar no ultimo lancamento
    // encolheria o periodo coberto sem motivo.
    const ultimo = extrato.lines[extrato.lines.length - 1]!.postedAt;
    expect(extrato.periodEnd).toBe("2026-08-25");
    expect(extrato.periodEnd! >= ultimo).toBe(true);
  });

  it("mantem o DTEND quando o arquivo foi gerado depois do fim do periodo", () => {
    const completo = fixture("extrato-cora.ofx").replace(
      "<DTSERVER>20260825172645[0:GMT]</DTSERVER>",
      "<DTSERVER>20260901090000[0:GMT]</DTSERVER>",
    );
    const extrato = parseOfx(completo);

    expect(extrato.periodEnd).toBe("2026-08-31");
    expect(extrato.warnings.join(" ")).not.toMatch(/diz cobrir at[eé]/);
  });
});

describe("contraparte a partir do memo", () => {
  const extrato = parseOfx(fixture("extrato-cora.ofx"));

  it("extrai o CNPJ ou CPF que o banco escreveu no historico", () => {
    // Documento no memo e inequivoco em qualquer banco, entao vale procurar
    // sempre. E a chave mais confiavel de contraparte: nao muda, nao abrevia e
    // nao vem truncada como o nome no PDF.
    expect(extrato.lines.every((linha) => linha.counterpartyDocument !== undefined)).toBe(true);
    expect(
      extrato.lines.every((linha) => /^\d{11}$|^\d{14}$/.test(linha.counterpartyDocument!)),
    ).toBe(true);
  });

  it("distingue CPF de CNPJ", () => {
    const tamanhos = new Set(extrato.lines.map((l) => l.counterpartyDocument!.length));
    expect(tamanhos.has(14)).toBe(true);
    expect(tamanhos.has(11)).toBe(true);
  });

  it("nao inventa documento quando o memo nao tem", () => {
    const semDocumento = parseOfx(
      "<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20250305<TRNAMT>-100.00<FITID>X1" +
        "<MEMO>TARIFA MENSAL</STMTTRN></BANKTRANLIST></OFX>",
    );
    expect(semDocumento.lines[0]!.counterpartyDocument).toBeUndefined();
  });

  it("nao extrai o nome, que cada banco formata do seu jeito", () => {
    // Recortar nome por posicao acertaria no Cora e erraria nos outros. O
    // documento e generico; o nome nao e.
    expect(extrato.lines.every((linha) => linha.counterpartyName === undefined)).toBe(true);
  });
});

describe("o que o OFX consegue e o que nao consegue provar", () => {
  const extrato = parseOfx(fixture("extrato-cora.ofx"));

  it("declara o saldo final, mas nao o inicial", () => {
    // Sem saldo de partida, o arquivo nao prova sozinho que nenhuma transacao se
    // perdeu — ele so afirma um total. E menos do que o PDF permite conferir.
    expect(extrato.ledgerBalance).toBeDefined();
    expect(extrato.integrity!.dailyChecks).toEqual([]);
  });

  it("registra o saldo inicial implicado, para a aplicacao confrontar", () => {
    // saldo final menos o movimento lido = saldo que a conta tinha na vespera.
    // A aplicacao compara com o saldo que ela ja tem; batendo, o extrato esta
    // integro. E a conferencia do PDF, fechada do lado de fora.
    const integridade = extrato.integrity!;
    const movimento = integridade.computedInflow - integridade.computedOutflow;

    expect(integridade.declaredOpening).toBe(integridade.declaredClosing! - movimento);
    expect(toDb(integridade.declaredOpening!)).toBe("2780.45");
  });
});
