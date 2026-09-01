/**
 * Application-facing table types, derived from the generated schema.
 *
 * `database.types.ts` is regenerated straight from Postgres (see
 * packages/db/scripts/generate-types.mjs) and is the single source of
 * truth for column names and enum literals. The aliases below exist so the
 * rest of the app keeps importing `BankAccount`, `Transaction` and so on —
 * names that read better at a call site than `Database["public"]["Tables"]["bank_accounts"]["Row"]` —
 * without hand-maintaining a second copy of the schema that could drift
 * from the first.
 *
 * Two exceptions, both documented at their definition:
 *   - `Transaction` overrides `direction` and `is_transfer`: both are
 *     `generated always as` columns that Postgres's introspection reports
 *     as nullable (it doesn't reason about the generating expression), but
 *     the CASE and IS NOT NULL checks that define them mean neither is ever
 *     actually null.
 *   - `AccountBalance` stays hand-written: it mirrors a view, and Postgres
 *     marks every view column nullable regardless of what the underlying
 *     aggregate can prove, which would force a null-check on numbers this
 *     view's own COALESCE already guarantees are never null.
 *
 * Note every monetary value arrives as a STRING. That's the Postgres driver
 * handing back `numeric` without going through floating point — convert with
 * `fromDb` from `@aec/domain` before doing any math.
 *
 * Column names stay snake_case and the enum literals stay in Portuguese
 * ("previsto", "realizado", "entrada", "saida" and so on): they are the
 * exact identifiers the Postgres enums in supabase/migrations use, and that
 * migration deliberately leaves the database untouched. Translating them
 * here without also touching the database would just move the mismatch to
 * the wire between application and schema.
 */

import type { Database } from "./database.types";

type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];

export type MemberRole = Enums["member_role"];
export type BankAccountKind = Enums["bank_account_kind"];
export type CategoryKind = Enums["category_kind"];
export type TransactionStatus = Enums["transaction_status"];
export type TransactionDirection = Enums["transaction_direction"];
export type ReconciliationStatus = Enums["reconciliation_status"];
export type StatementSource = Enums["statement_source"];
export type StatementLineStatus = Enums["statement_line_status"];
export type PaymentMethod = Enums["payment_method"];
export type InvoiceStatus = Enums["invoice_status"];
export type RecurrenceFrequency = Enums["recurrence_frequency"];

export type Company = Tables["companies"]["Row"];
export type Membership = Tables["memberships"]["Row"];
export type Profile = Tables["profiles"]["Row"];
export type BankAccount = Tables["bank_accounts"]["Row"];
export type Category = Tables["categories"]["Row"];
export type Counterparty = Tables["counterparties"]["Row"];
export type CostCenter = Tables["cost_centers"]["Row"];
export type MonthlyClosing = Tables["monthly_closings"]["Row"];
export type StatementImport = Tables["statement_imports"]["Row"];
export type StatementLine = Tables["statement_lines"]["Row"];
export type MatchingRule = Tables["matching_rules"]["Row"];
export type Invoice = Tables["invoices"]["Row"];
export type InvoiceSettlement = Tables["invoice_settlements"]["Row"];
/** Um lancamento fixo (aluguel, folha, honorarios) que gera previstos sozinho. */
export type Recurrence = Tables["recurrences"]["Row"];
/** Uma lente gerencial agrupando contas — não confundir com `Profile` (usuário). */
export type AccountProfile = Tables["account_profiles"]["Row"];
export type AccountProfileAccount = Tables["account_profile_accounts"]["Row"];

/**
 * Uma linha da trilha de auditoria (`app.write_audit_log()`, preenchida só
 * por trigger, nunca pela aplicação). `action` é `text` com `check` no SQL,
 * não um enum do Postgres — a introspecção não tem como saber que só três
 * valores existem, então a união é declarada aqui como nos outros dois
 * casos deste arquivo.
 */
export type AuditLog = Omit<Tables["audit_log"]["Row"], "action"> & {
  action: "INSERT" | "UPDATE" | "DELETE";
};

export type Transaction = Omit<Tables["transactions"]["Row"], "direction" | "is_transfer"> & {
  direction: TransactionDirection;
  is_transfer: boolean;
};

/** Row from the v_account_balances view. See the file header for why this stays hand-written. */
export interface AccountBalance {
  bank_account_id: string;
  company_id: string;
  name: string;
  kind: BankAccountKind;
  bank_name: string | null;
  is_active: boolean;
  opening_balance: string;
  opening_balance_date: string;
  minimum_balance: string | null;
  current_balance: string;
  realized_balance: string;
  projected_balance: string;
  overdue_amount: string;
  unreconciled_count: number;
}

/**
 * Row from the v_monthly_category_summary view — same reason as
 * AccountBalance above (Postgres marks every view column nullable). Here
 * `category_id`/`category_name` genuinely can be null (a LEFT JOIN, for a
 * transaction lançada sem categoria); the rest never is, since it comes
 * straight from `transactions` columns that are themselves NOT NULL, or
 * from an aggregate over a non-empty group.
 */
export interface CategorySummary {
  company_id: string;
  period_cash: string;
  period_accrual: string;
  category_id: string | null;
  category_name: string | null;
  direction: TransactionDirection;
  status: TransactionStatus;
  total_amount: string;
  entry_count: number;
}

/** Row from the v_invoice_balances view. See the file header for why this stays hand-written. */
export interface InvoiceBalance {
  invoice_id: string;
  company_id: string;
  number: string;
  series: string | null;
  issued_on: string;
  due_on: string | null;
  amount: string;
  withheld_amount: string;
  client_name: string;
  client_tax_id: string | null;
  counterparty_id: string | null;
  status: InvoiceStatus;
  received_amount: string;
  outstanding_amount: string;
}

/** Role ranking, matching app.role_rank in the database. */
const ROLE_RANK: Record<MemberRole, number> = {
  cliente_leitura: 1,
  assistente: 2,
  contador: 3,
  owner: 4,
};

/**
 * Mirrors app.has_role in the database.
 *
 * Used by the UI to hide what a person can't do — a button that only
 * returns an error is a poor courtesy. It is NOT the access control: that's
 * RLS, in the database. If the two ever disagree, the database wins.
 */
export function hasRole(role: MemberRole | null | undefined, minimum: MemberRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

export const ROLE_LABELS: Record<MemberRole, string> = {
  cliente_leitura: "Cliente (somente leitura)",
  assistente: "Assistente",
  contador: "Contador",
  owner: "Responsável",
};

export const ACCOUNT_KIND_LABELS: Record<BankAccountKind, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupanca",
  aplicacao: "Aplicacao",
  cartao_credito: "Cartao de credito",
  caixa: "Caixa",
};

export const CATEGORY_KIND_LABELS: Record<CategoryKind, string> = {
  entrada: "Entrada",
  saida: "Saida",
  ambos: "Entrada ou saida",
};

export const RECURRENCE_FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  semanal: "Semanal",
  quinzenal: "Quinzenal",
  mensal: "Mensal",
  anual: "Anual",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: "PIX",
  ted: "TED",
  doc: "DOC",
  boleto: "Boleto",
  debito_automatico: "Debito automatico",
  cartao: "Cartao",
  dinheiro: "Dinheiro",
  cheque: "Cheque",
  outro: "Outro",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  aberta: "Em aberto",
  recebida_parcial: "Recebida parcialmente",
  recebida: "Recebida",
  cancelada: "Cancelada",
};
