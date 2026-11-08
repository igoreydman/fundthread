import { invoke, isTauri } from "@tauri-apps/api/core";
import { demo, demoDocument } from "./demo";
import { exportPreview as expectedExport } from "./exports";
import { parseCsv } from "./money";
import type { ImportResult } from "./receiptImport";
import type {
  Box,
  ExportSpec,
  Expense,
  FundInput,
  Original,
  Profile,
  RecordHistory,
  Report,
  ReviewInput,
  Snapshot,
} from "./types";
export const desktop = isTauri();
const sampleMasks = new Map<string, Box[]>();
let writes = Promise.resolve();
let exportOrganization = "";
// Keep draft/extraction snapshots in mutation order; native revision checks
// still reject edits made concurrently by another client.
function write<T>(action: () => Promise<T>): Promise<T> {
  const result = writes.then(action);
  writes = result.then(
    () => {},
    () => {},
  );
  return result;
}
export const api = {
  exportOrganization: () => exportOrganization,
  setExportOrganization: (name: string) => {
    exportOrganization = name;
  },
  browserMode: () => (desktop ? ("desktop" as const) : demo.mode()),
  async startPersonal() {
    const state = await demo.startPersonal();
    sampleMasks.clear();
    exportOrganization = "";
    return state;
  },
  async startSample() {
    const state = await demo.startSample();
    sampleMasks.clear();
    exportOrganization = "";
    return state;
  },
  importFiles: (files: File[]) => demo.importFiles(files),
  status: () =>
    desktop
      ? invoke<{ exists: boolean; unlocked: boolean }>("workspace_status")
      : Promise.resolve({ exists: true, unlocked: true }),
  create: (organization: string, operator: string) =>
    invoke<Snapshot>("create_workspace", {
      organization,
      operator,
    }),
  unlock: () => invoke<Snapshot>("unlock_workspace"),
  lock: () => (desktop ? invoke<void>("lock_workspace") : Promise.resolve()),
  snapshot: () =>
    desktop ? invoke<Snapshot>("get_snapshot") : demo.snapshot(),
  document: (documentId: string) =>
    desktop
      ? invoke<Original>("get_document", { documentId })
      : demoDocument(documentId),
  import: () =>
    desktop
      ? invoke<ImportResult>("pick_receipts")
      : demo.addReceipt().then((outcomes) => ({ outcomes, failures: [] })),
  save: (input: ReviewInput) =>
    write(() =>
      desktop
        ? invoke<Snapshot>("save_review", { input })
        : demo.saveReview(input),
    ),
  fund: (input: FundInput) =>
    desktop ? invoke<Snapshot>("add_fund", { input }) : demo.addFund(input),
  approve: (
    expenseId: string,
    revision: number,
    approver: string,
    reference: string,
  ) =>
    desktop
      ? invoke<Snapshot>("record_approval", {
          expenseId,
          revision,
          approver,
          reference,
        })
      : demo.approve(expenseId, revision, approver, reference),
  pay: (
    expenseId: string,
    amountMinor: string,
    reference: string,
    date: string,
  ) =>
    desktop
      ? invoke<Snapshot>("record_payment", {
          expenseId,
          amountMinor,
          reference,
          date,
        })
      : demo.pay(expenseId, amountMinor, reference, date),
  reconcile: (paymentId: string) =>
    desktop
      ? invoke<Snapshot>("reconcile_payment", { paymentId })
      : demo.reconcile(paymentId),
  extraction: (expenseId: string, data: Expense["extraction"]) =>
    write(() =>
      desktop
        ? invoke<Snapshot>("save_extraction", { expenseId, data })
        : demo.extraction(expenseId, data),
    ),
  history: (expenseId: string) =>
    desktop
      ? invoke<RecordHistory>("get_history", { expenseId })
      : demo.history(expenseId),
  privacyPlan: (documentId: string) =>
    desktop
      ? invoke<Box[]>("get_privacy_plan", { documentId })
      : Promise.resolve(structuredClone(sampleMasks.get(documentId) || [])),
  savePrivacyPlan: (documentId: string, regions: Box[]) =>
    desktop
      ? invoke<void>("save_privacy_plan", { documentId, regions })
      : Promise.resolve(
          sampleMasks.set(documentId, structuredClone(regions)),
        ).then(() => {}),
  async previewExport(
    spec: ExportSpec,
    organization?: string,
    expectedState?: Snapshot,
  ) {
    const report = desktop
      ? await invoke<Report>("preview_export", { spec })
      : await demo.exportPreview(spec, organization);
    if (expectedState) {
      const expected = await expectedExport(
        expectedState,
        spec,
        desktop
          ? expectedState.organization
          : (organization ?? expectedState.organization),
      );
      if (
        expected.organization !== report.organization ||
        JSON.stringify(expected.rows) !== JSON.stringify(report.rows)
      )
        throw new Error(
          "Records changed. Refresh the workspace before previewing this export.",
        );
    }
    return report;
  },
  report: (profile: Profile, organization?: string) =>
    api.previewExport({ kind: "report", profile }, organization),
  async saveExport(report: Report, format: "csv" | "pdf", bytes?: Uint8Array) {
    if (desktop)
      return invoke<boolean>("save_export", {
        spec: report.spec,
        revisionToken: report.revisionToken,
        format,
        bytes: format === "pdf" ? Array.from(bytes ?? []) : [],
      });
    const current = await demo.exportPreview(report.spec, report.organization);
    if (
      current.revisionToken !== report.revisionToken ||
      current.csv !== report.csv ||
      JSON.stringify(current.rows) !== JSON.stringify(report.rows) ||
      current.organization !== report.organization
    )
      throw new Error(
        "Records or report details changed. Preview the export again.",
      );
    if (
      format === "pdf" &&
      (!bytes ||
        bytes.length > 100 * 1024 * 1024 ||
        new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    )
      throw new Error("Preview the PDF before saving it.");
    const label =
      report.spec.kind === "report" ? report.spec.profile : "analytics";
    download(
      format === "csv" ? new TextEncoder().encode(report.csv) : bytes!,
      `fundthread-${label}${demo.mode() === "sample" ? "-sample" : ""}.${format}`,
      format === "csv" ? "text/csv" : "application/pdf",
    );
    return true;
  },
  async writeReport(profile: Profile, report: Report) {
    if (report.spec.kind !== "report" || report.spec.profile !== profile)
      throw new Error("Preview the selected audience again.");
    return api.saveExport(report, "csv");
  },
  async writePdf(e: Expense, bytes: Uint8Array, confirmed: boolean) {
    if (desktop)
      return invoke<boolean>("write_reviewed_pdf", {
        expenseId: e.id,
        revision: e.revision,
        bytes: Array.from(bytes),
        confirmed,
      });
    if (!confirmed)
      throw new Error("Review every page and confirm this export first.");
    const current = (await demo.snapshot()).expenses.find((x) => x.id === e.id);
    if (
      !current ||
      current.documentId !== e.documentId ||
      current.revision !== e.revision
    )
      throw new Error(
        "Records changed. Open the receipt and review the export again.",
      );
    download(
      bytes,
      `reviewed-${e.id}${demo.mode() === "sample" ? "-sample" : ""}.pdf`,
      "application/pdf",
    );
    return true;
  },
};
function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes)], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
