import { validDate } from "./browserRules";
import { CATEGORIES, type Expense, type Snapshot } from "./types";

export type DateRange = { start: string; end: string };
export type AnalyticsGroup = { label: string; amount: bigint; count: number };
const ordered = (groups: Map<string, AnalyticsGroup>) =>
  [...groups.values()].sort((a, b) =>
    a.label < b.label ? -1 : a.label > b.label ? 1 : 0,
  );
export function checkRange(range: DateRange) {
  if (
    (range.start && !validDate(range.start)) ||
    (range.end && !validDate(range.end)) ||
    (range.start && range.end && range.start > range.end)
  )
    throw new Error("Choose a valid receipt-date range.");
}
export function rangeLabel(range: DateRange) {
  return !range.start && !range.end
    ? "All receipt dates"
    : `${range.start || "First receipt"} to ${range.end || "Latest receipt"}`;
}
export function analytics(state: Snapshot, range: DateRange) {
  checkRange(range);
  const dated = (e: Expense) => validDate(e.expenseDate);
  const hasRange = !!(range.start || range.end);
  const expenses = state.expenses.filter((e) =>
    !dated(e)
      ? !hasRange
      : (!range.start || e.expenseDate >= range.start) &&
        (!range.end || e.expenseDate <= range.end),
  );
  const approved = expenses.filter((e) => e.approved);
  const total = (
    rows: Expense[],
    field: "totalMinor" | "eligibleMinor" | "paidMinor",
  ) => rows.reduce((sum, e) => sum + BigInt(e[field]), 0n);
  const gross = total(expenses, "totalMinor"),
    approvedAmount = total(approved, "eligibleMinor"),
    paid = total(approved, "paidMinor");
  const undated = state.expenses.filter((e) => !dated(e));
  const days = new Map<string, AnalyticsGroup>(),
    categories = new Map<string, AnalyticsGroup>(),
    funds = new Map<string, AnalyticsGroup>();
  const dayCategories = new Map<string, Map<string, AnalyticsGroup>>();
  function add(
    map: Map<string, AnalyticsGroup>,
    label: string,
    amount: bigint,
  ) {
    const group = map.get(label) ?? { label, amount: 0n, count: 0 };
    group.amount += amount;
    group.count++;
    map.set(label, group);
  }
  for (const e of approved) {
    const amount = BigInt(e.eligibleMinor);
    if (dated(e)) {
      add(days, e.expenseDate, amount);
      const groups =
        dayCategories.get(e.expenseDate) || new Map<string, AnalyticsGroup>();
      add(groups, e.category || "Uncategorized", amount);
      dayCategories.set(e.expenseDate, groups);
    }
    add(categories, e.category || "Uncategorized", amount);
    for (const a of e.allocations) {
      const fund = state.funds.find((f) => f.id === a.fundId);
      add(
        funds,
        fund ? `${fund.code} · ${fund.name}` : "Unknown fund",
        BigInt(a.amountMinor),
      );
    }
  }
  const dates = expenses
    .filter(dated)
    .map((e) => e.expenseDate)
    .sort();
  const first = range.start || dates[0],
    last = range.end || dates.at(-1);
  let zeroDaysIncluded = false;
  if (first && last) {
    const count =
      Math.round((Date.parse(last) - Date.parse(first)) / 86_400_000) + 1;
    if (count > 0 && count <= 366) {
      for (let i = 0; i < count; i++) {
        const day = new Date(Date.parse(first) + i * 86_400_000)
          .toISOString()
          .slice(0, 10);
        if (!days.has(day)) days.set(day, { label: day, amount: 0n, count: 0 });
      }
      zeroDaysIncluded = true;
    }
  }
  return {
    range,
    rangeLabel: rangeLabel(range),
    expenses,
    approvedCount: approved.length,
    gross,
    approvedAmount,
    paid,
    owed: approvedAmount - paid,
    needsReview: expenses.filter((e) => !e.reviewed).length,
    awaitingDecision: expenses.filter((e) => e.reviewed && !e.approved).length,
    undatedCount: undated.length,
    undatedGross: total(undated, "totalMinor"),
    undatedApproved: total(
      undated.filter((e) => e.approved),
      "eligibleMinor",
    ),
    daily: ordered(days),
    dailyCategories: ordered(days).map((day) => ({
      ...day,
      categories: ordered(dayCategories.get(day.label) || new Map()),
    })),
    categories: ordered(categories),
    funds: ordered(funds),
    zeroDaysIncluded,
  };
}

