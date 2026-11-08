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
  ChevronRight,
  FileCheck2,
  Info,
  Link2,
  LoaderCircle,
  Plus,
  ScanText,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { api, desktop } from "./api";
import { DocumentView, type DocumentHandle } from "./DocumentView";
import { AllocationStrip } from "./AllocationStrip";
import { NewFundModal } from "./NewFundModal";
import { conflictingTotals } from "./receiptAmounts";
import { decimal, money, sum, toMinor } from "./money";
import {
  CATEGORIES,
  today,
  type Allocation,
  type Box,
  type Expense,
  type ReviewInput,
  type Snapshot,
} from "./types";
export type ReviewHandle = {
  saveDraft: () => Promise<void>;
  discardDrafts?: () => Promise<void>;
};
type Props = {
  expense: Expense;
  data: Snapshot;
  onData: (s: Snapshot) => void;
  onDirty: (v: boolean) => void;
  notify: (s: string, error?: boolean) => void;
  onPrivacy: () => void;
  onPay: (e: Expense) => void;
};
type Form = {
  merchant: string;
  claimant: string;
  purpose: string;
  expenseDate: string;
  category: string;
  total: string;
  eligible: string;
  allocations: { fundId: string; amount: string }[];
};
type SourceField = "merchant" | "expenseDate" | "totalMinor";
const sourceLabels: Record<SourceField, string> = {
  merchant: "merchant",
  expenseDate: "receipt date",
  totalMinor: "receipt total",
};
const seed = (e: Expense): Form => ({
  merchant: e.merchant,
  claimant: e.claimant,
  purpose: e.purpose,
  expenseDate: e.expenseDate,
  category: e.category,
  total: e.revision === 0 && e.totalMinor === "0" ? "" : decimal(e.totalMinor),
  eligible:
    e.revision === 0 && e.eligibleMinor === "0" ? "" : decimal(e.eligibleMinor),
  allocations: e.allocations.map((a) => ({
    fundId: a.fundId,
    amount: decimal(a.amountMinor),
  })),
});
export function status(e: Expense) {
  return !e.reviewed
    ? "Needs review"
    : !e.approved
      ? "Awaiting approval"
      : BigInt(e.paidMinor) === 0n
        ? "Approved · unpaid"
        : e.paidMinor !== e.eligibleMinor
          ? "Partly reimbursed"
          : e.reconciledMinor === e.paidMinor
            ? "Reconciled"
            : "Reimbursed";
}
export const ReviewDesk = forwardRef<ReviewHandle, Props>(function ReviewDesk(
  { expense: e, data, onData, onDirty, notify, onPrivacy, onPay },
  ref,
) {
  const [form, setForm] = useState<Form>(() => seed(e));
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"details" | "funding" | "decision">("details");
  const [highlight, setHighlight] = useState<Box>();
  const [busy, setBusy] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [createFund, setCreateFund] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [approver, setApprover] = useState("");
  const [reference, setReference] = useState("");
  const [saveError, setSaveError] = useState<string>();
  const [sourceField, setSourceField] = useState<SourceField>();
  const [compact, setCompact] = useState(
    () => matchMedia("(max-width: 760px)").matches,
  );
  const fields = useRef<Partial<Record<SourceField, HTMLInputElement>>>({});
  const sourceReturn = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  const document = useRef<DocumentHandle>(null);
  useEffect(() => {
    const query = matchMedia("(max-width: 760px)");
    const update = () => setCompact(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    setForm(seed(e));
    setDirty(false);
    onDirty(false);
    setHighlight(undefined);
    setReference("");
    setApprover("");
    setSaveError(undefined);
    setSourceField(undefined);
  }, [e.id, e.revision]);
  function change(p: Partial<Form>) {
    setSaveError(undefined);
    setForm((f) => ({ ...f, ...p }));
    setDirty(true);
    onDirty(true);
  }
  async function save(reviewed: boolean) {
    setCommitting(true);
    setSaveError(undefined);
    setBusy(true);
    try {
      const allocations: Allocation[] = form.allocations.map((a) => ({
        fundId: a.fundId,
        amountMinor: toMinor(a.amount || "0"),
      }));
      const input: ReviewInput = {
        id: e.id,
        expectedRevision: e.revision,
        merchant: form.merchant,
        claimant: form.claimant,
        purpose: form.purpose,
        expenseDate: form.expenseDate,
        category: form.category,
        totalMinor: toMinor(form.total || "0"),
        eligibleMinor: toMinor(form.eligible || "0"),
        reviewed,
        allocations,
      };
      const state = await api.save(input);
      onData(state);
      setDirty(false);
      onDirty(false);
      notify(
        reviewed
          ? "Receipt reviewed. Ready for an external approval."
          : desktop
            ? "Draft saved to the database."
            : "Draft kept in this temporary session.",
      );
      if (reviewed) setTab("decision");
    } catch (error) {
      setSaveError(String(error));
      throw error;
    } finally {
      setBusy(false);
      setCommitting(false);
    }
  }
  useImperativeHandle(ref, () => ({ saveDraft: () => save(false) }));
  async function readReceipt() {
    if (!document.current) return;
    setBusy(true);
    try {
      const extraction = await document.current.extract();
      onData(await api.extraction(e.id, extraction));
      notify(
        "Local suggestions are ready. Check each one against the receipt.",
      );
    } catch (error) {
      notify(String(error), true);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }
  function suggestion(key: "merchant" | "expenseDate" | "totalMinor") {
    const x = e.extraction?.fields[key];
    if (!x) return null;
    return (
      <button
        className="suggestion"
        type="button"
        onClick={() => {
          setHighlight(e.extraction?.sources[key]);
          change(
            key === "totalMinor"
              ? {
                  total: decimal(x),
                  ...(form.eligible === form.total ||
                  form.eligible === "0.00" ||
                  !form.eligible
                    ? { eligible: decimal(x) }
                    : {}),
                }
              : { [key]: x },
          );
        }}
      >
        <ScanText size={12} />
        {key === "totalMinor" ? money(x) : x}
        <span>Use suggestion</span>
      </button>
    );
  }
  function focus(key: SourceField) {
    if (returning.current) {
      returning.current = false;
      return;
    }
    setHighlight(e.extraction?.sources[key]);
  }
  function showSource(key: SourceField, box = e.extraction?.sources[key]) {
    if (!box) return;
    setSourceField(key);
    setHighlight({ ...box });
    requestAnimationFrame(() =>
      sourceReturn.current?.focus({ preventScroll: true }),
    );
  }
  function returnToField() {
    if (!sourceField) return;
    const node = fields.current[sourceField];
    setSourceField(undefined);
    requestAnimationFrame(() => {
      returning.current = true;
      node?.focus({ preventScroll: true });
      node?.scrollIntoView({
        block: "center",
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    });
  }
  function sourceLink(key: SourceField) {
    return e.extraction?.sources[key] ? (
      <button
        className="text-button source-link"
        type="button"
        onClick={(event) => {
          event.preventDefault();
          showSource(key);
        }}
      >
        <ScanText size={14} /> Show {sourceLabels[key]} source
      </button>
    ) : null;
  }
  let allocated = 0n,
    eligible = 0n;
  let amountsValid = true;
  try {
    allocated = sum(form.allocations.map((a) => toMinor(a.amount || "0")));
    eligible = BigInt(toMinor(form.eligible || "0"));
  } catch {
    amountsValid = false;
  }
  const splitMatches = amountsValid && allocated === eligible && eligible > 0n;
  const editable = BigInt(e.paidMinor) === 0n;
  const amountConflicts = conflictingTotals(e.extraction);
  const owed = BigInt(e.eligibleMinor) - BigInt(e.paidMinor);
  const taskTitle = dirty
    ? "Draft changes need review"
    : !e.reviewed
      ? "Check the receipt and its funding"
      : !e.approved
        ? "Record the external decision"
        : owed > 0n
          ? `${money(owed)} still to reimburse`
          : "Check the payment record";
  const taskDetail =
    dirty || !e.reviewed
      ? tab === "funding"
        ? !data.funds.length
          ? "Create the first fund, then connect the eligible amount. Review is a separate step."
          : "Match the full eligible amount, check the fund rules, then mark reviewed."
        : "Verify the details against the original, then connect the funding. Suggestions only fill a draft."
      : !e.approved
        ? "Record a decision made outside FundThread against this reviewed revision."
        : owed > 0n
          ? "Record a payment only after it is made through your existing bank process."
          : e.reconciledMinor !== e.paidMinor
            ? "The payment is recorded. Check it against the bank record in Reimbursements."
            : "This claim is reconciled. Choose a recipient and inspect its report before sharing.";
  return (
    <div className="review-body">
      <section className="receipt-column">
        {sourceField && (
          <div className="source-return-bar">
            <span>Original evidence · {sourceLabels[sourceField]}</span>
            <button
              ref={sourceReturn}
              className="text-button"
              onClick={returnToField}
            >
              Back to {sourceLabels[sourceField]} field <ArrowRight size={14} />
            </button>
          </div>
        )}
        <DocumentView
          ref={document}
          expense={e}
          fitToPage
          highlight={highlight}
          scrollToHighlight={!compact || !!sourceField}
          onProgress={setProgress}
        />
        <div className="receipt-tip">
          <Link2 size={14} />
          <span>
            {e.extraction
              ? "Select a field to see its source on the receipt."
              : "Read the receipt locally to get editable suggestions."}
          </span>
        </div>
      </section>
      <section className="review-column" aria-label="Receipt review">
        <div className="review-heading">
          <div>
            <span className="eyebrow">
              RECEIPT {e.id.slice(-4).toUpperCase()}
            </span>
            <h2>{e.merchant || "New receipt"}</h2>
            <div className="review-key-amount">
              {e.revision === 0 && e.totalMinor === "0"
                ? "—"
                : money(e.totalMinor)}
            </div>
            <p className="source-amount-label">Receipt total · USD</p>
          </div>
          <span
            className={`status-dot ${e.approved ? "green" : "amber"}`}
            title={status(e)}
          />
        </div>
        <details className="task-context" aria-label="Current receipt task">
          <summary>
            <strong>{taskTitle}</strong>
          </summary>
          <p>{taskDetail}</p>
        </details>
        <div className="review-tabs" role="tablist" aria-label="Review steps">
          {(["details", "funding", "decision"] as const).map((t, i) => (
            <button
              key={t}
              role="tab"
              id={`review-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="review-panel"
              tabIndex={tab === t ? 0 : -1}
              onKeyDown={(event) => {
                const steps = ["details", "funding", "decision"] as const;
                const next =
                  event.key === "ArrowRight"
                    ? (i + 1) % 3
                    : event.key === "ArrowLeft"
                      ? (i + 2) % 3
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? 2
                          : null;
                if (next !== null) {
                  event.preventDefault();
                  setTab(steps[next]);
                  event.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
                    [next]?.focus();
                }
              }}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              <span>
                {(t === "details" && e.reviewed) ||
                (t === "funding" && e.approved) ? (
                  <Check size={11} />
                ) : (
                  i + 1
                )}
              </span>
              {t === "details"
                ? "Details"
                : t === "funding"
                  ? "Funding"
                  : "Decision"}
            </button>
          ))}
        </div>
        <div
          className="review-scroll"
          id="review-panel"
          role="tabpanel"
          aria-labelledby={`review-tab-${tab}`}
        >
          <fieldset className="review-fields" disabled={committing}>
            {tab === "details" && (
              <>
                <div className="section-intro">
                  <h3>Check the details</h3>
                  <p>
                    Confirm what’s on the receipt. Add the context only your
                    team knows.
                  </p>
                </div>
                <button
                  className="button extract-button"
                  disabled={busy}
                  onClick={readReceipt}
                >
                  {busy && progress !== null ? (
                    <LoaderCircle size={16} className="spin" />
                  ) : (
                    <ScanText size={16} />
                  )}{" "}
                  {progress !== null
                    ? `Reading locally · ${Math.round(progress * 100)}%`
                    : e.extraction
                      ? "Read receipt again"
                      : "Read receipt locally"}
                  <span className="local-pill">ON DEVICE</span>
                </button>
                {progress !== null && (
                  <button
                    className="text-button"
                    onClick={() => {
                      document.current?.cancel();
                      setBusy(false);
                      notify(
                        "Extraction cancelled. Your original is unchanged.",
                      );
                    }}
                  >
                    Cancel extraction
                  </button>
                )}
                {amountConflicts.length > 0 && (
                  <div
                    className="amount-conflict"
                    role="note"
                    aria-label="Conflicting receipt amounts"
                  >
                    <strong>Check which amount is the receipt total.</strong>
                    <p>
                      An amount due may be the remaining balance. Compare these
                      lines with the original before using a suggestion.
                    </p>
                    {amountConflicts.map((c, i) => (
                      <button
                        key={i}
                        className="text-button"
                        onClick={() => showSource("totalMinor", c.box)}
                      >
                        {c.kind.replaceAll("_", " ")} · {money(c.amountMinor)}{" "}
                        <span>Show source</span>
                      </button>
                    ))}
                  </div>
                )}
                <fieldset disabled={!editable || busy}>
                  <label>
                    Merchant
                    <input
                      aria-label="Merchant"
                      ref={(node) => {
                        fields.current.merchant = node ?? undefined;
                      }}
                      value={form.merchant}
                      placeholder="Who issued this receipt?"
                      onFocus={() => focus("merchant")}
                      onChange={(v) => change({ merchant: v.target.value })}
                    />
                    {suggestion("merchant")}
                    {sourceLink("merchant")}
                  </label>
                  <div className="field-row">
                    <label>
                      Receipt date
                      <input
                        aria-label="Receipt date"
                        ref={(node) => {
                          fields.current.expenseDate = node ?? undefined;
                        }}
                        type="date"
                        value={form.expenseDate}
                        onFocus={() => focus("expenseDate")}
                        onChange={(v) =>
                          change({ expenseDate: v.target.value })
                        }
                      />
                      {suggestion("expenseDate")}
                      {sourceLink("expenseDate")}
                    </label>
                    <label>
                      Receipt total <span className="muted">USD</span>
                      <div className="money-input">
                        <span>$</span>
                        <input
                          aria-label="Receipt total"
                          ref={(node) => {
                            fields.current.totalMinor = node ?? undefined;
                          }}
                          inputMode="decimal"
                          value={form.total}
                          onFocus={() => focus("totalMinor")}
                          onChange={(v) => change({ total: v.target.value })}
                        />
                      </div>
                      {suggestion("totalMinor")}
                      {sourceLink("totalMinor")}
                    </label>
                  </div>
                  <div className="field-divider">
                    <span>YOUR TEAM’S CONTEXT</span>
                  </div>
                  <label>
                    Person being reimbursed
                    <input
                      value={form.claimant}
                      placeholder="Name or internal recipient ID"
                      onChange={(v) => change({ claimant: v.target.value })}
                    />
                  </label>
                  <label>
                    What was this for?
                    <textarea
                      rows={3}
                      value={form.purpose}
                      placeholder="A clear purpose, without unnecessary personal details"
                      onChange={(v) => change({ purpose: v.target.value })}
                    />
                  </label>
                  <label>
                    Expense category
                    <select
                      value={form.category}
                      onChange={(v) => change({ category: v.target.value })}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </fieldset>
                {!editable && (
                  <div className="inline-note">
                    <Info size={15} />
                    This claim has payment records. Its reviewed details are
                    preserved.
                  </div>
                )}
                <button
                  className="text-button next-section"
                  onClick={() => setTab("funding")}
                >
                  Next: connect the funding
                  <ArrowRight size={15} />
                </button>
              </>
            )}
            {tab === "funding" && (
              <>
                <div className="section-intro">
                  <h3>Connect the funding</h3>
                  <p>
                    Split an eligible cost across funds. Approval records the
                    budget use once.
                  </p>
                </div>
                <fieldset disabled={!editable || busy}>
                  <label>
                    Eligible reimbursement <span className="muted">USD</span>
                    <div className="money-input">
                      <span>$</span>
                      <input
                        inputMode="decimal"
                        value={form.eligible}
                        onChange={(v) => change({ eligible: v.target.value })}
                      />
                    </div>
                    <small>
                      The receipt total and reimbursable amount may differ.
                    </small>
                  </label>
                  <div className="allocation-heading">
                    <strong>Fund allocations</strong>
                    <span>{form.allocations.length} connected</span>
                  </div>
                  {form.allocations.map((a, i) => {
                    const f = data.funds.find((f) => f.id === a.fundId);
                    let amount = 0n;
                    try {
                      amount = BigInt(toMinor(a.amount || "0"));
                    } catch {}
                    const remaining = f
                      ? BigInt(f.budgetMinor) -
                        BigInt(f.usedMinor) +
                        (e.approved
                          ? BigInt(
                              e.allocations.find((old) => old.fundId === f.id)
                                ?.amountMinor || "0",
                            )
                          : 0n) -
                        amount
                      : 0n;
                    const wrongDate =
                      f &&
                      form.expenseDate &&
                      (form.expenseDate < f.periodStart ||
                        form.expenseDate > f.periodEnd);
                    const wrongCategory =
                      f &&
                      f.categories.length > 0 &&
                      !f.categories.includes(form.category);
                    return (
                      <div className="allocation-card" key={i}>
                        <div className="allocation-inputs">
                          <select
                            aria-label={`Fund ${i + 1}`}
                            value={a.fundId}
                            onChange={(v) =>
                              change({
                                allocations: form.allocations.map((x, j) =>
                                  j === i
                                    ? { ...x, fundId: v.target.value }
                                    : x,
                                ),
                              })
                            }
                          >
                            {data.funds
                              .filter(
                                (f) =>
                                  f.id === a.fundId ||
                                  !form.allocations.some(
                                    (x) => x.fundId === f.id,
                                  ),
                              )
                              .map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.name}
                                </option>
                              ))}
                          </select>
                          <button
                            className="icon-button"
                            aria-label="Remove fund allocation"
                            onClick={() =>
                              change({
                                allocations: form.allocations.filter(
                                  (_, j) => j !== i,
                                ),
                              })
                            }
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                        <div className="allocation-amount">
                          <span>{f?.code}</span>
                          <div className="money-input">
                            <span>$</span>
                            <input
                              aria-label={`Amount for ${f?.name}`}
                              inputMode="decimal"
                              value={a.amount}
                              onChange={(v) =>
                                change({
                                  allocations: form.allocations.map((x, j) =>
                                    j === i
                                      ? { ...x, amount: v.target.value }
                                      : x,
                                  ),
                                })
                              }
                            />
                          </div>
                        </div>
                        <small className={remaining < 0n ? "danger-text" : ""}>
                          After approval: {money(remaining)} of recorded budget
                        </small>
                        {(wrongDate || wrongCategory) && (
                          <p className="allocation-warning">
                            <Info size={14} />
                            {wrongDate
                              ? "Receipt is outside the grant period."
                              : "Category is outside the configured rules."}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  <button
                    className="text-button"
                    disabled={
                      data.funds.length > 0 &&
                      form.allocations.length >= data.funds.length
                    }
                    onClick={() => {
                      if (!data.funds.length) {
                        setCreateFund(true);
                        return;
                      }
                      const f = data.funds.find(
                        (f) => !form.allocations.some((a) => a.fundId === f.id),
                      );
                      if (f)
                        change({
                          allocations: [
                            ...form.allocations,
                            {
                              fundId: f.id,
                              amount: decimal(
                                (eligible > allocated
                                  ? eligible - allocated
                                  : 0n
                                ).toString(),
                              ),
                            },
                          ],
                        });
                    }}
                  >
                    <Plus size={15} />
                    {data.funds.length
                      ? "Connect another fund"
                      : "Create a fund"}
                  </button>
                </fieldset>
                {data.funds.length > 0 && editable && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => setCreateFund(true)}
                  >
                    Create a new fund
                  </button>
                )}
                <div
                  className={`allocation-total ${splitMatches ? "complete" : ""}`}
                >
                  <span>
                    {splitMatches ? <Check size={15} /> : <Info size={15} />}{" "}
                    {splitMatches
                      ? "Fully allocated"
                      : amountsValid && allocated > eligible
                        ? "Over allocated by"
                        : "Still to allocate"}
                  </span>
                  <strong>
                    {amountsValid
                      ? money(
                          allocated > eligible
                            ? allocated - eligible
                            : eligible - allocated,
                        )
                      : "Check amounts"}
                  </strong>
                </div>
                <p className="allocation-feedback" role="status">
                  {!amountsValid
                    ? "Enter valid amounts with up to two decimal places."
                    : splitMatches
                      ? dirty || !e.reviewed
                        ? `Split totals match ${money(eligible)}. Review is still required.`
                        : `Split totals match the saved reviewed revision ${e.revision}.`
                      : allocated > eligible
                        ? "The split exceeds the eligible amount. Adjust it before review."
                        : "Connect the full eligible amount before marking reviewed."}
                </p>
                <div className="inline-note subtle">
                  <Shield size={15} />
                  <p>
                    Configured grant checks help flag a mismatch. Your
                    organization remains responsible for eligibility and
                    approval.
                  </p>
                </div>
                <button
                  className="text-button next-section"
                  onClick={() => setTab("decision")}
                >
                  Next: review the decision
                  <ArrowRight size={15} />
                </button>
              </>
            )}
            {tab === "decision" && (
              <>
                <div className="section-intro">
                  <h3>A clear decision trail</h3>
                  <p>
                    Receipt review, external approval and reimbursement are
                    separate steps.
                  </p>
                </div>
                <div className="decision-step">
                  <span className={`step-circle ${e.reviewed ? "done" : ""}`}>
                    {e.reviewed ? <Check size={15} /> : 1}
                  </span>
                  <div>
                    <strong>
                      {e.reviewed
                        ? "Receipt reviewed"
                        : "Receipt review needed"}
                    </strong>
                    <p>
                      {e.reviewed
                        ? desktop
                          ? `Revision ${e.revision} saved to the database after review.`
                          : `Revision ${e.revision} reviewed in this session.`
                        : "Check the details and funding, then mark reviewed."}
                    </p>
                  </div>
                </div>
                <div className="decision-step">
                  <span className={`step-circle ${e.approved ? "done" : ""}`}>
                    {e.approved ? <Check size={15} /> : 2}
                  </span>
                  <div>
                    <strong>
                      {e.approved
                        ? "External approval recorded"
                        : "Record an external approval"}
                    </strong>
                    <p>
                      {e.approved
                        ? `${e.approver} · ${e.approvalReference}`
                        : "Attach the decision to this exact reviewed revision."}
                    </p>
                  </div>
                </div>
                {!e.approved && (
                  <div className="approval-form">
                    <label>
                      Approver
                      <input
                        value={approver}
                        placeholder="Who approved this expense?"
                        onChange={(v) => setApprover(v.target.value)}
                      />
                    </label>
                    <label>
                      Approval evidence reference
                      <input
                        value={reference}
                        placeholder="Signed form ID or approval message reference"
                        onChange={(v) => setReference(v.target.value)}
                      />
                    </label>
                    <button
                      className="button secondary full"
                      disabled={!e.reviewed || dirty || busy}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          onData(
                            await api.approve(
                              e.id,
                              e.revision,
                              approver,
                              reference,
                            ),
                          );
                          notify(
                            "External approval recorded for this revision.",
                          );
                        } catch (x) {
                          notify(String(x), true);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <FileCheck2 size={16} />
                      Record approval
                    </button>
                    <small>
                      A name entered here is an attribution by the local
                      operator.
                    </small>
                  </div>
                )}
                <div className="decision-step">
                  <span
                    className={`step-circle ${e.paidMinor === e.eligibleMinor && BigInt(e.paidMinor) > 0n ? "done" : ""}`}
                  >
                    {e.paidMinor === e.eligibleMinor &&
                    BigInt(e.paidMinor) > 0n ? (
                      <Check size={15} />
                    ) : (
                      3
                    )}
                  </span>
                  <div>
                    <strong>Reimbursement</strong>
                    <p>
                      {money(e.paidMinor)} recorded ·{" "}
                      {money(BigInt(e.eligibleMinor) - BigInt(e.paidMinor))}{" "}
                      still owed
                    </p>
                    {e.approved && e.paidMinor !== e.eligibleMinor && (
                      <button className="text-button" onClick={() => onPay(e)}>
                        Record a payment
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <button className="privacy-entry" onClick={onPrivacy}>
                  <Shield size={18} />
                  <span>
                    <strong>Prepare a private receipt copy</strong>
                    <small>Mask personal details. Keep the original.</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              </>
            )}
          </fieldset>
        </div>
        <footer className="review-actions">
          {saveError && (
            <p className="review-error" role="alert">
              {saveError}
            </p>
          )}
          {e.approved && dirty && (
            <p className="approval-change-note">
              Saving changes requires a new approval.
            </p>
          )}
          <div className="save-state">
            <span className={`tiny-dot ${dirty ? "amber-bg" : ""}`} />
            {dirty
              ? "Unsaved changes"
              : e.revision
                ? desktop
                  ? `Revision ${e.revision} saved to the database`
                  : `Revision ${e.revision} in this session`
                : !desktop && api.browserMode() === "personal"
                  ? "Original in this tab · review needed"
                  : desktop
                    ? "Original saved · review needed"
                    : "Sample original · review needed"}
          </div>
          <div className="review-buttons">
            <button
              className="button secondary"
              disabled={!editable || busy || !dirty}
              onClick={() => void save(false).catch(() => {})}
            >
              Save draft
            </button>
            <button
              className="button primary"
              disabled={!editable || busy || (e.reviewed && !dirty)}
              onClick={() => void save(true).catch(() => {})}
            >
              {busy && progress === null ? (
                <LoaderCircle size={15} className="spin" />
              ) : (
                <Check size={15} />
              )}
              {e.reviewed && !dirty ? "Reviewed" : "Mark reviewed"}
            </button>
          </div>
        </footer>
      </section>
      {createFund && (
        <NewFundModal
          notify={notify}
          onClose={() => setCreateFund(false)}
          onCreated={(next, fundId) => {
            onData(next);
            change({
              allocations: [
                ...form.allocations,
                {
                  fundId,
                  amount: decimal(
                    (eligible > allocated
                      ? eligible - allocated
                      : 0n
                    ).toString(),
                  ),
                },
              ],
            });
          }}
        />
      )}
    </div>
  );
});
