import { decimal, toMinor } from "./money";
import type { Expense, ReviewInput } from "./types";

export type BatchDraft = {
  merchant: string;
  expenseDate: string;
  total: string;
  claimant: string;
  purpose: string;
  category: string;
  eligible: string;
  allocations: { fundId: string; amount: string }[];
};
export const batchSeed = (e: Expense): BatchDraft => ({
  merchant: e.merchant,
  expenseDate: e.expenseDate,
  total: e.revision === 0 && e.totalMinor === "0" ? "" : decimal(e.totalMinor),
  claimant: e.claimant,
  purpose: e.purpose,
  category: e.category,
  eligible:
    e.revision === 0 && e.eligibleMinor === "0" ? "" : decimal(e.eligibleMinor),
  allocations: e.allocations.map((a) => ({
    fundId: a.fundId,
    amount: decimal(a.amountMinor),
  })),
});
export function batchSuggestions(
  d: BatchDraft,
  e: Expense,
  touched: Set<keyof BatchDraft>,
): BatchDraft {
  if (e.reviewed || e.approved || BigInt(e.paidMinor) > 0n || !e.extraction)
    return d;
  const next = { ...d };
  const f = e.extraction.fields;
  if (!d.merchant && !touched.has("merchant") && f.merchant)
    next.merchant = f.merchant;
  if (!d.expenseDate && !touched.has("expenseDate") && f.expenseDate)
    next.expenseDate = f.expenseDate;
  if (!d.total && !touched.has("total") && f.totalMinor)
    next.total = decimal(f.totalMinor);
  return next;
}
export function batchInput(
  e: Expense,
  d: BatchDraft,
  reviewed = false,
): ReviewInput {
  if (!reviewed && (e.reviewed || e.approved || BigInt(e.paidMinor) > 0n))
    throw new Error("Open this record to change its completed review.");
  return {
    id: e.id,
    expectedRevision: e.revision,
    merchant: d.merchant,
    expenseDate: d.expenseDate,
    totalMinor: toMinor(d.total || "0"),
    claimant: d.claimant,
    purpose: d.purpose,
    category: d.category,
    eligibleMinor: toMinor(d.eligible || "0"),
    reviewed,
    allocations: d.allocations.map((a) => ({
      fundId: a.fundId,
      amountMinor: toMinor(a.amount || "0"),
    })),
  };
}
