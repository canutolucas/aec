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
