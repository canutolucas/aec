/**
 * Chave de deduplicacao de linha de extrato.
 */

import type { IsoDate } from "@/lib/domain/dates";
import { normalizeText } from "@/lib/domain/matching";
import type { Cents } from "@/lib/domain/money";

/**
 * Quando o banco fornece FITID, ele e a chave: e o identificador que o proprio
 * banco atribuiu a transacao, estavel entre exportacoes.
 */
export function fitidKey(fitid: string): string {
  return `fitid:${fitid.trim()}`;
}

/**
 * Sem FITID (o caso do CSV), a chave e composta de data, valor, memo e a
 * ORDEM DE OCORRENCIA daquela combinacao dentro do arquivo.
 *
 * A ocorrencia e o detalhe que importa: dois pagamentos identicos no mesmo dia
 * sao legitimos e acontecem — duas parcelas do mesmo fornecedor, dois pedagios.
 * Sem ela a segunda linha seria descartada como duplicata e o extrato passaria a
 * fechar com diferenca, exatamente o problema que a importacao existe para
 * resolver.
 *
 * Limitacao conhecida, propria do CSV: se um extrato posterior repetir o mesmo
 * dia e tiver um movimento identico A MAIS, ele sera confundido com o ja
 * importado. Com OFX isso nao acontece, porque ha FITID. Por isso o OFX e o
 * caminho preferencial e o CSV avisa quando encontra linhas identicas.
 */
export function compositeKey(
  postedAt: IsoDate,
  amount: Cents,
  memo: string,
  occurrence: number,
): string {
  const cleanMemo = normalizeText(memo).slice(0, 80);
  return `c:${postedAt}|${amount}|${cleanMemo}|${occurrence}`;
}

/**
 * Atribui a chave a cada linha, contando as ocorrencias repetidas.
 */
export function assignDedupKeys<T extends { postedAt: IsoDate; amount: Cents; memo: string; fitid?: string }>(
  lines: readonly T[],
): Array<T & { dedupKey: string }> {
  const seen = new Map<string, number>();

  return lines.map((line) => {
    if (line.fitid !== undefined && line.fitid.trim() !== "") {
      return { ...line, dedupKey: fitidKey(line.fitid) };
    }

    const base = compositeKey(line.postedAt, line.amount, line.memo, 0);
    const occurrence = seen.get(base) ?? 0;
    seen.set(base, occurrence + 1);

    return {
      ...line,
      dedupKey: compositeKey(line.postedAt, line.amount, line.memo, occurrence),
    };
  });
}
