/**
 * Table types, mirroring supabase/migrations.
 *
 * Written by hand on purpose, not generated: they're few and stable, so the
 * project doesn't depend on running the Supabase CLI to compile. If they
 * ever drift from the schema, the SQL tests in tests/sql are the source of truth.
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

export type MemberRole = "cliente_leitura" | "assistente" | "contador" | "owner";
export type BankAccountKind = "corrente" | "poupanca" | "aplicacao" | "cartao_credito" | "caixa";
export type CategoryKind = "entrada" | "saida" | "ambos";
export type TransactionStatus = "previsto" | "realizado";
export type TransactionDirection = "entrada" | "saida";
export type ReconciliationStatus = "nao_conciliado" | "conciliado" | "ignorado";
export type PaymentMethod =
  | "pix"
  | "ted"
  | "doc"
  | "boleto"
  | "debito_automatico"
  | "cartao"
  | "dinheiro"
  | "cheque"
  | "outro";

export interface Company {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  timezone: string;
  is_active: boolean;
}

export interface Membership {
  id: string;
  company_id: string;
  user_id: string;
  role: MemberRole;
}

export interface BankAccount {
  id: string;
  company_id: string;
  name: string;
  kind: BankAccountKind;
  bank_code: string | null;
  bank_name: string | null;
  branch: string | null;
  account_number: string | null;
  opening_balance: string;
  opening_balance_date: string;
  minimum_balance: string | null;
  is_active: boolean;
}

export interface Category {
  id: string;
  company_id: string;
  parent_id: string | null;
  name: string;
  kind: CategoryKind;
  ledger_account: string | null;
  is_active: boolean;
}

export interface Counterparty {
  id: string;
  company_id: string;
  name: string;
  tax_id: string | null;
  is_active: boolean;
}

export interface Transaction {
  id: string;
  company_id: string;
  bank_account_id: string;
  category_id: string | null;
  counterparty_id: string | null;
  cost_center_id: string | null;
  booking_date: string;
  competence_date: string;
  amount: string;
  direction: TransactionDirection;
  status: TransactionStatus;
  reconciliation: ReconciliationStatus;
  payment_method: PaymentMethod | null;
  description: string;
  document_number: string | null;
  notes: string | null;
  transfer_group_id: string | null;
  is_transfer: boolean;
  created_by: string | null;
  created_at: string;
}

/** Row from the v_account_balances view. */
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

export interface MonthlyClosing {
  id: string;
  company_id: string;
  period: string;
  locked_at: string | null;
  locked_by: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
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
  owner: "Responsavel",
};

export const ACCOUNT_KIND_LABELS: Record<BankAccountKind, string> = {
  corrente: "Conta corrente",
  poupanca: "Poupanca",
  aplicacao: "Aplicacao",
  cartao_credito: "Cartao de credito",
  caixa: "Caixa",
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
