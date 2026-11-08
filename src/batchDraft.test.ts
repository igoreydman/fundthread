import { expect, it } from "vitest";
import { demo } from "./demo";
import { batchInput, batchSeed, batchSuggestions } from "./batchDraft";

it("fills only untouched empty receipt fields and leaves eligibility and funding to the operator", async () => {
  const e = structuredClone((await demo.startSample()).expenses[4]);
  e.extraction = {
    engine: "test",
    page: 1,
    at: "",
    text: "",
    words: [],
    fields: {
      merchant: "SUGGESTED",
      expenseDate: "2026-10-22",
      totalMinor: "5325",
    },
    sources: {},
  };
  const draft = { ...batchSeed(e), merchant: "Human merchant", total: "" };
  const next = batchSuggestions(draft, e, new Set(["expenseDate"]));
  expect(next.merchant).toBe("Human merchant");
  expect(next.expenseDate).toBe("");
  expect(next.total).toBe("53.25");
  expect(next.eligible).toBe(draft.eligible);
  expect(next.allocations).toEqual([]);
  expect(draft.total).toBe("");
  expect(
    batchSuggestions({ ...draft, merchant: "" }, e, new Set(["merchant"]))
      .merchant,
  ).toBe("");
});

it("never auto-demotes reviewed, approved or paid claims", async () => {
  const source = (await demo.startSample()).expenses[0];
  for (const patch of [
    { reviewed: true },
    { approved: true },
    { paidMinor: "1" },
  ]) {
    const e = { ...source, ...patch };
    expect(() => batchInput(e, batchSeed(e))).toThrow("completed review");
  }
});

it("keeps each receipt amount and its revision independent and never auto-reviews", async () => {
  const state = await demo.startSample();
  const a = state.expenses[0],
    b = state.expenses[4];
  const first = batchInput(a, {
    ...batchSeed(a),
    total: "53.25",
    eligible: "50.01",
    allocations: [{ fundId: "youth", amount: "50.01" }],
  });
  const second = batchInput(b, batchSeed(b));
  expect([
    first.totalMinor,
    first.eligibleMinor,
    first.allocations[0].amountMinor,
  ]).toEqual(["5325", "5001", "5001"]);
  expect(first.reviewed).toBe(false);
  expect(first.expectedRevision).toBe(a.revision);
  expect(second.totalMinor).toBe("6500");
  expect(second.allocations).toEqual([]);
  expect(() => batchInput(a, { ...batchSeed(a), total: "1.234" })).toThrow(
    "two decimal",
  );
});
