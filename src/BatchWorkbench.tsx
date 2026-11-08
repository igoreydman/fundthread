import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  ScanText,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { api, desktop } from "./api";
import {
  batchInput,
  batchSeed,
  batchSuggestions,
  type BatchDraft,
} from "./batchDraft";
import { readOriginal } from "./localReceipt";
import { AllocationStrip } from "./AllocationStrip";
import { DocumentView } from "./DocumentView";
import { Modal } from "./Modal";
import { ReviewDesk, status, type ReviewHandle } from "./ReviewDesk";
import { conflictingTotals } from "./receiptAmounts";
import { money } from "./money";
import { CATEGORIES, type Box, type Expense, type Snapshot } from "./types";

type ReadState = {
  phase: "reading" | "failed" | "done";
  progress?: number | null;
  error?: string;
};
type RowHandle = {
  pending: () => boolean;
  flush: () => Promise<void>;
  discard: () => Promise<void>;
};
type Props = {
  data: Snapshot;
  onData: (s: Snapshot) => void;
  onDirty: (dirty: boolean) => void;
  notify: (text: string, error?: boolean) => void;
  onPrivacy: (e: Expense) => void;
  onPay: (e: Expense) => void;
  onFund: () => void;
  onImport: () => void;
};
export const BatchWorkbench = forwardRef<ReviewHandle, Props>(
  function BatchWorkbench(
    { data, onData, onDirty, notify, onPrivacy, onPay, onFund, onImport },
    ref,
  ) {
    const [query, setQuery] = useState("");
    const [activeRow, setActiveRow] = useState("");
    const [scrolled, setScrolled] = useState(false);
    const [filter, setFilter] = useState("all");
    const [reads, setReads] = useState<Record<string, ReadState>>({});
    const [tick, setTick] = useState(0);
    const [source, setSource] = useState<{ id: string; box?: Box }>();
    const [detail, setDetail] = useState<string>();
    const [detailDirty, setDetailDirty] = useState(false);
    const [leavingDetail, setLeavingDetail] = useState(false);
    const [rowDirty, setRowDirty] = useState<Record<string, boolean>>({});
    const handles = useRef(new Map<string, RowHandle>());
    const detailHandle = useRef<ReviewHandle>(null);
    const attempted = useRef(new Set<string>());
    const currentRead = useRef<AbortController | null>(null);
    const alive = useRef(true);
    const search = useRef<HTMLInputElement>(null);
    const updateRef = useRef(onData);
    updateRef.current = onData;
    const autoRead = desktop || api.browserMode() === "personal";
    const dirty = detailDirty || Object.values(rowDirty).some(Boolean);
    useEffect(() => {
      onDirty(dirty);
    }, [dirty, onDirty]);
    useEffect(() => {
      alive.current = true;
      return () => {
        alive.current = false;
        currentRead.current?.abort();
      };
    }, []);
    useEffect(() => {
      const key = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
          e.preventDefault();
          search.current?.focus();
        }
      };
      window.addEventListener("keydown", key);
      return () => window.removeEventListener("keydown", key);
    }, []);
    useEffect(() => {
      if (!autoRead || currentRead.current) return;
      const next = data.expenses.find(
        (e) => !e.extraction && !e.reviewed && !attempted.current.has(e.id),
      );
      if (!next) return;
      attempted.current.add(next.id);
      const controller = new AbortController();
      currentRead.current = controller;
      setReads((s) => ({ ...s, [next.id]: { phase: "reading", progress: 0 } }));
      void (async () => {
        try {
          const result = await readOriginal(next, controller.signal, (n) => {
            if (alive.current && !controller.signal.aborted)
              setReads((s) => ({
                ...s,
                [next.id]: { phase: "reading", progress: n },
              }));
          });
          if (!alive.current || controller.signal.aborted) return;
          const state = await api.extraction(next.id, result);
          if (!alive.current || controller.signal.aborted) return;
          updateRef.current(state);
          setReads((s) => ({ ...s, [next.id]: { phase: "done" } }));
        } catch (error) {
          if (alive.current && !controller.signal.aborted)
            setReads((s) => ({
              ...s,
              [next.id]: { phase: "failed", error: String(error) },
            }));
        } finally {
          if (controller.signal.aborted) {
            attempted.current.delete(next.id);
            if (alive.current)
              setReads((s) => {
                const copy = { ...s };
                delete copy[next.id];
                return copy;
              });
          }
          if (currentRead.current === controller) currentRead.current = null;
          if (alive.current) setTick((t) => t + 1);
        }
      })();
    }, [data.expenses, tick, autoRead]);
    async function flush() {
      do {
        for (const h of handles.current.values()) await h.flush();
      } while ([...handles.current.values()].some((h) => h.pending()));
      if (detailDirty) await detailHandle.current?.saveDraft();
    }
    useImperativeHandle(ref, () => ({
      saveDraft: flush,
      discardDrafts: async () => {
        for (const h of handles.current.values()) await h.discard();
        setDetail(undefined);
        setDetailDirty(false);
      },
    }));
    const queued = autoRead
      ? data.expenses.filter(
          (e) => !e.extraction && !e.reviewed && !attempted.current.has(e.id),
        ).length
      : 0;
    const working = Object.values(reads).some((s) => s.phase === "reading");
    const attention = (e: Expense) =>
      !e.reviewed &&
      (!e.merchant ||
        !e.expenseDate ||
        BigInt(e.totalMinor) === 0n ||
        conflictingTotals(e.extraction).length > 0 ||
        reads[e.id]?.phase === "failed");
    const visible = data.expenses.filter(
      (e) =>
        `${e.merchant} ${e.filename} ${e.claimant} ${e.purpose}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (filter === "all" ||
          (filter === "attention" && attention(e)) ||
          (filter === "review" && !e.reviewed) ||
          (filter === "decision" && e.reviewed && !e.approved)),
    );
    const sourceExpense = data.expenses.find((e) => e.id === source?.id);
    const detailExpense = data.expenses.find((e) => e.id === detail);
    function closeDetail() {
      if (detailDirty) setLeavingDetail(true);
      else setDetail(undefined);
    }
    return (
      <section className="batch-workbench" aria-label="Receipt workbench">
        <div className="batch-title">
          <div>
            <h1>
              <svg
                className="ledger-mark"
                viewBox="0 0 28 28"
                aria-hidden="true"
              >
                <path
                  d="M6 3v16c0 3 2 5 5 5h11M6 9h11c3 0 5 2 5 5s-2 5-5 5H6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M3 3h6M19 24h6"
                  stroke="var(--terracotta)"
                  strokeWidth="3"
                />
              </svg>
              Receipts <span>{data.expenses.length}</span>
            </h1>
          </div>
          <div className="batch-progress" aria-live="polite">
            <span className={working ? "reading-pulse" : ""} />
            {working
              ? `Reading locally · ${queued} queued`
              : queued
                ? `${queued} queued`
                : `${data.expenses.filter((e) => e.reviewed).length} reviewed · ${data.expenses.filter((e) => e.reviewed && !e.approved).length} awaiting decision`}
          </div>
        </div>
        <div className="batch-toolbar">
          <div className="batch-filters" aria-label="Receipt stages">
            {[
              ["all", "All", data.expenses.length],
              [
                "attention",
                "Check fields",
                data.expenses.filter(attention).length,
              ],
              [
                "review",
                "To review",
                data.expenses.filter((e) => !e.reviewed).length,
              ],
              [
                "decision",
                "Decisions",
                data.expenses.filter((e) => e.reviewed && !e.approved).length,
              ],
            ].map(([id, label, count]) => (
              <button
                key={id}
                aria-pressed={filter === id}
                onClick={() => setFilter(String(id))}
              >
                {label}
                <span>{count}</span>
              </button>
            ))}
          </div>
          <label className="batch-search">
            <Search size={15} />
            <input
              ref={search}
              aria-label="Search receipts"
              placeholder="Find a receipt"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {!data.funds.length && (
          <div className="batch-fund-note">
            <span>Connect a fund before completing a review.</span>
            <button className="text-button" onClick={onFund}>
              <Plus size={14} />
              Add fund
            </button>
          </div>
        )}
        {scrolled && activeRow && (
          <div className="batch-active-context" role="status">
            <strong>
              {data.expenses.find((e) => e.id === activeRow)?.merchant ||
                "Receipt"}
            </strong>
            <span>
              {data.expenses.find((e) => e.id === activeRow)?.filename}
            </span>
          </div>
        )}
        <div
          className="batch-table-scroll"
          onScroll={(event) => setScrolled(event.currentTarget.scrollLeft > 70)}
          onFocusCapture={(event) => {
            const row = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-expense-id]",
            );
            if (row) setActiveRow(row.dataset.expenseId || "");
          }}
        >
          <table className="batch-table">
            <caption className="visually-hidden">
              Receipt details. Unfinished drafts save automatically; review and
              decisions are explicit.
            </caption>
            <thead>
              <tr>
                <th scope="col">Receipt / merchant</th>
                <th scope="col">Receipt date</th>
                <th scope="col" className="batch-amount">
                  Total · USD
                </th>
                <th scope="col">Funding</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.expenses.map((e, index) => (
                <BatchRow
                  key={e.id}
                  visible={visible.some((x) => x.id === e.id)}
                  expense={e}
                  data={data}
                  index={index}
                  read={reads[e.id]}
                  queued={
                    autoRead &&
                    !e.extraction &&
                    !e.reviewed &&
                    !attempted.current.has(e.id)
                  }
                  register={(h) => {
                    if (h) handles.current.set(e.id, h);
                    else handles.current.delete(e.id);
                  }}
                  onDirty={(value) =>
                    setRowDirty((s) =>
                      s[e.id] === value ? s : { ...s, [e.id]: value },
                    )
                  }
                  onData={onData}
                  onSource={(box) => setSource({ id: e.id, box })}
                  onDetail={async () => {
                    try {
                      await handles.current.get(e.id)?.flush();
                      setDetail(e.id);
                    } catch {
                      /* row retains the failed draft */
                    }
                  }}
                  onRetry={() => {
                    attempted.current.delete(e.id);
                    setReads((s) => {
                      const next = { ...s };
                      delete next[e.id];
                      return next;
                    });
                    setTick((t) => t + 1);
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && (
          <div className="batch-empty">
            <FileText size={26} />
            <h2>
              {data.expenses.length
                ? "No matching receipts"
                : "Drop the whole pile here."}
            </h2>
            <p>
              {data.expenses.length
                ? "Try another filter or search."
                : "PDFs, photos and scans. Read locally, then check the details."}
            </p>
            {!data.expenses.length && (
              <button className="button primary" onClick={onImport}>
                Choose receipts <ArrowRight size={15} />
              </button>
            )}
          </div>
        )}
        <footer className="batch-foot">
          <span>
            {visible.length} of {data.expenses.length} receipts
          </span>
          <span>Page 1 suggestions · check every page before review</span>
        </footer>
        {sourceExpense && (
          <Modal
            title={`Original · ${sourceExpense.filename}`}
            className="source-dialog"
            subtitle="Check the original, then return to the same field."
            onClose={() => setSource(undefined)}
            wide
          >
            <div className="source-inspector">
              <div className="batch-source">
                <DocumentView expense={sourceExpense} highlight={source?.box} fitToPage />
              </div>
              <aside className="source-facts">
                <span className="source-record-label">
                  RECEIPT {sourceExpense.id.slice(-4).toUpperCase()}
                </span>
                <h2>{sourceExpense.merchant || "Unreviewed receipt"}</h2>
                <div className="source-key-amount">
                  {sourceExpense.revision === 0 &&
                  sourceExpense.totalMinor === "0"
                    ? "—"
                    : money(sourceExpense.totalMinor)}
                </div>
                <p className="source-amount-label">Receipt total · USD</p>
                <dl className="source-key-details">
                  <div>
                    <dt>Receipt date</dt>
                    <dd>{sourceExpense.expenseDate || "Date needed"}</dd>
                  </div>
                  <div>
                    <dt>Person reimbursed</dt>
                    <dd>{sourceExpense.claimant || "Not recorded"}</dd>
                  </div>
                </dl>
                <AllocationStrip
                  allocations={sourceExpense.allocations}
                  eligible={sourceExpense.eligibleMinor}
                  funds={data.funds}
                />
                <div className="source-purpose">
                  <span>Purpose</span>
                  <p>{sourceExpense.purpose || "Not recorded"}</p>
                </div>
                <span className="source-state">{status(sourceExpense)}</span>
              </aside>
            </div>
          </Modal>
        )}
        {detailExpense && (
          <Modal
            title={detailExpense.merchant || detailExpense.filename}
            subtitle="Split funding, record an external decision, or inspect the receipt."
            onClose={closeDetail}
            wide
          >
            <div className="batch-detail">
              <ReviewDesk
                ref={detailHandle}
                key={detailExpense.id}
                expense={detailExpense}
                data={data}
                onData={onData}
                onDirty={setDetailDirty}
                notify={notify}
                onPrivacy={() => onPrivacy(detailExpense)}
                onPay={onPay}
              />
            </div>
          </Modal>
        )}
        {leavingDetail && (
          <Modal
            title="Keep these detail edits?"
            onClose={() => setLeavingDetail(false)}
          >
            <div className="modal-content">
              <p>The detail view has unsaved changes.</p>
              <div className="dialog-actions">
                <button
                  className="button quiet"
                  onClick={() => {
                    setDetail(undefined);
                    setDetailDirty(false);
                    setLeavingDetail(false);
                  }}
                >
                  Discard edits
                </button>
                <button
                  className="button primary"
                  onClick={async () => {
                    try {
                      await detailHandle.current?.saveDraft();
                      setDetail(undefined);
                      setLeavingDetail(false);
                    } catch {
                      setLeavingDetail(false);
                    }
                  }}
                >
                  Save draft & return
                </button>
              </div>
            </div>
          </Modal>
        )}
      </section>
    );
  },
);

function BatchRow({
  expense: e,
  visible,
  data,
  index,
  read,
  queued,
  register,
  onData,
  onDirty,
  onSource,
  onDetail,
  onRetry,
}: {
  expense: Expense;
  visible: boolean;
  data: Snapshot;
  index: number;
  read?: ReadState;
  queued: boolean;
  register: (h: RowHandle | null) => void;
  onData: (s: Snapshot) => void;
  onDirty: (d: boolean) => void;
  onSource: (box?: Box) => void;
  onDetail: () => void;
  onRetry: () => void;
}) {
  const [draft, setDraft] = useState(() => batchSeed(e));
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const reviewingRef = useRef(false);
  const [error, setError] = useState("");
  const [changed, setChanged] = useState(false);
  const [saved, setSaved] = useState(false);
  const current = useRef(e);
  current.current = e;
  const form = useRef(draft);
  form.current = draft;
  const touched = useRef(new Set<keyof BatchDraft>());
  const version = useRef(0),
    stored = useRef(0),
    ownRevision = useRef(e.revision);
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(true);
  const locked = e.reviewed || e.approved || BigInt(e.paidMinor) > 0n;
  const callback = useRef({ onData, onDirty });
  callback.current = { onData, onDirty };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, []);
  function dirty(value: boolean) {
    if (mounted.current) {
      setChanged(value);
      callback.current.onDirty(value);
    }
  }
  function change(patch: Partial<BatchDraft>, human = true) {
    if (reviewingRef.current) return;
    if (human)
      for (const key of Object.keys(patch) as (keyof BatchDraft)[])
        touched.current.add(key);
    form.current = { ...form.current, ...patch };
    setDraft(form.current);
    version.current++;
    dirty(true);
    setError("");
    setSaved(false);
  }
  useEffect(() => {
    if (e.revision !== ownRevision.current) {
      if (version.current !== stored.current) {
        setError(
          "This record changed elsewhere. Your edits are retained. Open details after resetting this draft.",
        );
        return;
      }
      ownRevision.current = e.revision;
      form.current = batchSeed(e);
      setDraft(form.current);
    }
    const next = batchSuggestions(form.current, e, touched.current);
    if (JSON.stringify(next) !== JSON.stringify(form.current))
      change(next, false);
  }, [e.revision, e.extraction, reviewing]);
  async function flush(reviewed = false): Promise<void> {
    clearTimeout(timer.current);
    if (inFlight.current) {
      await inFlight.current;
      return flush(reviewed);
    }
    if (!reviewed && version.current === stored.current) return;
    if (current.current.revision !== ownRevision.current)
      throw new Error("Reset this draft before editing the changed record.");
    const at = version.current;
    const input = batchInput(current.current, form.current, reviewed);
    setSaving(true);
    setError("");
    const work = (async () => {
      try {
        const next = await api.save(input);
        const result = next.expenses.find((x) => x.id === e.id)!;
        ownRevision.current = result.revision;
        current.current = result;
        stored.current = at;
        callback.current.onData(next);
        if (mounted.current) {
          setSaved(true);
          dirty(version.current !== stored.current);
          if (reviewed) setExpanded(false);
        }
      } catch (err) {
        if (mounted.current) {
          setError(String(err));
          dirty(true);
        }
        throw err;
      } finally {
        inFlight.current = null;
        if (mounted.current) setSaving(false);
      }
    })();
    inFlight.current = work;
    await work;
    if (version.current !== stored.current) await flush();
  }
  useEffect(() => {
    if (!changed || error || locked) return;
    timer.current = setTimeout(() => {
      void flush().catch((err) => {
        if (mounted.current) setError(String(err));
      });
    }, 700);
    return () => clearTimeout(timer.current);
  }, [draft, changed, error, locked, saving]);
  useEffect(() => {
    register({
      pending: () =>
        version.current !== stored.current || inFlight.current !== null,
      flush: () => flush(),
      discard: async () => {
        clearTimeout(timer.current);
        try {
          await inFlight.current;
        } catch {
          /* discard only unsaved work */
        }
        form.current = batchSeed(current.current);
        setDraft(form.current);
        ownRevision.current = current.current.revision;
        stored.current = ++version.current;
        touched.current.clear();
        setError("");
        dirty(false);
      },
    });
    return () => register(null);
  });
  const field = (
    key: "merchant" | "expenseDate" | "total",
    label: string,
    type = "text",
  ) => (
    <input
      aria-label={`${label} · ${e.filename}`}
      type={type}
      inputMode={key === "total" ? "decimal" : undefined}
      value={draft[key]}
      disabled={locked || reviewing}
      placeholder={
        key === "merchant" ? "Merchant needed" : key === "total" ? "0.00" : ""
      }
      onChange={(event) => change({ [key]: event.target.value })}
    />
  );
  const funds = e.allocations
    .map(
      (a) => data.funds.find((f) => f.id === a.fundId)?.code || "Unknown fund",
    )
    .join(" + ");
  const missing = !draft.merchant
    ? "Merchant needed"
    : !draft.expenseDate
      ? "Date needed"
      : !draft.total || draft.total === "0.00"
        ? "Total needed"
        : conflictingTotals(e.extraction).length
          ? "Check conflicting totals"
          : "Check suggestions";
  return (
    <>
      <tr
        hidden={!visible}
        className={`batch-row ${expanded ? "is-expanded" : ""} ${error ? "has-error" : ""} ${read?.phase === "done" ? "read-complete" : ""}`}
        data-expense-id={e.id}
      >
        <td>
          <div className="batch-receipt-cell">
            <span className="batch-row-number">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              {field("merchant", "Merchant")}
              <div className="batch-file-line">
                <span className="batch-file">{e.filename}</span>
                <span
                  className={`batch-save-state ${!changed && saved ? "is-saved" : ""}`}
                  role="status"
                >
                  {error ? (
                    "Not saved"
                  ) : saving ? (
                    "Saving…"
                  ) : changed ? (
                    "Pending"
                  ) : saved ? (
                    <>
                      <Check size={11} />
                      {desktop ? "Saved" : "Kept in tab"}
                    </>
                  ) : (
                    ""
                  )}
                </span>
              </div>
            </div>
          </div>
        </td>
        <td>{field("expenseDate", "Receipt date", "date")}</td>
        <td className="batch-amount">
          <div className="batch-amount-input">
            {field("total", "Receipt total")}
            <button
              className="batch-source-button"
              aria-label={`View original · ${e.filename}`}
              title="View original"
              onClick={(event) => {
                event.currentTarget.parentElement
                  ?.querySelector("input")
                  ?.focus();
                onSource(e.extraction?.sources.totalMinor);
              }}
            >
              <FileText size={16} />
            </button>
          </div>
        </td>
        <td>
          <span className={funds ? "batch-fund-code" : "batch-unallocated"}>
            {funds || "Unallocated"}
          </span>
          {e.allocations.length > 0 && (
            <small>{money(e.eligibleMinor)} eligible</small>
          )}
        </td>
        <td>
          <div className="batch-row-state">
            {read?.phase === "reading" ? (
              <span>
                <LoaderCircle size={13} className="spin" />
                Reading{" "}
                {read.progress != null
                  ? `${Math.round(read.progress * 100)}%`
                  : ""}
              </span>
            ) : queued ? (
              <span>Queued</span>
            ) : read?.phase === "failed" ? (
              <span className="batch-read-error">Reading failed</span>
            ) : (
              <span className={locked ? "batch-reviewed" : ""}>
                {locked ? (
                  <Check size={13} />
                ) : read?.phase === "done" ? (
                  <ScanText size={13} />
                ) : (
                  <span className="batch-attention-dot" />
                )}
                {locked
                  ? status(e)
                  : read?.phase === "done" && missing === "Check suggestions"
                    ? "Read · check details"
                    : missing}
              </span>
            )}
          </div>
        </td>
        <td className="batch-row-action">
          {read?.phase === "failed" && (
            <button className="text-button" onClick={onRetry}>
              <RotateCcw size={12} />
              Retry reading
            </button>
          )}
          <div>
            <button
              className="batch-review-button"
              aria-expanded={!locked && expanded}
              aria-label={`${locked ? "Open record" : "Review receipt"} · ${e.filename}`}
              onClick={() => (locked ? onDetail() : setExpanded((v) => !v))}
            >
              {locked ? "Open record" : "Review"}
              {!locked ? (
                expanded ? (
                  <ChevronUp size={13} />
                ) : (
                  <ChevronDown size={13} />
                )
              ) : (
                <ArrowRight size={13} />
              )}
            </button>
          </div>
        </td>
      </tr>
      {error && (
        <tr hidden={!visible} className="batch-save-row">
          <td colSpan={6}>
            <div role={error ? "alert" : undefined}>
              {error ? (
                <>
                  <span>{error}</span>
                  <button
                    className="text-button"
                    onClick={() =>
                      void flush().catch((err) => setError(String(err)))
                    }
                  >
                    Retry save
                  </button>
                  <button
                    className="text-button"
                    onClick={async () => {
                      await inFlight.current?.catch(() => {});
                      clearTimeout(timer.current);
                      form.current = batchSeed(current.current);
                      setDraft(form.current);
                      ownRevision.current = current.current.revision;
                      stored.current = ++version.current;
                      setError("");
                      dirty(false);
                    }}
                  >
                    Reset unsaved edits
                  </button>
                </>
              ) : saving ? (
                "Saving draft…"
              ) : changed ? (
                "Draft changes pending"
              ) : saved ? (
                desktop ? (
                  "Draft saved to database"
                ) : (
                  "Draft kept in this tab"
                )
              ) : (
                ""
              )}
            </div>
          </td>
        </tr>
      )}
      {read?.phase === "failed" && (
        <tr hidden={!visible} className="batch-save-row">
          <td colSpan={6}>
            <span className="batch-read-error">
              Reading failed. Original retained. Enter the details manually, or
              retry. {read.error}
            </span>
          </td>
        </tr>
      )}
      {expanded && !locked && (
        <tr hidden={!visible} className="batch-edit-row" data-expense-id={e.id}>
          <td colSpan={6}>
            <fieldset className="batch-edit-grid" disabled={reviewing}>
              <legend className="visually-hidden">
                Receipt review details
              </legend>
              <label>
                Person being reimbursed
                <input
                  value={draft.claimant}
                  onChange={(v) => change({ claimant: v.target.value })}
                />
              </label>
              <label className="batch-purpose">
                Purpose
                <input
                  value={draft.purpose}
                  onChange={(v) => change({ purpose: v.target.value })}
                />
              </label>
              <label>
                Category
                <select
                  value={draft.category}
                  onChange={(v) => change({ category: v.target.value })}
                >
                  <option value="">Choose category</option>
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Eligible · USD
                <input
                  inputMode="decimal"
                  value={draft.eligible}
                  onChange={(v) =>
                    change({
                      eligible: v.target.value,
                      allocations:
                        draft.allocations.length === 1
                          ? [
                              {
                                ...draft.allocations[0],
                                amount: v.target.value,
                              },
                            ]
                          : draft.allocations,
                    })
                  }
                />
              </label>
              <label>
                Fund
                {draft.allocations.length > 1 ? (
                  <span className="batch-split-summary">
                    {draft.allocations.length} funds · edit below
                  </span>
                ) : (
                  <select
                    value={draft.allocations[0]?.fundId || ""}
                    onChange={(v) =>
                      change({
                        allocations: v.target.value
                          ? [{ fundId: v.target.value, amount: draft.eligible }]
                          : [],
                      })
                    }
                  >
                    <option value="">Choose fund</option>
                    {data.funds.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code} · {f.name}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            </fieldset>
            <div className="batch-edit-actions">
              <span>Check the original and funding before review.</span>
              <button className="text-button" onClick={onDetail}>
                Split funding & more
              </button>
              <button
                className="button primary"
                aria-label="Mark reviewed"
                aria-busy={reviewing}
                disabled={saving || reviewing}
                onClick={async () => {
                  reviewingRef.current = true;
                  setReviewing(true);
                  try {
                    await flush(true);
                  } catch (err) {
                    setError(String(err));
                  } finally {
                    reviewingRef.current = false;
                    if (mounted.current) setReviewing(false);
                  }
                }}
              >
                <Check size={14} />
                {reviewing ? "Reviewing…" : "Mark reviewed"}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
