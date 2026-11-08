import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  CheckCheck,
  ChevronRight,
  Download,
  FileSpreadsheet,
  FolderLock,
  HardDrive,
  History,
  Info,
  LockKeyhole,
  Plus,
  RotateCcw,
  Shield,
  Users,
  Wallet,
} from "lucide-react";
import { api, desktop } from "./api";
import { Modal } from "./Modal";
import { NewFundModal } from "./NewFundModal";
import { RecordHistory } from "./RecordHistory";
import { decimal, money, parseCsv, sum, toMinor } from "./money";
import { ExportPanel } from "./ExportPanel";
import {
  today,
  type Expense,
  type Profile,
  type Report,
  type Snapshot,
} from "./types";
type Common = {
  data: Snapshot;
  onData: (s: Snapshot) => void;
  notify: (s: string, error?: boolean) => void;
};
export function FundsPanel({ data, onData, notify }: Common) {
  const [create, setCreate] = useState(false);
  const [detail, setDetail] = useState<string>();
  const f = data.funds.find((f) => f.id === detail);
  return (
    <div className="panel-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">FOLLOW THE FUNDS</span>
          <h1>Grant funds</h1>
          <p>See recorded commitments and the rules connected to each fund.</p>
        </div>
        <button className="button primary" onClick={() => setCreate(true)}>
          <Plus size={16} />
          New fund
        </button>
      </div>
      <div className="stat-row">
        <div>
          <span>Recorded budget</span>
          <strong>{money(sum(data.funds.map((f) => f.budgetMinor)))}</strong>
        </div>
        <div>
          <span>Approved usage</span>
          <strong>{money(sum(data.funds.map((f) => f.usedMinor)))}</strong>
        </div>
        <div>
          <span>Remaining recorded budget</span>
          <strong>
            {money(
              sum(data.funds.map((f) => f.budgetMinor)) -
                sum(data.funds.map((f) => f.usedMinor)),
            )}
          </strong>
        </div>
      </div>
      <div className="fund-grid">
        {data.funds.map((f, i) => {
          const pct =
            Number(
              (BigInt(f.usedMinor) * 10000n) / (BigInt(f.budgetMinor) || 1n),
            ) / 100;
          return (
            <button
              className="fund-card"
              key={f.id}
              onClick={() => setDetail(f.id)}
            >
              <div className="fund-card-heading">
                <span className={`fund-icon fund-${i % 3}`}>
                  <FolderLock size={20} />
                </span>
                <span>{f.code}</span>
                <ChevronRight size={17} />
              </div>
              <h2>{f.name}</h2>
              <p>
                {f.restrictions || "No additional restriction notes entered."}
              </p>
              <div className="fund-amount">
                <strong>
                  {money(BigInt(f.budgetMinor) - BigInt(f.usedMinor))}
                </strong>
                <span>remaining recorded budget</span>
              </div>
              <div className="progress-track">
                <span style={{ width: `${Math.min(100, pct)}%` }} />
              </div>
              <div className="fund-card-foot">
                <span>{money(f.usedMinor)} approved</span>
                <span>{pct.toFixed(1)}% used</span>
              </div>
              <div className="fund-period">
                {f.periodStart} — {f.periodEnd}
              </div>
            </button>
          );
        })}
      </div>
      {!data.funds.length && (
        <div className="empty-state">
          <FolderLock size={35} />
          <h2>Give each expense a funding source.</h2>
          <p>
            Create a fund with its opening budget, grant period and category
            rules.
          </p>
          <button className="button primary" onClick={() => setCreate(true)}>
            Create your first fund
          </button>
        </div>
      )}
      <div className="inline-note">
        <Info size={16} />
        <p>
          Approved expenses are shown against each fund’s budget. Payment
          records are tracked separately.
        </p>
      </div>
      {create && (
        <NewFundModal
          onCreated={onData}
          onClose={() => setCreate(false)}
          notify={notify}
        />
      )}
      {f && (
        <Modal
          title={f.name}
          subtitle={f.code}
          onClose={() => setDetail(undefined)}
        >
          <div className="modal-content">
            <div className="stat-row compact">
              <div>
                <span>Approved usage</span>
                <strong>{money(f.usedMinor)}</strong>
              </div>
              <div>
                <span>Opening budget</span>
                <strong>{money(f.budgetMinor)}</strong>
              </div>
            </div>
            <h3>Configured grant rules</h3>
            <dl className="details-list">
              <dt>Grant period</dt>
              <dd>
                {f.periodStart} — {f.periodEnd}
              </dd>
              <dt>Categories</dt>
              <dd>
                {f.categories.join(", ") ||
                  "No category restriction configured"}
              </dd>
              <dt>Restriction notes</dt>
              <dd>{f.restrictions || "No notes entered"}</dd>
            </dl>
            <h3>Connected approved expenses</h3>
            {data.expenses
              .filter(
                (e) =>
                  e.approved && e.allocations.some((a) => a.fundId === f.id),
              )
              .map((e) => (
                <div className="list-row" key={e.id}>
                  <span>
                    {e.merchant}
                    <small>{e.expenseDate}</small>
                  </span>
                  <strong>
                    {money(
                      e.allocations.find((a) => a.fundId === f.id)!.amountMinor,
                    )}
                  </strong>
                </div>
              ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
export function PaymentsPanel({
  data,
  onData,
  notify,
  onPay,
}: Common & { onPay: (e: Expense) => void }) {
  return (
    <div className="panel-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CLOSE THE LOOP</span>
          <h1>Reimbursements</h1>
          <p>
            Record payments made outside FundThread, then reconcile them with
            the bank.
          </p>
        </div>
      </div>
      <div className="stat-row">
        <div>
          <span>Approved reimbursement</span>
          <strong>
            {money(
              sum(
                data.expenses
                  .filter((e) => e.approved)
                  .map((e) => e.eligibleMinor),
              ),
            )}
          </strong>
        </div>
        <div>
          <span>Still owed</span>
          <strong>
            {money(
              data.expenses
                .filter((e) => e.approved)
                .reduce(
                  (n, e) => n + BigInt(e.eligibleMinor) - BigInt(e.paidMinor),
                  0n,
                ),
            )}
          </strong>
        </div>
        <div>
          <span>Awaiting reconciliation</span>
          <strong>
            {money(
              sum(
                data.payments
                  .filter((p) => !p.reconciled)
                  .map((p) => p.amountMinor),
              ),
            )}
          </strong>
        </div>
      </div>
      <section className="surface">
        <div className="surface-heading">
          <h2>Ready to reimburse</h2>
          <span>External payments</span>
        </div>
        {data.expenses
          .filter((e) => e.approved && e.paidMinor !== e.eligibleMinor)
          .map((e) => (
            <div className="list-row reimbursement-row" key={e.id}>
              <span className="avatar">{e.claimant.slice(0, 1)}</span>
              <div className="grow">
                <strong>{e.claimant}</strong>
                <small>
                  {e.merchant} · {e.purpose}
                </small>
              </div>
              <strong className="amount">
                {money(BigInt(e.eligibleMinor) - BigInt(e.paidMinor))}
              </strong>
              <button className="button secondary" onClick={() => onPay(e)}>
                Record payment
                <ArrowRight size={14} />
              </button>
            </div>
          ))}
        {!data.expenses.some(
          (e) => e.approved && e.paidMinor !== e.eligibleMinor,
        ) && (
          <p className="empty-inline">
            No approved claims are awaiting payment.
          </p>
        )}
      </section>
      <section className="surface">
        <div className="surface-heading">
          <h2>Payment records</h2>
          <span>{data.payments.length} recorded</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Recipient / claim</th>
                <th>Payment date</th>
                <th>External reference</th>
                <th className="align-right">Amount</th>
                <th>Bank reconciliation</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => {
                const e = data.expenses.find((e) => e.id === p.expenseId);
                return (
                  <tr key={p.id}>
                    <td>
                      <strong>{e?.claimant}</strong>
                      <small>{e?.merchant}</small>
                    </td>
                    <td>{p.date}</td>
                    <td className="mono">{p.reference}</td>
                    <td className="align-right amount">
                      {money(p.amountMinor)}
                    </td>
                    <td>
                      {p.reconciled ? (
                        <span className="badge green">
                          <CheckCheck size={13} />
                          Reconciled
                        </span>
                      ) : (
                        <button
                          className="text-button"
                          onClick={async () => {
                            try {
                              onData(await api.reconcile(p.id));
                              notify("Bank reconciliation recorded.");
                            } catch (x) {
                              notify(String(x), true);
                            }
                          }}
                        >
                          Mark reconciled
                          <Check size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
export function ReportsPanel({
  data,
  notify,
  onPrivacy,
  onData,
}: {
  data: Snapshot;
  notify: (message: string, error?: boolean) => void;
  onPrivacy: (expense: Expense) => void;
  onData: (data: Snapshot) => void;
}) {
  const [profile, setProfile] = useState<Profile>("funder");
  return (
    <div className="panel-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">SHARE WITH INTENTION</span>
          <h1>Reports & privacy</h1>
          <p>Choose a recipient, preview the report, then export.</p>
        </div>
      </div>
      <ExportPanel
        recipientControls={
          <div className="audience-grid">
            <button
              className={`audience-card ${profile === "funder" ? "selected" : ""}`}
              aria-pressed={profile === "funder"}
              onClick={() => setProfile("funder")}
            >
              <span className="audience-icon">
                <Shield size={23} />
              </span>
              <div>
                <h2>Funder</h2>
                <p>
                  Approved allocations and payment status. Names and purpose
                  excluded.
                </p>
                <span className="badge green">Minimal fields</span>
              </div>
              <span className="radio-dot" />
            </button>
            <button
              className={`audience-card ${profile === "bookkeeper" ? "selected" : ""}`}
              aria-pressed={profile === "bookkeeper"}
              onClick={() => setProfile("bookkeeper")}
            >
              <span className="audience-icon">
                <Users size={23} />
              </span>
              <div>
                <h2>Bookkeeper</h2>
                <p>
                  Detailed rows with claimant, merchant, purpose and approval
                  references.
                </p>
                <span className="badge amber">Includes identity fields</span>
              </div>
              <span className="radio-dot" />
            </button>
          </div>
        }
        data={data}
        spec={{ kind: "report", profile }}
        notify={notify}
        onData={onData}
      />
      <details className="surface receipt-copies">
        <summary>Receipt copies · {data.expenses.length}</summary>
        <p>
          Review private details before sharing a separate copy. Originals
          remain unchanged.
        </p>
        {data.expenses.map((e) => (
          <button
            className="list-row clickable"
            key={e.id}
            onClick={() => onPrivacy(e)}
          >
            <span className="document-mini">
              <FileSpreadsheet size={19} />
            </span>
            <span className="grow">
              <strong>{e.merchant || e.filename}</strong>
              <small>{e.filename}</small>
            </span>
            <span>Review copy</span>
            <ChevronRight size={16} />
          </button>
        ))}
      </details>
    </div>
  );
}
export function ActivityPanel({ data }: { data: Snapshot }) {
  const [filter, setFilter] = useState("");
  const events = data.events.filter((e) => !filter || e.targetId === filter);
  return (
    <div className="panel-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">KEEP THE THREAD</span>
          <h1>Activity</h1>
          <p>A recorded history of imports, decisions and settlement.</p>
        </div>
        <div className="activity-filter">
          <label htmlFor="activity-receipt-filter">Filter by receipt</label>
          <select
            id="activity-receipt-filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All activity</option>
            {data.expenses.map((e) => (
              <option key={e.id} value={e.id}>
                {e.merchant || e.filename}
              </option>
            ))}
          </select>
        </div>
      </div>
      {filter && data.expenses.find((e) => e.id === filter) && (
        <RecordHistory
          expense={data.expenses.find((e) => e.id === filter)!}
          data={data}
        />
      )}
      <section className="surface timeline">
        {events.map((e) => (
          <div className="timeline-event" key={e.id}>
            <span className="timeline-dot">
              <History size={14} />
            </span>
            <div>
              <strong>{e.action}</strong>
              <p>{e.detail}</p>
              <small>
                {new Date(e.at).toLocaleString()} · {e.targetId.slice(0, 12)}
              </small>
            </div>
          </div>
        ))}
        {!events.length && (
          <p className="empty-inline">No activity for this selection.</p>
        )}
      </section>
      <div className="inline-note">
        <Info size={16} />
        <p>
          History supports normal review. A person who controls the device and
          database credentials can alter records; this is not independent
          tamper-proof evidence.
        </p>
      </div>
    </div>
  );
}
export function RecoveryPanel({
  data,
  onData,
  notify,
}: Common & { onReports: () => void }) {
  const [profile, setProfile] = useState<Profile>("funder");
  if (!desktop)
    return (
      <div className="panel-page recovery-export-page">
        <div className="page-heading">
          <div>
            <h1>Export report</h1>
            <p>Approved reimbursement records · CSV or PDF</p>
          </div>
        </div>
        <label className="export-recipient">
          Recipient
          <select
            value={profile}
            onChange={(e) => setProfile(e.target.value as Profile)}
          >
            <option value="funder">Funder · minimal fields</option>
            <option value="bookkeeper">
              Bookkeeper · includes identity fields
            </option>
          </select>
        </label>
        <ExportPanel
          data={data}
          onData={onData}
          notify={notify}
          spec={{ kind: "report", profile }}
          prepareLabel="Export report"
        />
        <p className="export-custody-note">
          Report files don’t restore this temporary workspace.
        </p>
      </div>
    );
  return (
    <div className="panel-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">CARE FOR THE RECORD</span>
          <h1>Backup & recovery</h1>
          <p>
            {desktop
              ? "Make it possible for your organization to recover its records."
              : "Know what stays, what clears, and which outputs to keep."}
          </p>
        </div>
      </div>
      <details className="desktop-recovery-context" open={desktop}>
        <summary>Desktop database recovery responsibilities</summary>
        <div className="recovery-grid">
          <section className="surface recovery-card">
            <span className="large-icon">
              <HardDrive size={28} />
            </span>
            <h2>Keep a protected database backup</h2>
            <p>
              {desktop
                ? "Your database administrator manages consistent backups of receipts, financial records and history. Confirm that backups are encrypted and stored separately from the live database."
                : "Browser records are temporary. Download the reports and reviewed receipt copies you need before closing this tab."}
            </p>
          </section>
          <section className="surface recovery-card">
            <span className="large-icon warm">
              <RotateCcw size={28} />
            </span>
            <h2>Practice recovery into a separate database</h2>
            <p>
              Have your administrator restore a backup into a separate database
              and verify original-document hashes, record counts and totals
              before switching the organization to it.
            </p>
            <div className="recovery-status">
              <Check size={15} />
              Keep the current database until recovery is verified
            </div>
          </section>
        </div>
        <section className="surface recovery-guide">
          <h2>Assign a recovery custodian</h2>
          <p>
            Record who can access backups and database credentials when the
            usual operator is away. A successful backup alone does not establish
            that recovery works.
          </p>
          <div className="engine-detail">
            <LockKeyhole size={15} />
            {desktop
              ? `${data.storageEngine} · organization-managed database`
              : "Temporary browser workspace"}
          </div>
        </section>
      </details>
    </div>
  );
}
export function PaymentModal({
  expense,
  onData,
  notify,
  onClose,
}: {
  expense: Expense;
  onData: (s: Snapshot) => void;
  notify: (s: string, error?: boolean) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(
    decimal(
      (BigInt(expense.eligibleMinor) - BigInt(expense.paidMinor)).toString(),
    ),
  );
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Record an external payment"
      subtitle={`${expense.claimant} · ${expense.merchant}`}
      onClose={onClose}
    >
      <div className="modal-content form-stack">
        <div className="payment-summary">
          <span>Still owed</span>
          <strong>
            {money(BigInt(expense.eligibleMinor) - BigInt(expense.paidMinor))}
          </strong>
        </div>
        <div className="field-row">
          <label>
            Amount paid · USD
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Payment date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
        <label>
          External payment reference
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Bank confirmation or check number"
          />
        </label>
        <div className="inline-note">
          <Info size={15} />
          <p>
            Enter the payment you already made. Bank reconciliation will be a
            separate step.
          </p>
        </div>
        <button
          className="button primary full"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              onData(
                await api.pay(expense.id, toMinor(amount), reference, date),
              );
              notify("External payment recorded.");
              onClose();
            } catch (e) {
              notify(String(e), true);
            } finally {
              setBusy(false);
            }
          }}
        >
          Record payment
          <Check size={16} />
        </button>
      </div>
    </Modal>
  );
}
