/**
 * Extracao de texto posicionado de um PDF.
 *
 * Um PDF nao tem linhas nem colunas: tem pedacos de texto soltos, cada um com
 * sua coordenada, e em ordem arbitraria. Reconstruir a tabela e agrupar os
 * pedacos que compartilham o mesmo `y` (a linha) e ordena-los por `x` (as
 * colunas). E o que esta funcao faz, e so isso — interpretar o conteudo e
 * trabalho dos leitores de cada banco.
 *
 * A separacao existe para que o leitor de layout seja uma funcao PURA sobre
 * linhas de texto, testavel sem nenhum PDF binario. Isso importa aqui: extrato
 * de verdade contem dado financeiro real, que nao pode virar fixture de
 * repositorio.
 */

import { ImportError } from "./types";

export interface CelulaPdf {
  readonly x: number;
  /** Largura em pontos. Usada para saber onde o pedaco termina. */
  readonly largura: number;
  readonly texto: string;
}

export interface LinhaPdf {
  readonly pagina: number;
  readonly y: number;
  /** Coordenada x do primeiro pedaco. Distingue titulo de linha recuada. */
  readonly recuo: number;
  /** Os pedacos unidos na ordem das colunas. */
  readonly texto: string;
  readonly celulas: readonly CelulaPdf[];
}

/**
 * Tolerancia vertical para considerar dois pedacos como sendo da mesma linha.
 * Sobrescrito e acentuacao deslocam o `y` em fracoes de ponto; meio ponto agrupa
 * isso sem juntar linhas vizinhas, que num extrato ficam a 20 pontos ou mais.
 */
const TOLERANCIA_Y = 0.5;

/**
 * Distancia horizontal a partir da qual dois pedacos sao colunas diferentes.
 *
 * Abaixo disso eles sao um texto so que o PDF partiu no meio — e o caso das
 * reticencias de nome truncado, que vem como pedaco separado e precisa voltar
 * colada: "Le Va Tout Do Brasil L" + "…". Acima disso, e outra coluna, e juntar
 * sem espaco produziria "Pagamento recebidoLe Va Tout".
 */
const LIMITE_COLUNA = 2;

export async function extrairLinhas(bytes: Uint8Array): Promise<LinhaPdf[]> {
  // Importado sob demanda: o pdf.js e grande e so faz falta em quem importa
  // extrato, nao em toda requisicao da aplicacao.
  const { getDocumentProxy } = await import("unpdf");

  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch (error) {
    throw new ImportError(
      `Nao foi possivel abrir o PDF: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const linhas: LinhaPdf[] = [];

  for (let numero = 1; numero <= pdf.numPages; numero++) {
    const pagina = await pdf.getPage(numero);
    const { items } = await pagina.getTextContent();

    const porLinha = new Map<number, CelulaPdf[]>();

    for (const item of items) {
      if (!("str" in item) || item.str.trim() === "") continue;

      const x = item.transform[4] as number;
      const y = item.transform[5] as number;
      const largura = "width" in item && typeof item.width === "number" ? item.width : 0;
      const chave = Math.round(y / TOLERANCIA_Y) * TOLERANCIA_Y;

      const celula: CelulaPdf = { x, largura, texto: item.str };
      const celulas = porLinha.get(chave);
      if (celulas) celulas.push(celula);
      else porLinha.set(chave, [celula]);
    }

    // y cresce de baixo para cima no PDF, entao a ordem de leitura e decrescente.
    const ordenadas = [...porLinha.entries()].sort(([a], [b]) => b - a);

    for (const [y, celulas] of ordenadas) {
      const emOrdem = [...celulas].sort((a, b) => a.x - b.x);
      linhas.push({
        pagina: numero,
        y,
        recuo: emOrdem[0]!.x,
        texto: juntar(emOrdem),
        celulas: agrupar(emOrdem),
      });
    }
  }

  return linhas;
}

/**
 * Junta os pedacos de uma linha, colando os contiguos e separando as colunas por
 * espaco.
 */
function juntar(celulas: readonly CelulaPdf[]): string {
  let texto = "";

  for (const [indice, celula] of celulas.entries()) {
    const anterior = celulas[indice - 1];
    const contigua =
      anterior !== undefined && celula.x - (anterior.x + anterior.largura) < LIMITE_COLUNA;

    if (indice > 0 && !contigua) texto += " ";
    texto += celula.texto;
  }

  return texto.replace(/\s+/g, " ").trim();
}

/**
 * Funde os pedacos contiguos em uma celula so, para que cada celula da linha
 * corresponda a uma coluna de verdade.
 */
function agrupar(celulas: readonly CelulaPdf[]): CelulaPdf[] {
  const colunas: CelulaPdf[] = [];

  for (const celula of celulas) {
    const ultima = colunas[colunas.length - 1];
    const contigua =
      ultima !== undefined && celula.x - (ultima.x + ultima.largura) < LIMITE_COLUNA;

    if (contigua) {
      colunas[colunas.length - 1] = {
        x: ultima.x,
        largura: celula.x + celula.largura - ultima.x,
        texto: ultima.texto + celula.texto,
      };
    } else {
      colunas.push(celula);
    }
  }

  return colunas.map((coluna) => ({ ...coluna, texto: coluna.texto.trim() }));
}
