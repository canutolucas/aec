import { describe, expect, it } from "vitest";

import { isValidLineShape, parsePayload } from "./parse-payload";

function line(overrides: Partial<Parameters<typeof isValidLineShape>[0]> = {}) {
  return {
    postedAt: "2025-03-04",
    amount: -1000,
    memo: "Pagamento fornecedor",
    dedupKey: "abc123",
    ...overrides,
  };
}

function payload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ source: "ofx", lines: [line()], ...overrides });
}

describe("isValidLineShape", () => {
  it("accepts a well-formed line", () => {
    expect(isValidLineShape(line())).toBe(true);
  });

  it.each([
    ["postedAt not a date string", line({ postedAt: "04/03/2025" })],
    ["postedAt with a valid-looking but malformed length", line({ postedAt: "2025-3-4" })],
    ["amount not a safe integer", line({ amount: 10.5 })],
    ["amount as a string", { ...line(), amount: "1000" as unknown as number }],
    ["dedupKey empty", line({ dedupKey: "" })],
    ["dedupKey missing", { ...line(), dedupKey: undefined as unknown as string }],
  ])("rejects: %s", (_label, malformed) => {
    expect(isValidLineShape(malformed)).toBe(false);
  });

  it("accepts amount 0 at the shape level — parsePayload is what filters those out", () => {
    // isValidLineShape only checks Number.isSafeInteger, which is true for 0;
    // the zero-amount business rule lives in parsePayload, tested below.
    expect(isValidLineShape(line({ amount: 0 }))).toBe(true);
  });
});

describe("parsePayload", () => {
  it("parses a well-formed OFX payload", () => {
    const result = parsePayload(payload());
    expect(result).not.toBeNull();
    expect(result?.source).toBe("ofx");
    expect(result?.lines).toHaveLength(1);
  });

  it("accepts csv and pdf as valid sources too", () => {
    expect(parsePayload(payload({ source: "csv" }))?.source).toBe("csv");
    expect(parsePayload(payload({ source: "pdf" }))?.source).toBe("pdf");
  });

  it("rejects invalid JSON", () => {
    expect(parsePayload("{ not json")).toBeNull();
  });

  it("rejects an unknown source", () => {
    expect(parsePayload(payload({ source: "open_finance" }))).toBeNull();
  });

  it("rejects a payload with no lines array", () => {
    expect(parsePayload(JSON.stringify({ source: "ofx" }))).toBeNull();
  });

  it("rejects an empty lines array", () => {
    expect(parsePayload(payload({ lines: [] }))).toBeNull();
  });

  it("rejects more than 10,000 lines", () => {
    const tooMany = Array.from({ length: 10_001 }, (_, i) => line({ dedupKey: `k${i}` }));
    expect(parsePayload(payload({ lines: tooMany }))).toBeNull();
  });

  it("accepts exactly 10,000 lines", () => {
    const max = Array.from({ length: 10_000 }, (_, i) => line({ dedupKey: `k${i}` }));
    expect(parsePayload(payload({ lines: max }))?.lines).toHaveLength(10_000);
  });

  it("rejects the whole batch when any single line is malformed", () => {
    const lines = [line(), line({ postedAt: "not-a-date" })];
    expect(parsePayload(payload({ lines }))).toBeNull();
  });

  it("drops zero-amount lines but keeps the rest of an otherwise-good batch", () => {
    const lines = [line({ dedupKey: "a" }), line({ dedupKey: "b", amount: 0 })];
    const result = parsePayload(payload({ lines }));
    expect(result?.lines.map((l) => l.dedupKey)).toEqual(["a"]);
  });

  it("rejects the batch when every line is zero-amount", () => {
    const lines = [line({ amount: 0 })];
    expect(parsePayload(payload({ lines }))).toBeNull();
  });

  it("carries optional statement-level fields through unchanged", () => {
    const result = parsePayload(
      payload({
        periodStart: "2025-03-01",
        periodEnd: "2025-03-31",
        ledgerBalance: 123_456,
        ledgerBalanceDate: "2025-03-31",
      }),
    );
    expect(result?.periodStart).toBe("2025-03-01");
    expect(result?.ledgerBalance).toBe(123_456);
  });
});
