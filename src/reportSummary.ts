import { toMinor } from "./money";
// Both canonical rows and dollar-denominated CSV reconcile to exact cents.
export function summarizeReport(rows: string[][]) {
  const header = rows[0] ?? [];
  const claim = header.indexOf("claim_id");
  const cents = header.includes("approved_allocation_minor");
  const allocation = header.indexOf(
    cents ? "approved_allocation_minor" : "approved_allocation_usd",
  );
  const currency = header.indexOf("currency");
  const fund = header.indexOf("fund_code");
  if ([claim, allocation, currency, fund].some((index) => index < 0))
    return null;
  const records = rows.slice(1).filter((row) => row.some(Boolean));
  if (
    records.some(
      (row) =>
        !(cents ? /^\d+$/ : /^\d+\.\d{2}$/).test(row[allocation] ?? "") ||
        row[currency] !== "USD" ||
        !row[claim],
    )
  )
    return null;
  return {
    claims: new Set(records.map((row) => row[claim])).size,
    allocations: records.length,
    funds: new Set(records.map((row) => row[fund])).size,
    approvedMinor: records.reduce(
      (total, row) =>
        total + BigInt(cents ? row[allocation] : toMinor(row[allocation])),
      0n,
    ),
  };
}
