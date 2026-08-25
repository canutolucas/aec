/**
 * Gera a fixture anonimizada a partir do extrato real.
 *
 * Preserva a geometria exata — coordenadas, recuos, quebra de colunas, nomes
 * truncados, ordem invertida, paginacao — e troca TODO o conteudo sensivel:
 * nome da empresa, CNPJ, numero da conta, contrapartes, documentos e valores.
 *
 * Os valores novos sao fabricados e os saldos diarios e totais sao recalculados
 * a partir deles, para que a fixture continue internamente consistente e as
 * conferencias de integridade tenham o que verificar.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extrairLinhas, type LinhaPdf } from "@/lib/import/pdf";

const origem = fileURLToPath(new URL("./extrato-cora.pdf", import.meta.url));
const destino = fileURLToPath(new URL("../fixtures/extrato-cora-linhas.json", import.meta.url));

const NOMES = [
  "Padaria Aurora Ltda", "Marcenaria Ponte Nova", "Clinica Sao Rafael Ltda",
  "Transportes Vale Verde", "Grafica Horizonte Ltda", "Mercado Bom Jardim",
  "Oficina Roda Livre Ltda", "Escola Girassol S/S", "Farmacia Bela Flor",
  "Construtora Pedra Alta", "Hotel Mirante Azul", "Lavanderia Agua Clara",
  "Restaurante Forno Antigo", "Papelaria Estrela Ltda", "Academia Passo Firme",
  "Joana Ribeiro Amaral", "Paulo Serra Machado", "Helena Duarte Pinto",
];

const DOCS_CNPJ = [
  "11.222.333/0001-81", "22.333.444/0001-72", "33.444.555/0001-63",
  "44.555.666/0001-54", "55.666.777/0001-45", "66.777.888/0001-36",
  "77.888.999/0001-27", "88.999.111/0001-18", "99.111.222/0001-09",
  "10.203.040/0001-90", "20.304.050/0001-81", "30.405.060/0001-72",
];
const DOCS_CPF = ["123.456.789-09", "234.567.890-12", "345.678.901-23"];

/** Pseudoaleatorio deterministico: a fixture tem de sair igual toda vez. */
function semente(texto: string): number {
  let hash = 2166136261;
  for (const char of texto) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
const DOCUMENTO = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/;
const VALOR_ASSINADO = /([+-])\s*R\$\s*([\d.]+,\d{2})/;

function formatarReais(centavos: number): string {
  const inteiro = Math.trunc(Math.abs(centavos) / 100);
  const resto = String(Math.abs(centavos) % 100).padStart(2, "0");
  return `${inteiro.toLocaleString("pt-BR")},${resto}`;
}

describe.skipIf(!existsSync(origem))("geracao da fixture anonimizada", () => {
  it("gera tests/fixtures/extrato-cora-linhas.json sem nenhum dado real", async () => {
    const linhas = await extrairLinhas(new Uint8Array(readFileSync(origem)));

    // Primeira passada: fabrica um valor novo para cada transacao, na ordem em
    // que aparecem, e acumula o movimento por dia.
    const novoValor = new Map<number, number>();
    const movimentoDoDia = new Map<string, number>();
    let diaCorrente: string | null = null;

    linhas.forEach((linha, indice) => {
      const cabecalho = linha.recuo < 45 && /Saldo do dia/i.test(linha.texto);
      if (cabecalho) {
        diaCorrente = DATA.exec(linha.texto)?.[0] ?? null;
        if (diaCorrente) movimentoDoDia.set(diaCorrente, 0);
        return;
      }

      const valor = VALOR_ASSINADO.exec(linha.texto);
      if (!valor || linha.recuo < 45 || !diaCorrente) return;

      // Entre R$ 100,00 e R$ 9.999,99, com o mesmo sinal do original.
      const bruto = 10000 + (semente(linha.texto) % 990000);
      const assinado = valor[1] === "-" ? -bruto : bruto;
      novoValor.set(indice, assinado);
      movimentoDoDia.set(diaCorrente, movimentoDoDia.get(diaCorrente)! + assinado);
    });

    // Saldos diarios recalculados a partir de um saldo inicial fabricado.
    const SALDO_INICIAL = 2_780_045;
    const dias = [...movimentoDoDia.keys()].sort(
      (a, b) => Number(a.slice(6) + a.slice(3, 5) + a.slice(0, 2)) -
                Number(b.slice(6) + b.slice(3, 5) + b.slice(0, 2)),
    );
    const saldoDoDia = new Map<string, number>();
    let acumulado = SALDO_INICIAL;
    for (const dia of dias) {
      acumulado += movimentoDoDia.get(dia)!;
      saldoDoDia.set(dia, acumulado);
    }

    const entradas = [...novoValor.values()].filter((v) => v > 0).reduce((a, b) => a + b, 0);
    const saidas = -[...novoValor.values()].filter((v) => v < 0).reduce((a, b) => a + b, 0);

    // Segunda passada: reescreve o texto de cada celula.
    const anonimas: LinhaPdf[] = linhas.map((linha, indice) => {
      const celulas = linha.celulas.map((celula) => {
        let texto = celula.texto;

        texto = texto
          .replace(/AEC ASSESSORIA EMPRESARIAL E CONTABIL S\/S/gi, "EMPRESA EXEMPLO CONTABIL S/S")
          .replace(/05\.434\.767\/0001-42/g, "00.000.000/0001-00")
          .replace(/Conta:\s*[\d-]+/gi, "Conta: 1234567-8");

        // So linhas de transacao (recuadas) tem contraparte. Nas linhas de
        // cabecalho, a substituicao explicita acima ja resolveu.
        const ehTransacao = linha.recuo >= 45;

        const documento = ehTransacao ? DOCUMENTO.exec(texto)?.[1] : undefined;
        if (documento) {
          const lista = documento.includes("/") ? DOCS_CNPJ : DOCS_CPF;
          texto = texto.replace(documento, lista[semente(documento) % lista.length]!);
        }

        // Nome da contraparte: coluna sem documento, sem valor e sem data.
        const ehNome =
          ehTransacao &&
          !DOCUMENTO.test(celula.texto) &&
          !/R\$/.test(celula.texto) &&
          !DATA.test(celula.texto) &&
          /^[A-Za-zÀ-ú0-9]/.test(celula.texto) &&
          !/^(Pagamento recebido|Boleto pago|Transf Pix enviada|Pgto QR Code Pix|Saldo do dia|Transações|Extrato|Total de|Saldo (inicial|final)|Ouvidoria|Cora SCFI|Agência|CNPJ|pág)/i.test(celula.texto);

        if (ehNome) {
          const truncado = /…|\.\.\.$/.test(celula.texto);
          const base = NOMES[semente(celula.texto) % NOMES.length]!;
          // Mantem o comprimento aproximado e a marca de truncamento.
          texto = truncado
            ? base.slice(0, Math.max(6, celula.texto.replace(/…/g, "").trim().length)) + "…"
            : base;
        }

        const valor = VALOR_ASSINADO.exec(celula.texto);
        if (valor && novoValor.has(indice)) {
          const novo = novoValor.get(indice)!;
          texto = celula.texto.replace(
            VALOR_ASSINADO,
            `${novo < 0 ? "-" : "+"} R$ ${formatarReais(novo)}`,
          );
        }

        const dia = DATA.exec(celula.texto)?.[0];
        if (/Saldo do dia/i.test(linha.texto) && /R\$/.test(celula.texto) && !valor) {
          const doCabecalho = DATA.exec(linha.texto)?.[0];
          if (doCabecalho && saldoDoDia.has(doCabecalho)) {
            texto = `R$ ${formatarReais(saldoDoDia.get(doCabecalho)!)}`;
          }
        }
        if (/Saldo inicial disponível/i.test(linha.texto) && /R\$/.test(celula.texto)) {
          texto = `R$ ${formatarReais(SALDO_INICIAL)}`;
        }
        if (/Saldo final disponível/i.test(linha.texto) && /R\$/.test(celula.texto)) {
          texto = `R$ ${formatarReais(acumulado)}`;
        }
        if (/Total de entradas/i.test(linha.texto) && /R\$/.test(celula.texto)) {
          texto = `+ R$ ${formatarReais(entradas)}`;
        }
        if (/Total de saídas/i.test(linha.texto) && /R\$/.test(celula.texto)) {
          texto = `- R$ ${formatarReais(saidas)}`;
        }
        void dia;

        return { ...celula, texto };
      });

      return { ...linha, celulas, texto: celulas.map((c) => c.texto).join(" ").replace(/\s+/g, " ").trim() };
    });

    const serializado = JSON.stringify(anonimas, null, 1);

    // A lista de proibidos e DERIVADA do proprio extrato, nunca escrita a mao:
    // escrever a mao exigiria colar CNPJ e valores reais neste arquivo, que e
    // versionado — o vazamento seria justamente aqui. Derivar tambem cobre tudo,
    // e nao so o que alguem lembrou de listar.
    const sensiveis = new Set<string>();

    for (const linha of linhas) {
      // Unica excecao: o rodape institucional do proprio banco. O CNPJ do Cora e
      // publico, aparece identico em todo extrato que ele emite, e o leitor
      // depende dessa linha para reconhecer o formato. Anonimiza-la quebraria a
      // fixture sem proteger nada.
      if (/^Cora SCFI/i.test(linha.texto) || /^Ouvidoria:/i.test(linha.texto)) continue;

      for (const celula of linha.celulas) {
        const bruto = celula.texto.trim();
        if (bruto === "") continue;

        const documento = DOCUMENTO.exec(bruto)?.[1];
        if (documento) sensiveis.add(documento);

        // Qualquer valor monetario: transacao, saldo diario ou total.
        for (const valor of bruto.matchAll(/R\$\s*([\d.]+,\d{2})/g)) {
          sensiveis.add(valor[1]!);
        }

        // Nome de contraparte, so nas linhas de transacao.
        if (
          linha.recuo >= 45 &&
          !DOCUMENTO.test(bruto) &&
          !/R\$/.test(bruto) &&
          !DATA.test(bruto) &&
          !/^(Pagamento recebido|Boleto pago|Transf Pix enviada|Pgto QR Code Pix)$/i.test(bruto)
        ) {
          sensiveis.add(bruto.replace(/…/g, "").trim());
        }
      }
    }

    // Identificacao do titular.
    sensiveis.add(linhas[0]!.texto.trim());
    const conta = /Conta:\s*([\d-]+)/.exec(linhas.map((l) => l.texto).join(" "))?.[1];
    if (conta) sensiveis.add(conta);

    expect(sensiveis.size).toBeGreaterThan(50);

    for (const sensivel of sensiveis) {
      if (sensivel.length < 4) continue;
      expect(serializado, `vazou "${sensivel}" para a fixture`).not.toContain(sensivel);
    }

    writeFileSync(destino, serializado + "\n");
    console.log(`\n  fixture gerada: ${anonimas.length} linhas, ${sensiveis.size} valores sensiveis conferidos`);
  });
});
