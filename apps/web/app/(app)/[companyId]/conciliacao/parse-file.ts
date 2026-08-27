/**
 * Le um arquivo de extrato (OFX/QFX, CSV ou PDF do Cora) e devolve o
 * CanonicalStatement pronto para importar — sem nenhum estado de tela, para
 * ser compartilhado entre conciliacao-client.tsx (fluxo avancado, com
 * preview antes de importar) e inicio-client.tsx (fluxo simples, sem
 * preview: le e ja importa).
 */

import {
  type CanonicalStatement,
  detectMapping,
  parseOfx,
  parseStatementCsv,
} from "@aec/statements";

import { parsePdfStatement } from "./actions";

export type ParsedFileResult =
  | { readonly ok: true; readonly statement: CanonicalStatement }
  | { readonly ok: false; readonly error: string };

/**
 * O PDF vai inteiro em base64 (~33% maior) no corpo da Server Action de
 * parsePdfStatement (actions.ts), cujo limite esta configurado em 8mb em
 * next.config.ts. Recusar aqui, antes de tentar enviar, evita que um
 * arquivo grande demais estoure esse limite no meio do caminho — isso
 * derrubava a chamada com um erro cru do React em vez da mensagem amigavel
 * que a acao devolve pra PDF invalido. So vale pra PDF: OFX/CSV sao lidos
 * inteiramente no navegador, sem passar pelo servidor.
 */
const MAX_PDF_BYTES = 6 * 1024 * 1024;

/** Converts a File into the base64 string the PDF server action expects. */
async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked to avoid blowing the call stack on String.fromCharCode(...bytes)
  // with a large statement file.
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function parseStatementFile(companyId: string, file: File): Promise<ParsedFileResult> {
  try {
    const isPdf = /\.pdf$/i.test(file.name);
    if (isPdf) {
      if (file.size > MAX_PDF_BYTES) {
        return {
          ok: false,
          error: `Este PDF tem ${(file.size / (1024 * 1024)).toFixed(1)}MB, acima do limite de ${MAX_PDF_BYTES / (1024 * 1024)}MB. Se for um extrato do Cora, peça um período menor; qualquer outro banco, exporte em OFX — funciona pra qualquer tamanho.`,
        };
      }
      const base64 = await fileToBase64(file);
      const result = await parsePdfStatement(companyId, base64);
      return result.ok
        ? { ok: true, statement: result.statement }
        : { ok: false, error: result.error };
    }

    const content = await file.text();
    const isOfx = /\.(ofx|qfx)$/i.test(file.name) || content.includes("<OFX>");
    if (isOfx) return { ok: true, statement: parseOfx(content) };

    const detected = detectMapping(content);
    if (!detected.mapping) {
      return {
        ok: false,
        error: `${detected.problems.join(" ")} Exporte em OFX ou use um CSV com Data, Historico e Valor.`,
      };
    }
    return { ok: true, statement: parseStatementCsv(content, detected.mapping) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Nao foi possivel ler este arquivo.",
    };
  }
}

/** Serializa o statement no mesmo formato que importStatement (actions.ts) espera no payload. */
export function statementToImportPayload(statement: CanonicalStatement): string {
  return JSON.stringify({
    source: statement.source,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    ledgerBalance: statement.ledgerBalance,
    ledgerBalanceDate: statement.ledgerBalanceDate,
    lines: statement.lines.map((line) => ({
      postedAt: line.postedAt,
      amount: line.amount,
      memo: line.memo,
      fitid: line.fitid,
      dedupKey: line.dedupKey,
    })),
  });
}
