/**
 * Leitor do extrato em PDF do Cora.
 *
 * PDF e a pior origem possivel para conciliacao, e vale ser explicito sobre por
 * que — quem for manter isto precisa saber o que esta aceitando:
 *
 *   1. Nao ha identificador de transacao (o FITID do OFX). A deduplicacao cai
 *      para data + valor + historico.
 *   2. O extrato TRUNCA o nome da contraparte ("Le Va Tout Do Brasil L…").
 *      Regra de categorizacao baseada em nome fica pela metade.
 *   3. O layout e da diagramacao, nao um contrato. Quando o banco mudar o
 *      desenho da pagina, este leitor para de funcionar.
 *
 * Duas coisas compensam:
 *
 *   O CNPJ/CPF da contraparte vem INTEIRO, mesmo quando o nome vem cortado. Ele e
 *   uma chave melhor do que o nome jamais seria — nao muda, nao abrevia e nao
 *   depende de como o banco escreveu. As regras de categorizacao devem se apoiar
 *   nele.
 *
 *   O extrato declara os totais e o saldo de CADA DIA. Refazer essas contas e
 *   comparar detecta o pior modo de falha de um leitor de PDF: ler errado e nao
 *   avisar. Uma linha perdida produziria um saldo plausivel, e a diferenca so
 *   apareceria no fechamento, quando ninguem mais liga uma coisa a outra. Aqui,
 *   ela aparece na importacao.
 *
 * O Cora tambem exporta OFX. Havendo OFX, use OFX.
 */

import type { IsoDate } from "@/lib/domain/dates";
import { type Cents, parseUserInput, sum } from "@/lib/domain/money";
import { assignDedupKeys } from "./dedup";
import { extrairLinhas, type LinhaPdf } from "./pdf";
import {
  type CanonicalLine,
  type CanonicalStatement,
  type DailyBalanceCheck,
  ImportError,
  type StatementIntegrity,
} from "./types";

/**
 * Recuo maximo, em pontos, para uma linha ser considerada de titulo.
 *
 * No layout do Cora, cabecalho e data do dia comecam na margem (x ~ 30) e as
 * transacoes vem recuadas (x ~ 54). E o unico sinal que separa "25/08/2026 Saldo
 * do dia" de uma transacao — as duas tem data e valor.
 */
const RECUO_TITULO = 45;

const DATA = /(\d{2})\/(\d{2})\/(\d{4})/;
const DOCUMENTO = /(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{3}\.\d{3}\.\d{3}-\d{2})/;
const VALOR_COM_SINAL = /([+-])\s*R\$\s*([\d.]+,\d{2})/;
const VALOR = /R\$\s*(-?[\d.]+,\d{2})/;

export async function parseCoraPdf(bytes: Uint8Array): Promise<CanonicalStatement> {
  return parseCoraLinhas(await extrairLinhas(bytes));
}

/**
 * Interpreta as linhas ja extraidas.
 *
 * Funcao pura de proposito: da para testar o layout inteiro sem nenhum PDF
 * binario, o que importa porque extrato de verdade carrega dado financeiro real
 * e nao pode virar fixture de repositorio.
 */
