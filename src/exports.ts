import type { ExportSpec, Report, Snapshot } from "./types";
import { analyticsRows } from "./analytics";

export function csvCell(value: string) {
  const text = value.replace(/[\r\n\t]/g, " ");
  return `"${(/^[\s]*[=+@-]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`;
}
export function dollarRows(rows: string[][]): string[][] {
  const headers = rows[0] || [];
  return rows.map((row, index) =>
    row.map((value, column) => {
      if (!headers[column]?.endsWith("_minor")) return value;
      if (index === 0) return value.replace(/_minor$/, "_usd");
      if (!value) return value;
      if (!/^-?\d+$/.test(value))
        throw new Error("Invalid stored money value.");
      const n = BigInt(value),
        absolute = n < 0n ? -n : n;
      return `${n < 0n ? "-" : ""}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, "0")}`;
    }),
  );
}
export const exportCsv = (rows: string[][]) =>
  dollarRows(rows)
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function reportRows(state: Snapshot, profile: string): string[][] {
  if (profile !== "funder" && profile !== "bookkeeper")
    throw new Error("Choose a report audience.");
  const people = profile === "bookkeeper";
  const rows = [
    [
      "claim_id",
      "revision",
      "expense_date",
      "fund_code",
      "currency",
      "approved_allocation_minor",
      "payment_status",
      ...(people
        ? ["merchant", "purpose", "claimant", "approver", "approval_reference"]
        : []),
    ],
  ];
  for (const e of state.expenses.filter((e) => e.approved))
    for (const a of e.allocations) {
      const fund = state.funds.find((f) => f.id === a.fundId);
      if (!fund)
        throw new Error(
          "A selected fund is unavailable. Refresh the workspace.",
        );
      rows.push([
        e.id,
        String(e.revision),
        e.expenseDate,
        fund.code,
        state.currency,
        a.amountMinor,
        e.paidMinor === e.eligibleMinor
          ? "paid"
          : e.paidMinor === "0"
            ? "unpaid"
            : "partially paid",
        ...(people
          ? [e.merchant, e.purpose, e.claimant, e.approver, e.approvalReference]
          : []),
      ]);
    }
  return rows;
}
export async function exportPreview(
  state: Snapshot,
  spec: ExportSpec,
  organization = state.organization,
): Promise<Report> {
  if (
    !organization.trim() ||
    organization.length > 4000 ||
    /[\x00-\x1f]/.test(organization)
  )
    throw new Error("Enter an organization name on one line.");
  const rows =
    spec.kind === "report"
      ? reportRows(state, spec.profile)
      : analyticsRows(state, spec);
  const csv = exportCsv(rows);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify(canonical([spec, organization, state])),
    ),
  );
  return {
    spec,
    csv,
    rows,
    organization,
    revisionToken: Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join(""),
  };
}
