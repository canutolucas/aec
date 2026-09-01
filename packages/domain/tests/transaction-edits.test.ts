import { describe, expect, it } from "vitest";

import { canSettle, canUnsettle, editLocks, type TransactionState } from "../src/transaction-edits";

function state(overrides: Partial<TransactionState> = {}): TransactionState {
  return {
    status: "realizado",
    reconciled: false,
    hasInvoiceSettlement: false,
    isTransfer: false,
    periodLocked: false,
    ...overrides,
  };
}

describe("editLocks", () => {
  it("nothing is locked for a plain, open, unreconciled transaction", () => {
    const locks = editLocks(state());
    expect(locks.amount).toEqual([]);
    expect(locks.bookingDate).toEqual([]);
    expect(locks.bankAccountId).toEqual([]);
    expect(locks.categoryId).toEqual([]);
    expect(locks.competenceDate).toEqual([]);
    expect(locks.text).toEqual([]);
  });

  it("reconciled locks amount, date and account — but not category or text", () => {
    const locks = editLocks(state({ reconciled: true }));
    expect(locks.amount).toEqual(["conciliado"]);
    expect(locks.bookingDate).toEqual(["conciliado"]);
    expect(locks.bankAccountId).toEqual(["conciliado"]);
    expect(locks.categoryId).toEqual([]);
    expect(locks.text).toEqual([]);
  });

  it("an invoice settlement locks only amount", () => {
    const locks = editLocks(state({ hasInvoiceSettlement: true }));
    expect(locks.amount).toEqual(["baixaDeNota"]);
    expect(locks.bookingDate).toEqual([]);
    expect(locks.bankAccountId).toEqual([]);
  });

  it("a transfer locks amount, date, account and category — never text", () => {
    const locks = editLocks(state({ isTransfer: true }));
    expect(locks.amount).toEqual(["transferencia"]);
    expect(locks.bookingDate).toEqual(["transferencia"]);
    expect(locks.bankAccountId).toEqual(["transferencia"]);
    expect(locks.categoryId).toEqual(["transferencia"]);
    expect(locks.competenceDate).toEqual([]);
    expect(locks.text).toEqual([]);
  });

  it("locks stack: reconciled + invoice settlement both apply to amount", () => {
    const locks = editLocks(state({ reconciled: true, hasInvoiceSettlement: true }));
    expect(locks.amount).toEqual(["conciliado", "baixaDeNota"]);
  });

  it("a closed month locks every field, on top of whatever else applies", () => {
    const locks = editLocks(state({ reconciled: true, periodLocked: true }));
    expect(locks.amount).toEqual(["conciliado", "mesFechado"]);
    expect(locks.text).toEqual(["mesFechado"]);
    expect(locks.competenceDate).toEqual(["mesFechado"]);
  });
});

describe("canSettle", () => {
  it("a previsto in an open month can be settled", () => {
    expect(canSettle(state({ status: "previsto" }))).toBe(true);
  });

  it("an already-realizado cannot", () => {
    expect(canSettle(state({ status: "realizado" }))).toBe(false);
  });

  it("a transfer leg cannot", () => {
    expect(canSettle(state({ status: "previsto", isTransfer: true }))).toBe(false);
  });

  it("a previsto in a closed month cannot", () => {
    expect(canSettle(state({ status: "previsto", periodLocked: true }))).toBe(false);
  });
});

describe("canUnsettle", () => {
  it("a plain realizado in an open month can go back to previsto", () => {
    expect(canUnsettle(state({ status: "realizado" }))).toBe(true);
  });

  it("a previsto cannot (nothing to undo)", () => {
    expect(canUnsettle(state({ status: "previsto" }))).toBe(false);
  });

  it("a reconciled transaction cannot — reconciliation must be undone first", () => {
    expect(canUnsettle(state({ reconciled: true }))).toBe(false);
  });

  it("a transaction with an invoice settlement cannot", () => {
    expect(canUnsettle(state({ hasInvoiceSettlement: true }))).toBe(false);
  });

  it("a transfer leg cannot", () => {
    expect(canUnsettle(state({ isTransfer: true }))).toBe(false);
  });

  it("nothing can be undone in a closed month", () => {
    expect(canUnsettle(state({ periodLocked: true }))).toBe(false);
  });
});
