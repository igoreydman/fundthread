import { expect, it } from "vitest";
import { demo } from "./demo";
import { analytics, analyticsRows, dailySeries } from "./analytics";
import { exportPreview } from "./exports";
import { reportText, wrapText } from "./reportPdf";
import { api } from "./api";

it("separates approved expense, gross receipts, dated totals and reimbursements", async () => {
  const state = await demo.startSample();
  const all = analytics(state, { start: "", end: "" });
  expect([all.gross, all.approvedAmount, all.paid, all.owed]).toEqual([
    53030n,
    18815n,
    16500n,
    2315n,
  ]);
  expect([
    all.approvedCount,
    all.needsReview,
    all.awaitingDecision,
    all.undatedCount,
  ]).toEqual([2, 2, 1, 1]);
  expect(all.undatedGross).toBe(6500n);
  expect(all.daily.map((d) => [d.label, d.amount])).toEqual([
    ["2026-10-22", 18815n],
  ]);
  expect(
    analytics(state, { start: "2026-10-22", end: "2026-10-22" }).gross,
  ).toBe(46530n);
  const empty = analytics(state, { start: "2026-10-23", end: "2026-10-24" });
  expect([empty.gross, empty.paid, empty.owed]).toEqual([0n, 0n, 0n]);
  expect(empty.daily.map((d) => [d.label, d.amount, d.count])).toEqual([
    ["2026-10-23", 0n, 0],
    ["2026-10-24", 0n, 0],
  ]);
  expect(() =>
    analytics(state, { start: "2026-10-25", end: "2026-10-20" }),
  ).toThrow("valid receipt-date range");
});

it("counts a split claim once and payments as settlement, not additional expense", async () => {
  const state = await demo.startSample();
  const claim = structuredClone(state.expenses[0]);
  Object.assign(claim, {
    approved: true,
    reviewed: true,
    totalMinor: "1501",
    eligibleMinor: "1001",
    paidMinor: "200",
    allocations: [
      { fundId: "youth", amountMinor: "600" },
      { fundId: "community", amountMinor: "401" },
    ],
  });
  state.expenses = [claim];
  state.payments = [
    state.payments[0],
    { ...state.payments[0], id: "another-payment" },
  ];
  const a = analytics(state, { start: "", end: "" });
  expect([a.gross, a.approvedAmount, a.paid, a.owed]).toEqual([
    1501n,
    1001n,
    200n,
    801n,
  ]);
  expect([a.approvedCount, a.daily[0].count, a.categories[0].count]).toEqual([
    1, 1, 1,
  ]);
  expect(a.funds.reduce((n, f) => n + f.amount, 0n)).toBe(1001n);
});

it("keeps large summed cents exact and makes undated/empty analytics exports explicit", async () => {
  const state = await demo.startSample();
  const source = state.expenses.find((e) => e.approved)!;
  state.funds = Array.from({ length: 20 }, (_, i) => ({
    ...state.funds[0],
    id: `f${i}`,
    code: `F${i}`,
    budgetMinor: "1000000000000000",
  }));
  state.expenses = state.funds.map((fund, i) => ({
    ...source,
    id: `e${i}`,
    totalMinor: "1000000000000000",
    eligibleMinor: "1000000000000000",
    paidMinor: "0",
    allocations: [{ fundId: fund.id, amountMinor: "1000000000000000" }],
  }));
  expect(analytics(state, { start: "", end: "" }).approvedAmount).toBe(
    20000000000000000n,
  );
  state.expenses = [];
  const rows = analyticsRows(state, { start: "", end: "" });
  expect(rows.find((r) => r[1] === "Approved expense")?.[3]).toBe("0");
  expect(rows.find((r) => r[0] === "undated")?.[4]).toBe("0");
});

it("keeps recipient PDF content inside the exact audience rows and guards changed organization/scope", async () => {
  const state = await demo.startSample();
  const funder = await exportPreview(state, {
    kind: "report",
    profile: "funder",
  });
  expect(JSON.stringify(reportText(funder))).not.toContain("Marta Silva");
  expect(JSON.stringify(reportText(funder))).not.toContain("Claudette");
  expect(
    JSON.stringify(
      reportText(
        await exportPreview(state, { kind: "report", profile: "bookkeeper" }),
      ),
    ),
  ).toContain("Marta Silva");
  const changed = await exportPreview(
    state,
    { kind: "report", profile: "funder" },
    "Centro Niñez · 北京",
  );
  expect(changed.csv).toBe(funder.csv);
  expect(changed.revisionToken).not.toBe(funder.revisionToken);
  const analyticsExport = await exportPreview(state, {
    kind: "analytics",
    start: "",
    end: "",
  });
  const sameMoneyDifferentScope = await exportPreview(state, {
    kind: "analytics",
    start: "2026-10-22",
    end: "2026-10-22",
  });
  expect(sameMoneyDifferentScope.revisionToken).not.toBe(
    analyticsExport.revisionToken,
  );
  expect(JSON.stringify(reportText(analyticsExport))).not.toContain(
    "amount_minor",
  );
  expect(JSON.stringify(reportText(analyticsExport))).not.toContain(
    "Summary 1",
  );
  await expect(
    api.writeReport("funder", { ...funder, csv: funder.csv + "tampered" }),
  ).rejects.toThrow("changed");
});

