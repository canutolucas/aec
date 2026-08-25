/**
 * Ponte entre a importacao e a conciliacao.
 */

import type { StatementLine } from "@/lib/domain/matching";
import type { CanonicalStatement } from "./types";

export * from "./types";
export * from "./dedup";
export { parseOfx, parseOfxAmount, parseOfxDate, decodeOfx } from "./ofx";
export { parseCoraLinhas, parseCoraPdf } from "./cora";
export { extrairLinhas, type CelulaPdf, type LinhaPdf } from "./pdf";
export {
  type CsvMapping,
  type DetectedMapping,
  detectDelimiter,
  detectMapping,
  parseCsv,
  parseCsvDate,
  parseStatementCsv,
} from "./csv";

/**
 * Prepara as linhas do extrato para a conciliacao.
 *
 * Antes de serem gravadas, as linhas ainda nao tem id no banco. A identidade
 * delas nesse momento e a chave de deduplicacao, que ja e unica dentro da conta —
 * e a mesma chave que o banco usa depois no indice unico. Assim da para conciliar
 * e mostrar o resultado ANTES de gravar qualquer coisa, que e como a tela de
 * importacao deve funcionar: quem opera confere e so entao confirma.
 */
export function toMatchableLines(statement: CanonicalStatement): StatementLine[] {
  return statement.lines.map((line) => ({
    id: line.dedupKey,
    postedAt: line.postedAt,
    amount: line.amount,
    memo: line.memo,
  }));
}
