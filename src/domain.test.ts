import { describe, it, expect } from "vitest";
import { toMinor, money, parseCsv } from "./money";
import { parseReceipt } from "./extraction";
import type { Word } from "./types";
describe("exact amounts", () => {
  it("retains cents without floating point arithmetic", () => {
    expect(BigInt(toMinor("0.10")) + BigInt(toMinor("0.20"))).toBe(30n);
    expect(toMinor("1,234.05")).toBe("123405");
    expect(money("999999999999999")).toBe("$9,999,999,999,999.99");
  });
  it("rejects unsupported inputs", () => {
    for (const x of ["-2", "12,34", "1.005", "NaN", "1e3", "10000000000001"])
      expect(() => toMinor(x)).toThrow();
  });
});
describe("receipt suggestions", () => {
  const word = (text: string, y: number, x = 0.1): Word => ({
    text,
    y,
    x,
    w: 0.65,
    h: 0.025,
    page: 2,
  });
  it("uses the total rather than subtotal and retains page evidence", () => {
    const result = parseReceipt(
      [
        word("COMMUNITY SUPPLY", 0.1),
        word("10/22/2026", 0.2),
        word("SUBTOTAL $172.66", 0.4),
        word("TOTAL $184.75", 0.6),
      ],
      2,
      "local test",
    );
    expect(result.fields).toEqual({
      merchant: "COMMUNITY SUPPLY",
      expenseDate: "2026-10-22",
      totalMinor: "18475",
    });
    expect(result.sources.totalMinor?.page).toBe(2);
    expect(result.sources.totalMinor?.y).toBe(0.6);
  });
  it("does not invent missing amounts or organizational context", () => {
    const r = parseReceipt([word("Unclear receipt", 0.1)], 2, "local test");
    expect(r.fields.totalMinor).toBeUndefined();
    expect(r.fields).not.toHaveProperty("claimant");
    expect(r.fields).not.toHaveProperty("fund");
  });
});
it("previews quoted CSV cells without losing embedded punctuation", () => {
  expect(parseCsv('a,b\r\n"one, two","He said ""yes"""\r\n')).toEqual([
    ["a", "b"],
    ["one, two", 'He said "yes"'],
  ]);
});
