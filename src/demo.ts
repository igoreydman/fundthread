import type {
  Expense,
  Snapshot,
  ReviewInput,
  FundInput,
  Original,
  Profile,
  RecordHistory,
  ExportSpec,
} from "./types";
import { exportPreview as makeExportPreview } from "./exports";
import {
  checkReview,
  checkFund,
  minor,
  required,
  validDate,
} from "./browserRules";
import {
  inspectReceipt,
  receiptHash,
  MAX_SESSION_BYTES,
  type ImportResult,
} from "./receiptImport";
const e = (
  id: string,
  merchant: string,
  total: string,
  extra: Partial<Expense> = {},
): Expense => ({
  id,
  documentId: `doc-${id}`,
  filename: `receipt-${id}.pdf`,
  mime: "application/pdf",
  hash: "sample-original",
  revision: 0,
  merchant,
  claimant: "Marta Silva",
  purpose: "Materials for the school safety workshop",
  expenseDate: "2026-10-22",
  category: "Workshop supplies",
  totalMinor: total,
  eligibleMinor: total,
  reviewed: false,
  approved: false,
  approver: "",
  approvalReference: "",
  paidMinor: "0",
  reconciledMinor: "0",
  allocations: [{ fundId: "youth", amountMinor: total }],
  extraction: null,
  ...extra,
});
const initialState: Snapshot = {
  organization: "Tidepath Family Alliance",
  operator: "Bookkeeper · sample",
  currency: "USD",
  storageEngine: "sample workspace",
  funds: [
    {
      id: "youth",
      name: "Safe Futures workshops",
      code: "SF-2026",
      budgetMinor: "2400000",
      usedMinor: "14000",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      categories: ["Workshop supplies", "Printing", "Travel"],
      restrictions:
        "School safety and mental health workshops. Supplies, printing and local travel.",
    },
    {
      id: "community",
      name: "Community care",
      code: "CC-2026",
      budgetMinor: "1500000",
      usedMinor: "4815",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      categories: [],
      restrictions: "Unrestricted program support.",
    },
  ],
  expenses: [
    e("ft-1042", "Community Supply", "18475", {
      allocations: [
        { fundId: "youth", amountMinor: "14000" },
        { fundId: "community", amountMinor: "4475" },
      ],
    }),
    e("ft-1041", "Little River Print", "9240", {
      claimant: "Owen Rivera",
      category: "Printing",
      reviewed: true,
      revision: 1,
    }),
    e("ft-1040", "Community Transit", "4815", {
      claimant: "Marta Silva",
      category: "Travel",
      purpose: "Travel to the West Little River workshop",
      reviewed: true,
      approved: true,
      approver: "Claudette · sample",
      approvalReference: "Demo approval 1040",
      paidMinor: "2500",
      revision: 1,
      allocations: [{ fundId: "community", amountMinor: "4815" }],
    }),
    e("ft-1039", "Schoolhouse Materials", "14000", {
      claimant: "Owen Rivera",
      reviewed: true,
      approved: true,
      approver: "Claudette · sample",
      approvalReference: "Demo approval 1039",
      paidMinor: "14000",
      reconciledMinor: "14000",
      revision: 1,
    }),
    e("ft-1038", "New receipt", "6500", {
      merchant: "",
      claimant: "",
      purpose: "",
      expenseDate: "",
      allocations: [],
    }),
  ],
  payments: [
    {
      id: "pay-1040",
      expenseId: "ft-1040",
      amountMinor: "2500",
      reference: "DEMO-BANK-1040",
      date: "2026-10-24",
      reconciled: false,
    },
    {
      id: "pay-1039",
      expenseId: "ft-1039",
      amountMinor: "14000",
      reference: "DEMO-BANK-1039",
      date: "2026-10-23",
      reconciled: true,
    },
  ],
  events: [
    {
      id: 1,
      targetId: "ft-1042",
      action: "Original archived",
      detail: "Receipt added to the sample workspace.",
      at: "2026-10-22T10:35:00Z",
    },
  ],
};
let state: Snapshot = structuredClone(initialState);
let mode: "sample" | "personal" = "sample";
const importedOriginals = new Map<string, Original>();
let importedBytes = 0;
let importing = false;
const histories = new Map<string, RecordHistory>();
const copy = () => structuredClone(state);
let eventSequence = 10;
function event(id: string, action: string, detail: string) {
  state.events.unshift({
    id: ++eventSequence,
    targetId: id,
    action,
    detail,
    at: new Date().toISOString(),
  });
}
function totals() {
  for (const f of state.funds)
    f.usedMinor = state.expenses
      .filter((e) => e.approved)
      .flatMap((e) => e.allocations)
      .filter((a) => a.fundId === f.id)
      .reduce((n, a) => n + BigInt(a.amountMinor), 0n)
      .toString();
}
const receiptCache = new Map<string, number[]>();
const originalSeed = new Map(
  state.expenses.map((e) => [e.documentId, structuredClone(e)]),
);
export async function demoDocument(documentId: string): Promise<Original> {
  const imported = importedOriginals.get(documentId);
  if (imported) return { ...imported, bytes: Uint8Array.from(imported.bytes) };
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const exp = originalSeed.get(documentId);
  if (!exp) throw new Error("Sample document not found.");
  if (documentId === "doc-ft-1038" && !receiptCache.has(documentId)) {
    const canvas = document.createElement("canvas");
    canvas.width = 760;
    canvas.height = 1120;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "white";
    c.fillRect(0, 0, 760, 1120);
    c.fillStyle = "#222";
    const lines = [
      ["NEIGHBORHOOD SUPPLY", 110, 40],
      ["MIAMI, FL", 175, 25],
      ["SALES RECEIPT", 270, 28],
      ["10/22/2026", 330, 27],
      ["Workshop materials    $65.00", 460, 27],
      ["TOTAL                 $65.00", 600, 32],
      ["Customer: Marta Silva", 750, 26],
      ["marta@example.invalid", 795, 25],
      ["FICTIONAL SAMPLE RECEIPT", 1000, 20],
    ] as const;
    for (const [text, y, size] of lines) {
      c.font = `${size}px monospace`;
      c.fillText(text, 65, y);
    }
    const bytes = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) =>
          b ? resolve(b) : reject(new Error("Could not make sample image.")),
        "image/png",
      ),
    );
    const doc = await PDFDocument.create();
    const png = await doc.embedPng(await bytes.arrayBuffer());
    doc
      .addPage([380, 560])
      .drawImage(png, { x: 0, y: 0, width: 380, height: 560 });
    doc.setTitle("Synthetic scanned receipt");
    receiptCache.set(documentId, Array.from(await doc.save()));
  }

  if (!receiptCache.has(documentId)) {
    const doc = await PDFDocument.create();
    const p = doc.addPage([380, 560]);
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const mono = await doc.embedFont(StandardFonts.Courier);
    const txt = (s: string, x: number, y: number, size = 11, b = false) =>
      p.drawText(s, {
        x,
        y,
        size,
        font: b ? bold : regular,
        color: rgb(0.17, 0.21, 0.19),
      });
    const merchant = exp.merchant || "Neighborhood Supply";
    txt(merchant.toUpperCase(), 35, 505, 19, true);
    txt("MIAMI, FL  |  USD", 35, 481, 9);
    p.drawLine({
      start: { x: 35, y: 463 },
      end: { x: 345, y: 463 },
      thickness: 0.6,
      color: rgb(0.7, 0.74, 0.7),
    });
    txt("SALES RECEIPT", 35, 436, 10, true);
    txt(exp.expenseDate || "2026-10-22", 35, 413, 11);
    txt(`Receipt ${exp.id.toUpperCase()}`, 35, 393, 9);
    txt("Workshop materials", 35, 346, 12);
    p.drawText(`${(Number(exp.totalMinor) / 100).toFixed(2)}`, {
      x: 281,
      y: 346,
      size: 12,
      font: mono,
    });
    txt("Payment: personal card", 35, 318, 10);
    p.drawLine({
      start: { x: 35, y: 292 },
      end: { x: 345, y: 292 },
      thickness: 0.6,
      color: rgb(0.7, 0.74, 0.7),
    });
    txt("TOTAL", 35, 262, 17, true);
    txt(`$${(Number(exp.totalMinor) / 100).toFixed(2)}`, 252, 262, 17, true);
    txt("Customer: Marta Silva", 35, 214, 10);
    txt("marta@example.invalid", 35, 194, 10);
    txt("Thank you for supporting our community.", 35, 145, 10);
    txt("FICTIONAL SAMPLE - NO REAL TRANSACTION", 35, 66, 8);
    doc.setTitle("Synthetic receipt");
    receiptCache.set(documentId, Array.from(await doc.save()));
  }
  return {
    bytes: receiptCache.get(documentId)!,
    mime: "application/pdf",
    filename: exp.filename,
  };
}
export const demo = {
  snapshot: async () => copy(),
  mode: () => mode,
  async startPersonal() {
    if (importing)
      throw new Error(
        "Let the current import finish before changing workspaces.",
      );
    mode = "personal";
    state = {
      organization: "Your receipt workspace",
      operator: "You",
      currency: "USD",
      storageEngine: "temporary browser session",
      funds: [],
      expenses: [],
      payments: [],
      events: [],
    };
    importedOriginals.clear();
    importedBytes = 0;
    histories.clear();
    receiptCache.clear();
    originalSeed.clear();
    return copy();
  },
  async startSample() {
    if (importing)
      throw new Error(
        "Let the current import finish before changing workspaces.",
      );
    mode = "sample";
    state = structuredClone(initialState);
    importedOriginals.clear();
    importedBytes = 0;
    histories.clear();
    receiptCache.clear();
    originalSeed.clear();
    state.expenses.forEach((e) =>
      originalSeed.set(e.documentId, structuredClone(e)),
    );
    return copy();
  },
  async importFiles(files: File[]): Promise<ImportResult> {
    if (mode !== "personal")
      throw new Error("Start a personal receipt session before importing.");
    if (importing) throw new Error("Another import is still finishing.");
    if (files.length > 20)
      throw new Error("Choose up to 20 receipts at a time.");
    importing = true;
    const result: ImportResult = { outcomes: [], failures: [] };
    try {
      for (const file of files) {
        try {
          if (file.size > 20 * 1024 * 1024)
            throw new Error("This file exceeds 20 MB.");
          const bytes = new Uint8Array(await file.arrayBuffer());
          const { mime } = inspectReceipt(bytes);
          const hash = await receiptHash(bytes);
          const duplicate = state.expenses.find((e) => e.hash === hash);
          if (duplicate) {
            result.outcomes.push({ expenseId: duplicate.id, duplicate: true });
            continue;
          }
          if (importedBytes + bytes.byteLength > MAX_SESSION_BYTES)
            throw new Error(
              "This tab holds 100 MB of originals. Export your work and begin another session.",
            );
          const id = crypto.randomUUID();
          const documentId = crypto.randomUUID();
          const filename = file.name.split(/[\\/]/).at(-1) || "receipt";
          importedOriginals.set(documentId, { bytes, mime, filename });
          importedBytes += bytes.byteLength;
          const receipt = e(id, "", "0", {
            documentId,
            filename,
            mime,
            hash,
            claimant: "",
            purpose: "",
            expenseDate: "",
            allocations: [],
          });
          state.expenses.unshift(receipt);
          event(
            id,
            "Original added to this tab",
            "Original bytes retained in memory. Reloading or closing this page clears the session.",
          );
          result.outcomes.push({ expenseId: id, duplicate: false });
        } catch (error) {
          result.failures.push({
            filename: file.name,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return result;
    } finally {
      importing = false;
    }
  },
  async history(id: string) {
    return structuredClone(
      histories.get(id) || { reviews: [], extractions: [] },
    );
  },
  async saveReview(input: ReviewInput) {
    const x = state.expenses.find((e) => e.id === input.id)!;
    if (!x) throw new Error("This receipt is no longer in the session.");
    if (x.revision !== input.expectedRevision)
      throw new Error("This claim changed. Reload before saving.");
    if (BigInt(x.paidMinor) > 0n)
      throw new Error(
        "Paid claims need a reversal before changing the review.",
      );
    checkReview(input, state);
    const history = histories.get(x.id) || { reviews: [], extractions: [] };
    history.reviews.unshift({
      revision: x.revision + 1,
      payload: structuredClone(input),
      at: new Date().toISOString(),
    });
    histories.set(x.id, history);
    Object.assign(x, input, {
      revision: x.revision + 1,
      approved: false,
      approver: "",
      approvalReference: "",
    });
    event(
      x.id,
      input.reviewed ? "Review completed" : "Draft saved",
      "New revision saved; earlier approval cleared.",
    );
    totals();
    return copy();
  },
  async addFund(input: FundInput) {
    checkFund(input);
    if (state.funds.some((f) => f.code === input.code))
      throw new Error("That grant code already exists.");
    state.funds.push({ ...input, id: crypto.randomUUID(), usedMinor: "0" });
    event(
      "funds",
      "Fund created",
      "Opening budget and configured rules added.",
    );
    return copy();
  },
  async approve(
    id: string,
    revision: number,
    approver: string,
    reference: string,
  ) {
    const x = state.expenses.find((e) => e.id === id)!;
    if (!x) throw new Error("Receipt not found.");
    if (x.approved)
      throw new Error("Approval is already recorded for this revision.");
    if (!x.reviewed || x.revision !== revision)
      throw new Error("Review the current revision first.");
    if (!approver.trim() || !reference.trim())
      throw new Error("Enter the approver and external evidence reference.");
    for (const a of x.allocations) {
      const f = state.funds.find((f) => f.id === a.fundId)!;
      if (x.expenseDate < f.periodStart || x.expenseDate > f.periodEnd)
        throw new Error("The receipt is outside this grant period.");
      if (f.categories.length && !f.categories.includes(x.category))
        throw new Error("This category is outside the configured grant rules.");
      if (BigInt(f.usedMinor) + BigInt(a.amountMinor) > BigInt(f.budgetMinor))
        throw new Error("This exceeds the recorded grant budget.");
    }
    Object.assign(x, {
      approved: true,
      approver,
      approvalReference: reference,
    });
    event(id, "External approval recorded", `Applies to revision ${revision}.`);
    totals();
    return copy();
  },
  async pay(id: string, amountMinor: string, reference: string, date: string) {
    const x = state.expenses.find((e) => e.id === id)!;
    if (!x) throw new Error("Receipt not found.");
    if (!validDate(date)) throw new Error("Choose a valid payment date.");
    const n = minor(amountMinor);
    if (!x.approved) throw new Error("Record approval first.");
    if (n <= 0n || n > BigInt(x.eligibleMinor) - BigInt(x.paidMinor))
      throw new Error("Check the amount still owed.");
    if (
      !reference.trim() ||
      state.payments.some(
        (p) => p.expenseId === id && p.reference === reference,
      )
    )
      throw new Error("Enter a new external payment reference.");
    state.payments.unshift({
      id: crypto.randomUUID(),
      expenseId: id,
      amountMinor,
      reference,
      date,
      reconciled: false,
    });
    x.paidMinor = (BigInt(x.paidMinor) + n).toString();
    event(
      id,
      "Payment recorded",
      "External confirmation recorded; bank reconciliation remains separate.",
    );
    return copy();
  },
  async reconcile(id: string) {
    const p = state.payments.find((p) => p.id === id)!;
    if (!p.reconciled) {
      p.reconciled = true;
      const e = state.expenses.find((e) => e.id === p.expenseId)!;
      e.reconciledMinor = (
        BigInt(e.reconciledMinor) + BigInt(p.amountMinor)
      ).toString();
      event(
        e.id,
        "Bank reconciliation recorded",
        mode === "sample"
          ? "Sample bank record checked."
          : "External bank record confirmed by the local operator.",
      );
    }
    return copy();
  },
  async extraction(id: string, data: Expense["extraction"]) {
    if (!state.expenses.some((e) => e.id === id))
      throw new Error("This receipt is no longer in the session.");
    const history = histories.get(id) || { reviews: [], extractions: [] };
    if (data)
      history.extractions.unshift({
        id: Date.now(),
        payload: structuredClone(data),
        at: new Date().toISOString(),
      });
    histories.set(id, history);
    state.expenses.find((e) => e.id === id)!.extraction = data;
    event(
      id,
      "Local extraction completed",
      "Suggestions kept separate from the reviewed values.",
    );
    return copy();
  },
  async addReceipt() {
    if (mode !== "sample")
      throw new Error("Sample receipts belong in the demo workspace.");
    const id = `ft-${1043 + state.expenses.length - 5}`;
    const receipt = e(id, "", "10800", {
      claimant: "",
      purpose: "",
      expenseDate: "",
      allocations: [],
    });
    state.expenses.unshift(receipt);
    originalSeed.set(receipt.documentId, structuredClone(receipt));
    event(id, "Original archived", "Receipt added to the sample workspace.");
    return [{ expenseId: id, duplicate: false }];
  },
  async exportPreview(spec: ExportSpec, organization?: string) {
    return makeExportPreview(
      structuredClone(state),
      spec,
      mode === "personal"
        ? (organization ?? state.organization)
        : state.organization,
    );
  },
  async report(profile: Profile) {
    return makeExportPreview(structuredClone(state), {
      kind: "report",
      profile,
    });
  },
};
