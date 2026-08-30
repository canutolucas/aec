/**
 * Formatacao para a tela.
 */

import type { IsoDate } from "@aec/domain";
import { formatAmount, formatBRL } from "@aec/domain";

export { formatAmount, formatBRL };

/** 2025-03-05 -> 05/03/2025 */
export function formatDate(date: IsoDate): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

/** 2025-03-01 -> "marco de 2025" */
export function formatMonth(period: IsoDate): string {
  const [year, month] = period.split("-");
  const names = [
    "janeiro",
    "fevereiro",
    "marco",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
  ];
  return `${names[Number(month) - 1]} de ${year}`;
}

/** timestamptz (ex.: "2025-03-05T14:32:00Z") -> "05/03/2025 11:32" no fuso do Brasil. */
export function formatDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

/** Formata CNPJ ou CPF a partir dos digitos. */
export function formatTaxId(digits: string | null): string {
  if (!digits) return "";
  if (digits.length === 14) {
    return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  }
  if (digits.length === 11) {
    return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  }
  return digits;
}

/**
 * A NFS-e nao traz vencimento (so emissao) — o cliente paga "no mes
 * seguinte", conforme a propria usuaria descreveu, sem uma data fixa
 * declarada em lugar nenhum. 45 dias e uma folga alem do mes seguinte
 * inteiro antes de chamar uma nota de "vencida", pra nao alarmar por uma
 * nota que so esta esperando o prazo normal.
 */
export const OVERDUE_AFTER_DAYS = 45;

/** Uma nota em aberto emitida ha mais de OVERDUE_AFTER_DAYS dias. */
export function isInvoiceOverdue(issuedOn: IsoDate, outstandingCents: number): boolean {
  if (outstandingCents <= 0) return false;
  const issued = new Date(`${issuedOn}T00:00:00`);
  const days = (Date.now() - issued.getTime()) / (1000 * 60 * 60 * 24);
  return days > OVERDUE_AFTER_DAYS;
}

/**
 * Garante que uma mensagem de erro sempre da pra ler e agir — em vez de um
 * texto cru de driver/Postgres (json, stack trace, "fetch failed") virar a
 * unica coisa que a pessoa ve na tela. A grande maioria dos erros deste app
 * ja vem como frase em portugues (as proprias RPCs levantam a excecao com
 * essa mensagem — ver comentario em cada uma); isto so cobre o resto.
 */
export function friendlyError(raw: string | undefined, fallback: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) return fallback;
  const looksReadable = /[a-zà-ú]/i.test(trimmed) && /[.!?]$/.test(trimmed) && trimmed.length < 300;
  if (looksReadable) return trimmed;
  return `${fallback} Se continuar, avise com esta mensagem: "${trimmed}".`;
}
