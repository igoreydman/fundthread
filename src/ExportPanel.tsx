import { useEffect, useRef, useState, type ReactNode } from "react";
import { Download, FileSpreadsheet, RefreshCw } from "lucide-react";
import { api, desktop } from "./api";
import { money } from "./money";
import { reportRows } from "./exports";
import { summarizeReport } from "./reportSummary";
import { prepareReportPdf, type PreparedPdf } from "./reportPdf";
import type { ExportSpec, Report, Snapshot } from "./types";

export function ExportPanel({
  data,
  spec,
  notify,
  onData,
  prepareLabel,
  recipientControls,
}: {
  prepareLabel?: string;
  recipientControls?: ReactNode;
  data: Snapshot;
  spec: ExportSpec;
  notify: (message: string, error?: boolean) => void;
  onData: (data: Snapshot) => void;
}) {
  const [organization, setOrganization] = useState(
    api.exportOrganization() || data.organization,
  );
  const [report, setReport] = useState<Report>();
  const [pdf, setPdf] = useState<PreparedPdf>();
  const [pdfError, setPdfError] = useState("");
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  const key = JSON.stringify(spec);
  const editableName = !desktop && api.browserMode() === "personal";
  const name = editableName ? organization : data.organization;
  const context = useRef({ data, key, name });
  context.current = { data, key, name };
  useEffect(
    () => setOrganization(api.exportOrganization() || data.organization),
    [data.organization],
  );
  useEffect(() => {
    generation.current++;
    setReport(undefined);
    setPdf(undefined);
    setChecked(false);
    setMessage("");
    setPdfError("");
    setBusy(false);
  }, [data, key, name]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const rows = spec.kind === "report" ? reportRows(data, spec.profile) : [];
  const summary = spec.kind === "report" ? summarizeReport(rows) : null;
  const labels: Record<string, string> = {
    claim_id: "Claim",
    revision: "Revision",
    expense_date: "Receipt date",
    fund_code: "Fund",
    currency: "Currency",
    approved_allocation_minor: "Approved · USD",
    payment_status: "Payment",
    merchant: "Merchant",
    purpose: "Purpose",
    claimant: "Person reimbursed",
    approver: "Approver",
    approval_reference: "Approval reference",
  };
  const active = (id: number, captured: typeof context.current) =>
    generation.current === id &&
    context.current.data === captured.data &&
    context.current.key === captured.key &&
    context.current.name === captured.name;
  async function preview() {
    const id = ++generation.current,
      captured = context.current;
    setBusy(true);
    setChecked(false);
    setReport(undefined);
    setPdf(undefined);
    setPdfError("");
    setMessage("");
    try {
      const result = await api.previewExport(spec, name, data);
      if (!active(id, captured)) return;
      setReport(result);
      try {
        const prepared = await prepareReportPdf(result, () =>
          active(id, captured),
        );
        if (active(id, captured)) setPdf(prepared);
      } catch (error) {
        if (active(id, captured)) setPdfError(String(error));
      }
    } catch (error) {
      if (active(id, captured)) {
        setMessage(String(error));
        notify(String(error), true);
      }
    } finally {
      if (active(id, captured)) setBusy(false);
    }
  }
  async function save(format: "csv" | "pdf") {
    if (
      !checked ||
      !report ||
      busy ||
      (format === "pdf" && (!pdf || pdf.token !== report.revisionToken))
    )
      return;
    setBusy(true);
    setMessage("");
    const id = generation.current,
      captured = context.current;
    try {
      const saved = await api.saveExport(report, format, pdf?.bytes);
      if (!active(id, captured)) return;
      const outcome = saved
        ? `${format.toUpperCase()} ${desktop ? "saved" : "download started"}.`
        : "Save canceled.";
      setMessage(outcome);
      if (saved) notify(outcome);
    } catch (error) {
      if (!active(id, captured)) return;
      setChecked(false);
      setMessage(String(error));
      notify(String(error), true);
      if (/changed|preview.*again/i.test(String(error))) {
        setReport(undefined);
        setPdf(undefined);
      }
    } finally {
      if (active(id, captured)) setBusy(false);
    }
  }
  return (
    <section
      className={`surface report-preview composed-export ${pdf ? "has-document" : "no-document"} ${spec.kind}`}
    >
      <div className="export-control-column">
        <div className="surface-heading">
          <div>
            <h2>
              {spec.kind === "analytics"
                ? "Export this view"
                : "Share this report"}
            </h2>
            <p>
              {spec.kind === "analytics"
                ? "Aggregate analytics · selected receipt dates · no claimant or receipt ID columns"
                : "Approved allocations · USD"}
            </p>
          </div>
          <button
            className={`button ${report ? "secondary" : "primary"}`}
            disabled={busy}
            onClick={() => void preview()}
          >
            <FileSpreadsheet size={16} />
            {busy
              ? "Preparing preview…"
              : report
                ? "Refresh export"
                : spec.kind === "analytics"
                  ? "Prepare analytics export"
                  : prepareLabel || "Prepare report"}
          </button>
        </div>
        {recipientControls}
        {editableName && (
          <label className="letterhead-name">
            Organization name for this export
            <input
              value={organization}
              maxLength={4000}
              onChange={(event) => {
                setOrganization(event.target.value);
                api.setExportOrganization(event.target.value);
              }}
              autoComplete="organization"
            />
          </label>
        )}
        {report && (
          <>
            <section
              className="recipient-summary report-scope"
              aria-label="Report sharing summary"
            >
              <div>
                <span className="eyebrow">{report.organization}</span>
                <h3>
                  {spec.kind === "analytics"
                    ? "Aggregate analytics"
                    : spec.profile === "funder"
                      ? "Funder · minimal fields"
                      : "Bookkeeper · includes identity fields"}
                </h3>
                <p>
                  {spec.kind === "analytics"
                    ? "Approved expense, receipt totals, paid and owed amounts remain separate. Undated receipts are identified."
                    : spec.profile === "funder"
                      ? "Includes claim IDs, dates and fund codes. Names, purpose and original receipts are excluded."
                      : "Includes claimant, merchant, purpose and approval references."}
                </p>
              </div>
              {spec.kind === "report" && spec.profile === "funder" && (
                <small>This report is not anonymous.</small>
              )}
            </section>
            {pdfError && (
              <p className="export-message" role="alert">
                {pdfError} CSV is still available.
              </p>
            )}
            <div className="export-confirm">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                <span>
                  I’ve checked the fields and recipients for this export.
                </span>
              </label>
              <div className="export-actions">
                <button
                  className="button secondary"
                  disabled={!checked || busy}
                  onClick={() => void save("csv")}
                >
                  <Download size={16} />
                  Save CSV
                </button>
                <button
                  className="button primary"
                  disabled={!checked || busy || !pdf}
                  onClick={() => void save("pdf")}
                >
                  <Download size={16} />
                  Save PDF
                </button>
              </div>
            </div>
          </>
        )}
        {message && (
          <p className="export-message" role="status">
            {message}
          </p>
        )}
        {/changed|connection/i.test(message) && (
          <button
            className="text-button export-refresh"
            onClick={async () => {
              try {
                onData(await api.snapshot());
              } catch (error) {
                notify(String(error), true);
              }
            }}
          >
            <RefreshCw size={14} />
            Refresh workspace records
          </button>
        )}
      </div>
      <div className="export-document-column">
        {" "}
        {pdf && (
          <div className="pdf-preview selected-pdf-stage">
            <div className="pdf-stage-heading">
              PDF letterhead preview · {pdf.pages.length}{" "}
              {pdf.pages.length === 1 ? "page" : "pages"}
            </div>
            <div className="pdf-pages">
              {pdf.pages.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={`Rendered ${spec.kind === "analytics" ? "analytics" : "recipient report"} PDF page ${i + 1}`}
                />
              ))}
            </div>
            <p>PDF pages are rendered images. Use CSV for editable data.</p>
          </div>
        )}
        {spec.kind === "report" && (
          <div className="report-human-table">
            <div className="report-human-summary">
              <strong>
                {summary ? money(summary.approvedMinor) : "—"} approved
              </strong>
              <span>
                {summary?.claims || 0} claims · {summary?.allocations || 0}{" "}
                allocation rows
              </span>
            </div>
            <div className="table-scroll">
              <table aria-label="Recipient report rows">
                <thead>
                  <tr>
                    {rows[0]?.map((h, i) =>
                      h === "currency" ? null : (
                        <th key={i}>{labels[h] || h.replaceAll("_", " ")}</th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(1).map((r, i) => (
                    <tr key={i}>
                      {r.map((value, j) =>
                        rows[0][j] === "currency" ? null : (
                          <td key={j}>
                            {rows[0][j].endsWith("_minor")
                              ? money(value)
                              : value}
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length === 1 && (
              <p className="empty-inline">
                No approved allocations for this recipient yet.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
