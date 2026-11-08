import type { FundInput, ReviewInput, Snapshot } from "./types";
export function minor(value: string): bigint {
  if (!/^\d+$/.test(value))
    throw new Error("Enter a non-negative amount in cents.");
  const n = BigInt(value);
  if (n > 1_000_000_000_000_000n)
    throw new Error("Amount exceeds the supported range.");
  return n;
}
export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function required(value: string, label: string) {
  if (!value.trim()) throw new Error(`${label} is required.`);
  if (value.length > 4000) throw new Error(`${label} is too long.`);
}
export function checkReview(input: ReviewInput, state: Snapshot) {
  const total = minor(input.totalMinor),
    eligible = minor(input.eligibleMinor);
  if (eligible > total)
    throw new Error("Eligible reimbursement cannot exceed the receipt total.");
  const ids = new Set<string>();
  let allocated = 0n;
  for (const a of input.allocations) {
    if (ids.has(a.fundId)) throw new Error("Use each fund once per claim.");
    ids.add(a.fundId);
    if (!state.funds.some((f) => f.id === a.fundId))
      throw new Error("A selected fund is no longer available.");
    allocated += minor(a.amountMinor);
  }
  if (allocated > eligible)
    throw new Error("Fund allocations exceed the eligible reimbursement.");
  for (const value of [
    input.merchant,
    input.claimant,
    input.purpose,
    input.category,
    input.expenseDate,
  ])
    if (value.length > 4000) throw new Error("A review field is too long.");
  if (input.reviewed) {
    for (const [value, label] of [
      [input.merchant, "Merchant"],
      [input.claimant, "Person being reimbursed"],
      [input.purpose, "Purpose"],
      [input.category, "Category"],
    ])
      required(value, label);
    if (!validDate(input.expenseDate))
      throw new Error("Choose the actual receipt date.");
    if (!eligible || allocated !== eligible)
      throw new Error(
        "Allocate the full eligible amount before marking reviewed.",
      );
  }
}
export function checkFund(input: FundInput) {
  required(input.name, "Fund name");
  required(input.code, "Fund code");
  minor(input.budgetMinor);
  if (
    !validDate(input.periodStart) ||
    !validDate(input.periodEnd) ||
    input.periodStart > input.periodEnd
  )
    throw new Error("Choose a valid grant period.");
  if (input.restrictions.length > 4000)
    throw new Error("Restriction notes are too long.");
}
