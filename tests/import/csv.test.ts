import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type CsvMapping,
  detectDelimiter,
  detectMapping,
  parseCsv,
  parseCsvDate,
  parseStatementCsv,
} from "@/lib/import/csv";
import { ImportError } from "@/lib/import/types";
import { toDb } from "@/lib/domain/money";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
    "utf8",
  );
}

describe("separador", () => {
  it("prefere o separador que da colunas consistentes", () => {
    // Contar ocorrencias erraria: descricao bancaria tem virgula o tempo todo.
    const conteudo = 'Data;Historico;Valor\n05/03/2025;"COMPRA A, B E C";100,00\n';
    expect(detectDelimiter(conteudo)).toBe(";");
  });

  it("reconhece virgula quando e o separador de verdade", () => {
    expect(detectDelimiter("Data,Historico,Valor\n05/03/2025,COMPRA,100.00\n")).toBe(",");
  });

  it("reconhece tabulacao", () => {
    expect(detectDelimiter("Data\tHistorico\tValor\n05/03/2025\tCOMPRA\t100.00\n")).toBe("\t");
  });
});

describe("leitura de linhas e campos", () => {
  it("respeita aspas com o separador dentro", () => {
    const linhas = parseCsv('Data;Historico;Valor\n05/03/2025;"PAGTO A; B";100,00\n');
    expect(linhas[1]).toEqual(["05/03/2025", "PAGTO A; B", "100,00"]);
  });

  it("entende aspas duplicadas dentro do campo", () => {
    const linhas = parseCsv('a;b\n1;"diz ""ola"" aqui"\n');
    expect(linhas[1]).toEqual(["1", 'diz "ola" aqui']);
  });

  it("aceita quebra de linha CRLF e descarta linha vazia", () => {
    const linhas = parseCsv("a;b\r\n1;2\r\n\r\n3;4\r\n");
    expect(linhas).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("remove o BOM que o Excel escreve no inicio do arquivo", () => {
    const linhas = parseCsv("﻿Data;Valor\n05/03/2025;100,00\n");
    expect(linhas[0]![0]).toBe("Data");
  });
});

describe("data do CSV", () => {
  it("le o formato brasileiro", () => {
    expect(parseCsvDate("05/03/2025")).toBe("2025-03-05");
    expect(parseCsvDate("5/3/2025")).toBe("2025-03-05");
    expect(parseCsvDate("05-03-2025")).toBe("2025-03-05");
    expect(parseCsvDate("05.03.2025")).toBe("2025-03-05");
  });

  it("le ISO tambem", () => {
    expect(parseCsvDate("2025-03-05")).toBe("2025-03-05");
  });

  it("le dia e mes nessa ordem, sem adivinhar", () => {
    // Em "05/03/2025" as duas leituras sao validas. Escolher errado deslocaria o
    // mes inteiro sem nada acusar, entao a regra e fixa: dd/mm, formato do pais.
    expect(parseCsvDate("05/03/2025")).toBe("2025-03-05");
    expect(parseCsvDate("12/01/2025")).toBe("2025-01-12");
  });

  it("expande ano de dois digitos", () => {
    expect(parseCsvDate("05/03/25")).toBe("2025-03-05");
    expect(parseCsvDate("05/03/99")).toBe("1999-03-05");
  });

  it("recusa data inexistente em vez de deslocar para o mes seguinte", () => {
    expect(() => parseCsvDate("31/02/2025")).toThrow(ImportError);
    expect(() => parseCsvDate("qualquer coisa")).toThrow(ImportError);
  });
});

describe("proposta automatica de mapeamento", () => {
  const detectado = detectMapping(fixture("extrato-colunas-valor-unico.csv"));

  it("pula as linhas de cabecalho que o banco poe antes da tabela", () => {
    expect(detectado.mapping?.skipRows).toBe(3);
  });

  it("identifica as colunas pelos titulos", () => {
    expect(detectado.mapping).toMatchObject({
      dateColumn: 0,
      descriptionColumn: 1,
      documentColumn: 2,
      amountColumn: 3,
    });
    expect(detectado.problems).toEqual([]);
  });

  it("identifica colunas separadas de debito e credito", () => {
    const outro = detectMapping(fixture("extrato-colunas-debito-credito.csv"));
    expect(outro.mapping).toMatchObject({ debitColumn: 2, creditColumn: 3 });
    expect(outro.mapping?.amountColumn).toBeUndefined();
  });

  it("admite que nao conseguiu, em vez de chutar um mapeamento", () => {
    // Um mapeamento errado importa o extrato todo trocado, e o erro so aparece
    // no fechamento. Melhor pedir a configuracao do que adivinhar.
    const detectado = detectMapping("linha sem nada util\noutra linha\n");
    expect(detectado.mapping).toBeNull();
    expect(detectado.problems.length).toBeGreaterThan(0);
  });
});

describe("extrato com coluna unica de valor", () => {
  const detectado = detectMapping(fixture("extrato-colunas-valor-unico.csv"));
  const extrato = parseStatementCsv(
    fixture("extrato-colunas-valor-unico.csv"),
    detectado.mapping!,
  );

  it("importa os movimentos e descarta a linha de saldo final", () => {
    // O "SALDO FINAL" no rodape nao e movimento; soma-lo dobraria o extrato.
    expect(extrato.lines).toHaveLength(3);
    expect(extrato.lines.map((l) => l.memo)).not.toContain("");
  });

  it("le o valor no formato brasileiro, com sinal", () => {
    expect(extrato.lines.map((l) => toDb(l.amount))).toEqual([
      "2500.00",
      "-1800.00",
      "-99.90",
    ]);
  });

  it("le as datas", () => {
    expect(extrato.lines.map((l) => l.postedAt)).toEqual([
      "2025-03-05",
      "2025-03-10",
      "2025-03-31",
    ]);
    expect(extrato.periodStart).toBe("2025-03-05");
    expect(extrato.periodEnd).toBe("2025-03-31");
  });

  it("captura o numero do documento", () => {
    expect(extrato.lines[0]!.checkNumber).toBe("000123");
    expect(extrato.lines[2]!.checkNumber).toBeUndefined();
  });

  it("gera chave de deduplicacao mesmo sem identificador do banco", () => {
    expect(extrato.lines.every((l) => l.dedupKey.startsWith("c:"))).toBe(true);
    expect(new Set(extrato.lines.map((l) => l.dedupKey)).size).toBe(3);
  });
});

describe("extrato com debito e credito em colunas separadas", () => {
  const detectado = detectMapping(fixture("extrato-colunas-debito-credito.csv"));
  const extrato = parseStatementCsv(
    fixture("extrato-colunas-debito-credito.csv"),
    detectado.mapping!,
  );

  it("aplica o sinal a partir da coluna, e nao do numero", () => {
    // O valor vem sem sinal; e a coluna que diz se entrou ou saiu.
    expect(extrato.lines.map((l) => toDb(l.amount))).toEqual([
      "1500.50",
      "-320.75",
      "-450.00",
    ]);
  });

  it("preserva virgula e aspas dentro do historico", () => {
    expect(extrato.lines[0]!.memo).toBe("PIX RECEBIDO JOAO, MARIA ME");
    expect(extrato.lines[2]!.memo).toBe('PAGTO "FORNECEDOR X" LTDA');
  });

  it("recusa linha com valor em debito e credito ao mesmo tempo", () => {
    const conteudo = "Data,Lancamento,Debito,Credito\n05/03/2025,CONFUSA,100.00,50.00\n";
    const extrato = parseStatementCsv(conteudo, {
      delimiter: ",",
      hasHeader: true,
      dateColumn: 0,
      descriptionColumn: 1,
      debitColumn: 2,
      creditColumn: 3,
    });

    expect(extrato.lines).toHaveLength(0);
    expect(extrato.warnings[0]).toContain("debito e em credito");
  });
});

describe("mapeamento manual", () => {
  const mapping: CsvMapping = {
    delimiter: ";",
    hasHeader: true,
    dateColumn: "Data",
    descriptionColumn: "Historico",
    amountColumn: "Valor",
  };

  it("aceita coluna referenciada pelo titulo", () => {
    const extrato = parseStatementCsv(
      "Data;Historico;Valor\n05/03/2025;COMPRA;-100,00\n",
      mapping,
    );
    expect(toDb(extrato.lines[0]!.amount)).toBe("-100.00");
  });

  it("inverte o sinal quando o banco exporta saida como positivo", () => {
    const extrato = parseStatementCsv(
      "Data;Historico;Valor\n05/03/2025;COMPRA;100,00\n",
      { ...mapping, invertSign: true },
    );
    expect(toDb(extrato.lines[0]!.amount)).toBe("-100.00");
  });
});

describe("arquivo com problema", () => {
  it("ignora a linha quebrada e importa o resto, avisando", () => {
    const conteudo =
      "Data;Historico;Valor\n" +
      "05/03/2025;BOA;100,00\n" +
      "31/02/2025;DATA INEXISTENTE;50,00\n" +
      "10/03/2025;OUTRA BOA;-25,00\n";

    const extrato = parseStatementCsv(conteudo, {
      delimiter: ";",
      hasHeader: true,
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
    });

    expect(extrato.lines).toHaveLength(2);
    expect(extrato.warnings).toHaveLength(1);
    expect(extrato.warnings[0]).toContain("Linha 3");
  });

  it("recusa arquivo sem nenhuma linha de movimento", () => {
    expect(() =>
      parseStatementCsv("Data;Historico;Valor\n", {
        delimiter: ";",
        hasHeader: true,
        dateColumn: 0,
        descriptionColumn: 1,
        amountColumn: 2,
      }),
    ).toThrow(ImportError);
  });

  it("avisa sobre movimentos identicos, limitacao propria do CSV", () => {
    // Sem identificador do banco nao da para distinguir dois movimentos
    // identicos numa reimportacao. O aviso e honesto sobre isso, em vez de
    // fingir que o CSV e tao confiavel quanto o OFX.
    const conteudo =
      "Data;Historico;Valor\n05/03/2025;PEDAGIO;-50,00\n05/03/2025;PEDAGIO;-50,00\n";

    const extrato = parseStatementCsv(conteudo, {
      delimiter: ";",
      hasHeader: true,
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
    });

    expect(extrato.lines).toHaveLength(2);
    expect(extrato.lines[0]!.dedupKey).not.toBe(extrato.lines[1]!.dedupKey);
    expect(extrato.warnings.join(" ")).toContain("Prefira o OFX");
  });
});