export function analyticsRows(state: Snapshot, range: DateRange): string[][] {
  const a = analytics(state, range),
    currency = state.currency;
  const rows = [
    [
      "section",
      "metric",
      "period_or_date",
      "amount_minor",
      "count",
      "currency",
    ],
    ["scope", "Receipt dates", a.rangeLabel, "", "", currency],
    [
      "summary",
      "Approved expense",
      "",
      a.approvedAmount.toString(),
      String(a.approvedCount),
      currency,
    ],
    [
      "summary",
      "Recorded receipt total",
      "",
      a.gross.toString(),
      String(a.expenses.length),
      currency,
    ],
    ["summary", "Paid on these expenses", "", a.paid.toString(), "", currency],
    ["summary", "Still owed", "", a.owed.toString(), "", currency],
    ["summary", "Needs review", "", "", String(a.needsReview), currency],
    [
      "summary",
      "Awaiting decision",
      "",
      "",
      String(a.awaitingDecision),
      currency,
    ],
    [
      "undated",
      hasRange(range)
        ? "Undated receipts outside date filter"
        : "Undated receipts included in receipt total",
      "No receipt date",
      a.undatedGross.toString(),
      String(a.undatedCount),
      currency,
    ],
  ];
  for (const d of a.dailyCategories) {
    rows.push([
      "daily",
      "Approved expense",
      d.label,
      d.amount.toString(),
      String(d.count),
      currency,
    ]);
    for (const c of d.categories)
      rows.push([
        "daily",
        `Category · ${c.label}`,
        d.label,
        c.amount.toString(),
        String(c.count),
        currency,
      ]);
  }
  for (const c of a.categories)
    rows.push([
      "category",
      c.label,
      "",
      c.amount.toString(),
      String(c.count),
      currency,
    ]);
  for (const f of a.funds)
    rows.push([
      "fund",
      f.label,
      "",
      f.amount.toString(),
      String(f.count),
      currency,
    ]);
  return rows;
}
function hasRange(range: DateRange) {
  return !!(range.start || range.end);
}

export function dailySeries(
  days: {
    label: string;
    amount: bigint;
    count: number;
    categories: AnalyticsGroup[];
  }[],
) {
  const totals = new Map<string, bigint>();
  for (const day of days)
    for (const c of day.categories)
      totals.set(c.label, (totals.get(c.label) || 0n) + c.amount);
  const ranked = [...totals].sort(([a, av], [b, bv]) =>
    av === bv ? (a < b ? -1 : a > b ? 1 : 0) : av > bv ? -1 : 1,
  );
  const picked = ranked.length > 5 ? ranked.slice(0, 4) : ranked;
  const keys = new Set(picked.map(([name]) => name));
  const catalog = [...CATEGORIES, "Uncategorized"];
  const order = (label: string) =>
    catalog.indexOf(label) < 0 ? catalog.length : catalog.indexOf(label);
  picked.sort(
    ([a], [b]) => order(a) - order(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const colorFor = (label: string) => {
    const known = catalog.indexOf(label);
    if (known >= 0) return known;
    return (
      Array.from(label).reduce(
        (hash, char) => (hash * 31 + char.codePointAt(0)!) >>> 0,
        0,
      ) % catalog.length
    );
  };
  const series = picked.map(([label]) => ({
    label,
    other: false,
    color: colorFor(label),
  }));
  if (ranked.length > 5)
    series.push({ label: "Other categories", other: true, color: 7 });
  return {
    series,
    days: days.map((day) => ({
      ...day,
      amounts: series.map((s) =>
        day.categories
          .filter((c) => (s.other ? !keys.has(c.label) : c.label === s.label))
          .reduce((n, c) => n + c.amount, 0n),
      ),
    })),
  };
}