export function parseCoraLinhas(linhas: readonly LinhaPdf[]): CanonicalStatement {
  const warnings: string[] = [];
  const tudo = linhas.map((linha) => linha.texto).join("\n");

  if (!/Cora SCFI/i.test(tudo)) {
    throw new ImportError(
      "Este PDF não parece ser um extrato do Cora. Se for de outro banco, exporte em OFX — " +
        "o leitor de OFX funciona para qualquer banco.",
    );
  }

  // Procura o intervalo pelo proprio padrao, e nao pela proximidade do rotulo:
  // no PDF, "Extrato do período" e as datas ficam a 1,5 ponto de distancia
  // vertical e caem em linhas diferentes. "data a data" so aparece aqui.
  const periodo = /(\d{2}\/\d{2}\/\d{4})\s*a\s*(\d{2}\/\d{2}\/\d{4})/.exec(tudo);
  const geradoEm = /Extrato gerado no dia\s*(\d{2}\/\d{2}\/\d{4})/.exec(tudo);
  const declaredOpening = lerValorRotulado(tudo, /Saldo inicial disponível\s*R\$\s*([\d.]+,\d{2})/);
  const declaredClosing = lerValorRotulado(tudo, /Saldo final disponível\s*R\$\s*([\d.]+,\d{2})/);
  const declaredInflow = lerValorRotulado(tudo, /Total de entradas\s*\+\s*R\$\s*([\d.]+,\d{2})/);
  const declaredOutflow = lerValorRotulado(tudo, /Total de saídas\s*-\s*R\$\s*([\d.]+,\d{2})/);

  const brutas: Array<{
    postedAt: IsoDate;
    amount: Cents;
    memo: string;
    counterpartyName?: string;
    counterpartyDocument?: string;
    nameTruncated?: boolean;
  }> = [];

  const saldosDeclarados = new Map<IsoDate, Cents>();
  let diaCorrente: IsoDate | null = null;

  for (const linha of linhas) {
    if (ehRuidoDePagina(linha.texto)) continue;

    // Cabecalho de dia: na margem, com data e "Saldo do dia".
    if (linha.recuo < RECUO_TITULO && /Saldo do dia/i.test(linha.texto)) {
      const data = DATA.exec(linha.texto);
      const saldo = VALOR.exec(linha.texto.replace(DATA, ""));
      if (data && saldo) {
        diaCorrente = paraIso(data);
        saldosDeclarados.set(diaCorrente, parseUserInput(saldo[1]!));
      }
      continue;
    }

    // Transacao: recuada, com valor assinado.
    if (linha.recuo < RECUO_TITULO) continue;

    const valor = VALOR_COM_SINAL.exec(linha.texto);
    if (!valor) continue;

    if (diaCorrente === null) {
      warnings.push(`Transação ignorada por vir antes de qualquer data: "${linha.texto}"`);
      continue;
    }

    const montante = parseUserInput(valor[2]!);
    const documento = DOCUMENTO.exec(linha.texto)?.[1];

    // O que sobra depois de tirar valor e documento e o tipo mais o nome. As
    // celulas ja separam as duas colunas; o texto corrido nao separaria.
    const colunas = linha.celulas.map((celula) => celula.texto.trim());
    const tipo = colunas[0] ?? "";
    const nomeBruto = colunas
      .slice(1)
      .find((coluna) => !DOCUMENTO.test(coluna) && !VALOR.test(coluna));

    const truncado = nomeBruto !== undefined && /[…]|\.\.\.$/.test(nomeBruto);
    const nome = nomeBruto?.replace(/\s*(…|\.\.\.)\s*$/, "").trim();

    brutas.push({
      postedAt: diaCorrente,
      amount: valor[1] === "-" ? -montante : montante,
      // O memo carrega tudo que o extrato deu, inclusive o documento: e o texto
      // que as regras de categorizacao vao percorrer.
      memo: [tipo, nome, documento].filter(Boolean).join(" - "),
      counterpartyName: nome || undefined,
      counterpartyDocument: documento?.replace(/\D/g, ""),
      nameTruncated: truncado || undefined,
    });
  }

  if (brutas.length === 0) {
    throw new ImportError(
      "Nenhuma transação encontrada no PDF. O layout do extrato pode ter mudado.",
    );
  }

  // O extrato vem do mais recente para o mais antigo; o resto do sistema espera
  // ordem cronologica.
  brutas.sort((a, b) => (a.postedAt < b.postedAt ? -1 : a.postedAt > b.postedAt ? 1 : 0));

  const lines: CanonicalLine[] = assignDedupKeys(brutas);

  const integrity = conferir({
    lines,
    saldosDeclarados,
    declaredOpening,
    declaredClosing,
    declaredInflow,
    declaredOutflow,
  });

  if (!integrity.ok) warnings.push(...integrity.problems);

  const truncados = lines.filter((line) => line.nameTruncated).length;
  if (truncados > 0) {
    warnings.push(
      `${truncados} de ${lines.length} contrapartes vieram com o nome cortado pelo extrato. ` +
        "O CNPJ/CPF veio inteiro e é uma chave melhor: prefira criar as regras de categorização " +
        "por documento. Se o Cora oferecer OFX para este período, o OFX traz o nome completo.",
    );
  }

  // O periodo que o extrato ATESTA nao e o que ele declara.
  //
  // Este extrato diz cobrir 01/08 a 31/08, mas foi gerado no dia 25 e so tem
  // movimento ate la. Gravar 31/08 como fim do periodo faria o sistema tratar
  // agosto como ja coberto, e o "conciliado ate" passaria a mentir — os dias 26
  // a 31 nunca seriam cobrados de ninguem. O fim real e o ultimo dia para o qual
  // o extrato imprimiu saldo.
  const declaredStart = periodo ? paraIso(DATA.exec(periodo[1]!)!) : undefined;
  const declaredEnd = periodo ? paraIso(DATA.exec(periodo[2]!)!) : undefined;
  const ultimoDiaAtestado = [...saldosDeclarados.keys()].sort().pop();

  const periodStart = declaredStart ?? lines[0]!.postedAt;
  const periodEnd = ultimoDiaAtestado ?? lines[lines.length - 1]!.postedAt;

  if (declaredEnd !== undefined && declaredEnd > periodEnd) {
    warnings.push(
      `O extrato diz cobrir até ${formatarData(declaredEnd)}, mas foi gerado em ` +
        `${geradoEm ? geradoEm[1] : formatarData(periodEnd)} e só tem movimento até ` +
        `${formatarData(periodEnd)}. O período importado vai até aí; peça o extrato do restante ` +
        "do mês antes de fechar.",
    );
  }

  return {
    source: "pdf",
    // COMPE do Cora. O PDF traz o CNPJ 37.880.206/0001-63, que e o mesmo da
    // instituicao sob os dois nomes que ela ja usou (SCD e SCFI).
    bankId: "403",
    periodStart,
    periodEnd,
    openingBalance: declaredOpening,
    ledgerBalance: declaredClosing,
    ledgerBalanceDate: periodEnd,
    lines,
    integrity,
    warnings,
  };
}

