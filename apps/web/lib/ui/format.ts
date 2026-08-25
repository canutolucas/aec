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
