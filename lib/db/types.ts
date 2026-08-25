/**
 * Tipos das tabelas, espelhando supabase/migrations.
 *
 * Escritos a mao de proposito, e nao gerados: sao poucos e estaveis, e assim o
 * projeto nao depende de rodar o Supabase CLI para compilar. Se divergirem do
 * schema, os testes de SQL em tests/sql sao a fonte da verdade.
 *
 * Repare que todo valor monetario chega como STRING. E o driver do Postgres
 * entregando `numeric` sem passar por ponto flutuante — converta com
 * `fromDb` de lib/domain/money antes de fazer qualquer conta.
 */

export type MemberRole = "cliente_leitura" | "assistente" | "contador" | "owner";
export type BankAccountKind = "corrente" | "poupanca" | "aplicacao" | "cartao_credito" | "caixa";
export type CategoryKind = "entrada" | "saida" | "ambos";
export type TransactionStatus = "previsto" | "realizado";
export type TransactionDirection = "entrada" | "saida";
export type ReconciliationStatus = "nao_conciliado" | "conciliado" | "ignorado";
export type PaymentMethod =
  | "pix" | "ted" | "doc" | "boleto" | "debito_automatico"
  | "cartao" | "dinheiro" | "cheque" | "outro";

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

/** Linha da view v_account_balances. */
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

/** Ordem dos papeis, igual a app.role_rank no banco. */
const ROLE_RANK: Record<MemberRole, number> = {
  cliente_leitura: 1,
  assistente: 2,
  contador: 3,
  owner: 4,
};

/**
 * Espelha app.has_role do banco.
 *
 * Serve para a interface esconder o que a pessoa nao pode fazer — botao que so
 * devolve erro e uma cortesia ruim. NAO e o controle de acesso: esse e o RLS, no
 * banco. Se estes dois discordarem, quem vale e o banco.
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
