import { useEffect, useState } from "react";
import { ChevronDown, FileCheck2, ScanText } from "lucide-react";
import { api } from "./api";
import { money } from "./money";
import type { Expense, RecordHistory as History, Snapshot } from "./types";
export function RecordHistory({
  expense,
  data,
}: {
  expense: Expense;
  data: Snapshot;
}) {
  const [history, setHistory] = useState<History>();
  const [error, setError] = useState("");
  useEffect(() => {
    let dead = false;
    setHistory(undefined);
    void api
      .history(expense.id)
      .then((x) => {
        if (!dead) setHistory(x);
      })
      .catch((e) => {
        if (!dead) setError(String(e));
      });
    return () => {
      dead = true;
    };
  }, [expense.id, expense.revision, expense.extraction]);
  return (
    <section className="surface revision-history">
      <div className="surface-heading">
        <div>
          <h2>Saved record versions</h2>
          <p>
            {expense.merchant || expense.filename} · original document remains
            unchanged
          </p>
        </div>
      </div>
      {error && <p className="empty-inline form-error">{error}</p>}
      {!history && !error && (
        <p className="empty-inline">Loading the local history…</p>
      )}
      {history && (
        <>
          <div className="history-group">
            <h3>
              <FileCheck2 size={16} />
              Human-reviewed values
            </h3>
            {history.reviews.map((r) => (
              <details key={r.revision}>
                <summary>
                  <span>
                    Revision {r.revision}
                    <small>
                      {r.payload.reviewed ? "Marked reviewed" : "Draft"} ·{" "}
                      {new Date(r.at).toLocaleString()}
                    </small>
                  </span>
                  <ChevronDown size={16} />
                </summary>
                <dl className="details-list">
                  <dt>Merchant</dt>
                  <dd>{r.payload.merchant || "Not entered"}</dd>
                  <dt>Recipient</dt>
                  <dd>{r.payload.claimant || "Not entered"}</dd>
                  <dt>Purpose</dt>
                  <dd>{r.payload.purpose || "Not entered"}</dd>
                  <dt>Receipt total</dt>
                  <dd>{money(r.payload.totalMinor)}</dd>
                  <dt>Eligible</dt>
                  <dd>{money(r.payload.eligibleMinor)}</dd>
                  <dt>Fund allocations</dt>
                  <dd>
                    {r.payload.allocations.map((a) => (
                      <div key={a.fundId}>
                        {data.funds.find((f) => f.id === a.fundId)?.code} ·{" "}
                        {money(a.amountMinor)}
                      </div>
                    ))}
                  </dd>
                </dl>
              </details>
            ))}
            {!history.reviews.length && (
              <p>
                No review revisions stored for this record
                {!expense.revision ? " yet" : " in this sample"}.
              </p>
            )}
          </div>
          <div className="history-group">
            <h3>
              <ScanText size={16} />
              Extraction runs
            </h3>
            {history.extractions.map((r) => (
              <details key={r.id}>
                <summary>
                  <span>
                    {r.payload.engine}
                    <small>
                      Page {r.payload.page} · {new Date(r.at).toLocaleString()}
                    </small>
                  </span>
                  <ChevronDown size={16} />
                </summary>
                <p className="history-disclaimer">
                  Machine suggestions, preserved independently of reviewed
                  values.
                </p>
                <pre>{r.payload.text}</pre>
              </details>
            ))}
            {!history.extractions.length && (
              <p>No extraction runs stored yet.</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
