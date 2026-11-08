import { expect, it } from "vitest";
import { parseReceipt } from "./extraction";
import { conflictingTotals, receiptAmounts } from "./receiptAmounts";
import type { Word } from "./types";

const extract = (lines: string[], page = 2) =>
  parseReceipt(
    lines.map((text, i): Word => ({
      text,
      page,
      x: 0.1,
      y: i * 0.1,
      w: 0.6,
      h: 0.02,
    })),
    page,
    "synthetic local fixture",
  );

it.each(["TOTAL", "GRAND TOTAL"])(
  "retains %s before lower amount due and excludes subtotal/tax/tender/change",
  (label) => {
    const e = extract([
      "SUBTOTAL $48.50",
      "TAX $4.75",
      `${label} $53.25`,
      "TENDERED $60.00",
      "CHANGE $6.75",
      "AMOUNT DUE $0.00",
    ]);
    expect(e.fields.totalMinor).toBe("5325");
    expect(e.sources.totalMinor).toEqual({
      page: 2,
      x: 0.1,
      y: 0.2,
      w: 0.6,
      h: 0.02,
    });
    const conflicts = conflictingTotals(e);
    expect(conflicts.map((c) => [c.kind, c.amountMinor])).toEqual([
      [label === "TOTAL" ? "total" : "grand_total", "5325"],
      ["amount_due", "0"],
    ]);
    expect(conflicts[0].box).toEqual(e.sources.totalMinor);
    expect(conflicts[1].box.y).toBeGreaterThan(conflicts[0].box.y);
  },
);

it("keeps a grand total ahead of a lower total", () => {
  const e = extract(["GRAND TOTAL $53.25", "TOTAL $48.50", "AMOUNT DUE $0.00"]);
  expect(e.fields.totalMinor).toBe("5325");
  expect(e.sources.totalMinor?.y).toBe(0);
  expect(conflictingTotals(e)).toHaveLength(3);
});

it("reads slightly misaligned OCR words left-to-right within the same row", () => {
  const words: Word[] = [
    { text: "TOTAL", page: 1, x: 0.1, y: 0.2, w: 0.2, h: 0.03 },
    { text: "$53.25", page: 1, x: 0.65, y: 0.199, w: 0.25, h: 0.03 },
    { text: "AMOUNT DUE", page: 1, x: 0.1, y: 0.4, w: 0.3, h: 0.03 },
    { text: "$0.00", page: 1, x: 0.65, y: 0.398, w: 0.25, h: 0.03 },
  ];
  const extraction = parseReceipt(words, 1, "synthetic OCR baseline offsets");
  expect(extraction.text).toBe("TOTAL $53.25\nAMOUNT DUE $0.00");
  expect(extraction.fields.totalMinor).toBe("5325");
  const conflicts = conflictingTotals(extraction);
  expect(conflicts.map((c) => c.amountMinor)).toEqual(["5325", "0"]);
  expect(extraction.sources.totalMinor).toEqual(conflicts[0].box);
  expect(conflicts[0].box.x).toBe(0.1);
  expect(conflicts[0].box.y).toBe(0.199);
});

it("does not warn when all total-like values agree", () => {
  const e = extract([
    "GRAND TOTAL $53.25",
    "TOTAL $53.25",
    "AMOUNT DUE $53.25",
  ]);
  expect(e.fields.totalMinor).toBe("5325");
  expect(conflictingTotals(e)).toEqual([]);
});

it("leaves missing or ambiguous multi-amount sources unresolved", () => {
  expect(conflictingTotals(null)).toEqual([]);
  expect(receiptAmounts(null)).toEqual([]);
  const e = extract([
    "TOTAL $10.00 $20.00",
    "SUBTOTAL $9.00",
    "TAX $1.00",
    "TENDERED $20.00",
  ]);
  expect(e.fields.totalMinor).toBeUndefined();
  expect(e.sources.totalMinor).toBeUndefined();
  expect(conflictingTotals(e)).toEqual([]);
  expect(receiptAmounts(e).map((c) => c.kind)).toEqual([
    "subtotal",
    "tax",
    "tender",
  ]);
});
