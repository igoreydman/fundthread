import { expect, it } from "vitest";
import { parseCsv } from "./money";
import { dollarRows, exportCsv } from "./exports";
import { summarizeReport } from "./reportSummary";

it("sums allocation cents without counting a split claim twice", () => {
  const rows = parseCsv(
    '"claim_id","fund_code","currency","approved_allocation_minor"\n"claim-1","A","USD","14000"\n"claim-1","B","USD","4475"\n"claim-2","A","USD","4815"\n',
  );
  expect(summarizeReport(rows)).toEqual({
    claims: 2,
    allocations: 3,
    funds: 2,
    approvedMinor: 23290n,
  });
});

it("does not present a financial summary for invalid cents, mixed currency or an unknown schema", () => {
  const header = [
    "claim_id",
    "fund_code",
    "currency",
    "approved_allocation_minor",
  ];
  expect(summarizeReport([header, ["1", "A", "USD", "1.5"]])).toBeNull();
  expect(summarizeReport([header, ["1", "A", "EUR", "100"]])).toBeNull();
  expect(summarizeReport([["total"], ["100"]])).toBeNull();
  expect(summarizeReport([header])).toEqual({
    claims: 0,
    allocations: 0,
    funds: 0,
    approvedMinor: 0n,
  });
});

it("serializes exact USD decimals and reconciles CSV back to canonical cents without mutating rows", () => {
  const raw = [
    ["claim_id", "fund_code", "currency", "approved_allocation_minor"],
    ["one", "+Care", "USD", "1000000000000000"],
    ["one", "B", "USD", "1"],
  ];
  const serialized = exportCsv(raw);
  expect(serialized).toContain('"approved_allocation_usd"');
  expect(serialized).toContain('"10000000000000.00"');
  expect(serialized).toContain('"0.01"');
  expect(serialized).toContain("'+Care");
  expect(summarizeReport(parseCsv(serialized))?.approvedMinor).toBe(
    1000000000000001n,
  );
  expect(raw[1][3]).toBe("1000000000000000");
  expect(dollarRows([["amount_minor"], ["-123"], [""]])).toEqual([
    ["amount_usd"],
    ["-1.23"],
    [""],
  ]);
});
