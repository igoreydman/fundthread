import { receiptRows } from "./extraction";
import { toMinor } from "./money";
import type { Box, Extraction } from "./types";

export type AmountKind =
  | "grand_total"
  | "total"
  | "amount_due"
  | "subtotal"
  | "tax"
  | "tender"
  | "change";
export type AmountCandidate = {
  kind: AmountKind;
  amountMinor: string;
  box: Box;
};
export function receiptAmounts(
  extraction: Extraction | null,
): AmountCandidate[] {
  if (!extraction) return [];
  return receiptRows(extraction.words, extraction.page).flatMap(
    ({ text, box }) => {
      const label = text.match(
        /^\s*(grand\s+total|total|amount\s+due|sub\s*total|sales\s+tax|tax|tender(?:ed)?|cash|change)\b/i,
      );
      if (!label) return [];
      const amounts = [
        ...text
          .slice(label[0].length)
          .matchAll(/(?:\$|USD\s*)?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/g),
      ];
      // Do not silently choose among multiple amounts on one ambiguous line.
      if (amounts.length !== 1) return [];
      const normalized = label[1].toLowerCase().replace(/\s/g, "");
      const kind: AmountKind =
        normalized === "grandtotal"
          ? "grand_total"
          : normalized === "amountdue"
            ? "amount_due"
            : normalized === "subtotal"
              ? "subtotal"
              : /tax$/.test(normalized)
                ? "tax"
                : /^(cash|tender)/.test(normalized)
                  ? "tender"
                  : (normalized as AmountKind);
      try {
        return [{ kind, amountMinor: toMinor(amounts[0][1]), box: { ...box } }];
      } catch {
        return [];
      }
    },
  );
}
export function conflictingTotals(extraction: Extraction | null) {
  const totals = receiptAmounts(extraction).filter((x) =>
    ["total", "grand_total", "amount_due"].includes(x.kind),
  );
  return new Set(totals.map((x) => x.amountMinor)).size > 1 ? totals : [];
}
