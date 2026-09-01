/**
 * Which fields of an existing transaction are safe to edit, and why not
 * when they aren't.
 *
 * The rule this file encodes: a field stays editable unless getting it
 * wrong could make the system assert something false about money that's
 * already been checked against an outside source — the bank's own
 * statement (reconciliation) or a client's invoice (settlement). Everything
 * else — description, notes, document number, payment method, category,
 * counterparty, cost center, competence date — can always be corrected,
 * because none of it feeds a proof.
 *
 * This is deliberately a pure function, called from both sides of the
 * wire: the screen uses it to grey out a field with a reason, and the
 * Server Action recomputes the same locks before writing, so disabling a
 * field in the UI is a courtesy, never the actual guard. RLS underneath is
 * the real authority for "mes fechado" — this file just gives that refusal
 * a clear reason instead of a raw Postgres error.
 */

export type TransactionLock = "conciliado" | "baixaDeNota" | "transferencia" | "mesFechado";

export interface TransactionState {
  readonly status: "previsto" | "realizado";
  readonly reconciled: boolean;
  readonly hasInvoiceSettlement: boolean;
  readonly isTransfer: boolean;
  readonly periodLocked: boolean;
}

/**
 * `amount`/`bookingDate`/`bankAccountId` are what the balance proof and the
 * invoice settlement rely on. `categoryId` is locked only for a transfer
 * (it has none — `transactions_transfer_has_no_category` in the schema).
 * `competenceDate` and `text` (description, notes, document number, payment
 * method, counterparty, cost center) are never locked by anything but a
 * closed month.
 */
export type EditableField =
  "amount" | "bookingDate" | "bankAccountId" | "categoryId" | "competenceDate" | "text";

const ALL_FIELDS: readonly EditableField[] = [
  "amount",
  "bookingDate",
  "bankAccountId",
  "categoryId",
  "competenceDate",
  "text",
];

/** Lock reasons per field. An empty array means the field is free to edit. */
export function editLocks(
  state: TransactionState,
): Record<EditableField, readonly TransactionLock[]> {
  const locks: Record<EditableField, TransactionLock[]> = {
    amount: [],
    bookingDate: [],
    bankAccountId: [],
    categoryId: [],
    competenceDate: [],
    text: [],
  };

  if (state.isTransfer) {
    locks.amount.push("transferencia");
    locks.bookingDate.push("transferencia");
    locks.bankAccountId.push("transferencia");
    locks.categoryId.push("transferencia");
  }
  if (state.reconciled) {
    locks.amount.push("conciliado");
    locks.bookingDate.push("conciliado");
    locks.bankAccountId.push("conciliado");
  }
  if (state.hasInvoiceSettlement) {
    locks.amount.push("baixaDeNota");
  }
  if (state.periodLocked) {
    for (const field of ALL_FIELDS) locks[field].push("mesFechado");
  }

  return locks;
}

/** Whether a previsto can receive a baixa (settle_transaction). */
export function canSettle(state: TransactionState): boolean {
  return state.status === "previsto" && !state.isTransfer && !state.periodLocked;
}

/**
 * Whether a realizado can go back to previsto — either to undo a baixa or
 * to fix "I posted this as realized but the money hasn't actually moved
 * yet". There's no column distinguishing the two cases: settle_transaction
 * always updates the row in place.
 */
export function canUnsettle(state: TransactionState): boolean {
  return (
    state.status === "realizado" &&
    !state.reconciled &&
    !state.hasInvoiceSettlement &&
    !state.isTransfer &&
    !state.periodLocked
  );
}
