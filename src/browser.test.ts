import { beforeEach, expect, it } from "vitest";
import { api } from "./api";
import { demo, demoDocument } from "./demo";
import { inspectReceipt } from "./receiptImport";
import { checkReview } from "./browserRules";
import type { ReviewInput } from "./types";
beforeEach(() => demo.startPersonal());
const pdf = (text = "synthetic original") =>
  new File([`%PDF-1.7 ${text}`], "evidence.pdf", { type: "application/pdf" });
it("imports actual bytes without sample records, recognizes duplicates and preserves originals through review", async () => {
  const file = pdf();
  const imported = await demo.importFiles([file, pdf()]);
  expect(imported.failures).toHaveLength(0);
  expect(imported.outcomes.map((x) => x.duplicate)).toEqual([false, true]);
  let s = await demo.snapshot();
  expect(s.funds).toHaveLength(0);
  expect(s.expenses).toHaveLength(1);
  const e = s.expenses[0];
  expect(e.claimant).toBe("");
  expect(e.hash).toMatch(/^[a-f0-9]{64}$/);
  expect(e.filename).toBe("evidence.pdf");
  await demo.saveReview({
    id: e.id,
    expectedRevision: 0,
    merchant: "Reviewed merchant",
    claimant: "",
    purpose: "",
    expenseDate: "",
    category: "Other",
    totalMinor: "5325",
    eligibleMinor: "5325",
    reviewed: false,
    allocations: [],
  });
  expect(
    new TextDecoder().decode(
      Uint8Array.from((await demoDocument(e.documentId)).bytes),
    ),
  ).toBe("%PDF-1.7 synthetic original");
  s = await demo.snapshot();
  expect(s.expenses[0].revision).toBe(1);
});
it("keeps successful imports when another file is unsupported and does not trust the extension", async () => {
  const result = await demo.importFiles([
    pdf(),
    new File(["<svg/>"], "disguised.png", { type: "image/png" }),
  ]);
  expect(result.outcomes).toHaveLength(1);
  expect(result.failures).toHaveLength(1);
  expect((await demo.snapshot()).expenses).toHaveLength(1);
});
it("switching to the fictional sample clears personal documents and keeps samples separate", async () => {
  await demo.importFiles([pdf()]);
  const id = (await demo.snapshot()).expenses[0].documentId;
  await demo.startSample();
  expect((await demo.snapshot()).expenses).toHaveLength(5);
  await expect(demoDocument(id)).rejects.toThrow();
  await expect(demo.importFiles([pdf()])).rejects.toThrow("personal");
  await demo.startPersonal();
  expect((await demo.snapshot()).expenses).toHaveLength(0);
});
it("rejects oversized image headers before decoding and truncated JPEG segments", () => {
  const b = new Uint8Array(33);
  b.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(b.buffer);
  view.setUint32(8, 13);
  b.set([73, 72, 68, 82], 12);
  view.setUint32(16, 100000);
  view.setUint32(20, 100000);
  expect(() => inspectReceipt(b)).toThrow("24 megapixels");
  expect(() =>
    inspectReceipt(new Uint8Array([255, 216, 255, 224, 0, 10])),
  ).toThrow("damaged");
});
it("validates allocations before mutation and rejects duplicate approvals, invalid dates and overpayments", async () => {
  await demo.importFiles([pdf()]);
  let s = await demo.addFund({
    name: "Workshop fund",
    code: "W-26",
    budgetMinor: "10000",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    categories: ["Other"],
    restrictions: "",
  });
  const e = s.expenses[0],
    f = s.funds[0];
  const input: ReviewInput = {
    id: e.id,
    expectedRevision: 0,
    merchant: "Canal Supply",
    claimant: "Fictional recipient",
    purpose: "Workshop",
    expenseDate: "2026-10-22",
    category: "Other",
    totalMinor: "5325",
    eligibleMinor: "5325",
    reviewed: true,
    allocations: [{ fundId: f.id, amountMinor: "5325" }],
  };
  expect(() => checkReview({ ...input, expenseDate: "2026-02-30" }, s)).toThrow(
    "date",
  );
  expect(() =>
    checkReview(
      { ...input, allocations: [...input.allocations, ...input.allocations] },
      s,
    ),
  ).toThrow("once");
  await demo.saveReview(input);
  await demo.approve(e.id, 1, "Synthetic director", "TEST-1");
  await expect(
    demo.approve(e.id, 1, "Synthetic director", "TEST-2"),
  ).rejects.toThrow("already");
  await expect(demo.pay(e.id, "5326", "PAY-1", "2026-10-23")).rejects.toThrow(
    "owed",
  );
  await expect(demo.pay(e.id, "100", "PAY-1", "2026-02-30")).rejects.toThrow(
    "date",
  );
  expect((await demo.snapshot()).payments).toHaveLength(0);
});

it("does not mix personal files into sample data when an import is still reading", async () => {
  const file = pdf();
  let resume!: (bytes: ArrayBuffer) => void;
  file.arrayBuffer = () =>
    new Promise<ArrayBuffer>((resolve) => {
      resume = resolve;
    });
  const pending = demo.importFiles([file]);
  await expect(demo.startSample()).rejects.toThrow("finish");
  resume(await pdf().arrayBuffer());
  await pending;
  expect(demo.mode()).toBe("personal");
  expect((await demo.snapshot()).expenses).toHaveLength(1);
});

it("privacy exports require confirmation and reject records from an earlier session or revision", async () => {
  await demo.importFiles([pdf()]);
  const e = (await demo.snapshot()).expenses[0];
  await expect(api.writePdf(e, new Uint8Array(), false)).rejects.toThrow(
    "confirm",
  );
  await demo.startSample();
  await expect(api.writePdf(e, new Uint8Array(), true)).rejects.toThrow(
    "Records changed",
  );
});