function conferir(entrada: {
  lines: readonly CanonicalLine[];
  saldosDeclarados: ReadonlyMap<IsoDate, Cents>;
  declaredOpening?: Cents;
  declaredClosing?: Cents;
  declaredInflow?: Cents;
  declaredOutflow?: Cents;
}): StatementIntegrity {
  const { lines, saldosDeclarados, declaredOpening, declaredClosing } = entrada;
  const problems: string[] = [];

  const computedInflow = sum(lines.filter((l) => l.amount > 0).map((l) => l.amount));
  // Somado como positivo, para comparar com o "Total de saidas" do extrato, que
  // tambem vem sem sinal.
  const computedOutflow = -sum(lines.filter((l) => l.amount < 0).map((l) => l.amount));

  if (entrada.declaredInflow !== undefined && entrada.declaredInflow !== computedInflow) {
    problems.push(
      `Total de entradas não confere: o extrato declara ${reais(entrada.declaredInflow)} e as ` +
        `linhas lidas somam ${reais(computedInflow)}.`,
    );
  }

  if (entrada.declaredOutflow !== undefined && entrada.declaredOutflow !== computedOutflow) {
    problems.push(
      `Total de saídas não confere: o extrato declara ${reais(entrada.declaredOutflow)} e as ` +
        `linhas lidas somam ${reais(computedOutflow)}.`,
    );
  }

  // Saldo acumulado dia a dia contra o "Saldo do dia" que o extrato imprime.
  // E a conferencia mais forte: localiza EM QUE DIA a leitura divergiu, em vez
  // de so dizer que o total ficou errado.
  const dailyChecks: DailyBalanceCheck[] = [];
  let acumulado = declaredOpening ?? 0;

  if (declaredOpening !== undefined) {
    const porDia = new Map<IsoDate, Cents>();
    for (const line of lines) {
      porDia.set(line.postedAt, (porDia.get(line.postedAt) ?? 0) + line.amount);
    }

    for (const dia of [...porDia.keys()].sort()) {
      acumulado += porDia.get(dia)!;
      const declared = saldosDeclarados.get(dia);
      if (declared === undefined) continue;

      const ok = declared === acumulado;
      dailyChecks.push({ date: dia, declared, computed: acumulado, ok });

      if (!ok) {
        problems.push(
          `Saldo de ${dia} não confere: o extrato declara ${reais(declared)} e o acumulado das ` +
            `linhas lidas dá ${reais(acumulado)}.`,
        );
      }
    }
  }

  const computedClosing = declaredOpening === undefined ? undefined : acumulado;

  if (
    declaredClosing !== undefined &&
    computedClosing !== undefined &&
    declaredClosing !== computedClosing
  ) {
    problems.push(
      `Saldo final não confere: o extrato declara ${reais(declaredClosing)} e o acumulado das ` +
        `linhas lidas dá ${reais(computedClosing)}.`,
    );
  }

  return {
    declaredOpening,
    declaredClosing,
    declaredInflow: entrada.declaredInflow,
    declaredOutflow: entrada.declaredOutflow,
    computedInflow,
    computedOutflow,
    computedClosing,
    dailyChecks,
    ok: problems.length === 0,
    problems,
  };
}

function lerValorRotulado(texto: string, padrao: RegExp): Cents | undefined {
  const encontrado = padrao.exec(texto);
  return encontrado ? parseUserInput(encontrado[1]!) : undefined;
}

function paraIso(data: RegExpExecArray): IsoDate {
  return `${data[3]}-${data[2]}-${data[1]}`;
}

/** 2026-08-25 -> 25/08/2026 */
function formatarData(data: IsoDate): string {
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

function reais(cents: Cents): string {
  const sinal = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sinal}R$ ${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** Cabecalho e rodape que se repetem em toda pagina. */
function ehRuidoDePagina(texto: string): boolean {
  return (
    /^pág \d+ de \d+$/i.test(texto) ||
    /^Extrato gerado no dia/i.test(texto) ||
    /^Ouvidoria:/i.test(texto) ||
    /^Cora SCFI/i.test(texto) ||
    /^Agência:/i.test(texto) ||
    /^CNPJ [\d.\/-]+$/i.test(texto)
  );
}