it("wraps long multilingual text without substituting characters or clipping a long token", () => {
  const value = "Niñez 北京 الأسرة " + "a".repeat(120);
  const lines = wrapText(value, 24, (s) => Array.from(s).length);
  expect(lines.every((line) => Array.from(line).length <= 24)).toBe(true);
  expect(lines.join("").replaceAll(" ", "")).toBe(value.replaceAll(" ", ""));
  expect(lines.join("")).not.toContain("?");
});

it("keeps daily category composition exact, dated and independent of period categories and split allocations", async () => {
  const state = await demo.startSample();
  const base = state.expenses.find((e) => e.approved)!;
  state.expenses = Array.from({ length: 7 }, (_, i) => ({
    ...base,
    id: `category-${i}`,
    category: `Category ${i}`,
    expenseDate: i < 4 ? "2026-10-22" : "2026-10-23",
    totalMinor: String(101 + i),
    eligibleMinor: String(101 + i),
    paidMinor: "0",
    allocations: [
      { fundId: "youth", amountMinor: "100" },
      { fundId: "community", amountMinor: String(1 + i) },
    ],
  }));
  state.expenses.push({
    ...base,
    id: "undated",
    expenseDate: "",
    category: "Undated category",
    totalMinor: "99999",
    eligibleMinor: "99999",
    paidMinor: "0",
  });
  state.expenses.push({
    ...base,
    id: "not-approved",
    approved: false,
    category: "Pending",
  });
  const result = analytics(state, { start: "", end: "" });
  expect(
    result.categories.find((c) => c.label === "Undated category")?.amount,
  ).toBe(99999n);
  const chart = dailySeries(result.dailyCategories);
  expect(chart.series).toHaveLength(5);
  expect(chart.series.at(-1)?.label).toBe("Other categories");
  expect(chart.series.some((c) => /Undated|Pending/.test(c.label))).toBe(false);
  expect(result.dailyCategories.flatMap((d) => d.categories)).toHaveLength(7);
  for (const day of chart.days)
    expect(day.amounts.reduce((n, v) => n + v, 0n)).toBe(day.amount);
  const rows = analyticsRows(state, { start: "", end: "" });
  const dailyTotals = rows.filter(
    (r) => r[0] === "daily" && r[1] === "Approved expense",
  );
  const categoryRows = rows.filter(
    (r) => r[0] === "daily" && r[1].startsWith("Category · "),
  );
  expect(dailyTotals.reduce((n, r) => n + BigInt(r[3]), 0n)).toBe(728n);
  expect(categoryRows.reduce((n, r) => n + BigInt(r[3]), 0n)).toBe(728n);
  expect(categoryRows).toHaveLength(7);
  expect(categoryRows.every((r) => r[4] === "1")).toBe(true);
  expect(
    JSON.stringify(
      reportText(
        await exportPreview(state, { kind: "analytics", start: "", end: "" }),
      ),
    ),
  ).toContain("Category · Category 0");
});

it("keeps category color identity and canonical order stable when date totals reverse", async () => {
  const state = await demo.startSample(),
    base = state.expenses.find((e) => e.approved)!;
  state.expenses = [
    {
      ...base,
      id: "a",
      expenseDate: "2026-10-22",
      category: "Workshop supplies",
      eligibleMinor: "900",
      totalMinor: "900",
    },
    {
      ...base,
      id: "b",
      expenseDate: "2026-10-22",
      category: "Travel",
      eligibleMinor: "100",
      totalMinor: "100",
    },
    {
      ...base,
      id: "c",
      expenseDate: "2026-10-23",
      category: "Workshop supplies",
      eligibleMinor: "100",
      totalMinor: "100",
    },
    {
      ...base,
      id: "d",
      expenseDate: "2026-10-23",
      category: "Travel",
      eligibleMinor: "900",
      totalMinor: "900",
    },
  ];
  const views = ["2026-10-22", "2026-10-23"].map((date) =>
    dailySeries(analytics(state, { start: date, end: date }).dailyCategories),
  );
  expect(views[0].series).toEqual(views[1].series);
  expect(views[0].series.map((s) => s.label)).toEqual([
    "Workshop supplies",
    "Travel",
  ]);
  expect(views[0].days[0].amounts).toEqual([900n, 100n]);
  expect(views[1].days[0].amounts).toEqual([100n, 900n]);
});
