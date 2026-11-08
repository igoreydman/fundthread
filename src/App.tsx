import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  FolderLock,
  HardDrive,
  History,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  Search,
  ShieldCheck,
  Wallet,
  X,
  FlaskConical,
  BarChart3,
} from "lucide-react";
import { api, desktop } from "./api";
import { ReviewDesk, status, type ReviewHandle } from "./ReviewDesk";
import {
  FundsPanel,
  PaymentsPanel,
  ReportsPanel,
  ActivityPanel,
  RecoveryPanel,
  PaymentModal,
} from "./Panels";
import { PrivacyReview } from "./PrivacyReview";
import { Modal } from "./Modal";
import { ImportReceipts } from "./ImportReceipts";
import { NewFundModal } from "./NewFundModal";
import { AnalyticsPanel } from "./AnalyticsPanel";
import { BatchWorkbench } from "./BatchWorkbench";
import type { ImportResult } from "./receiptImport";
import { money } from "./money";
import type { Expense, Snapshot } from "./types";
const pages = [
  { id: "receipts", label: "Receipts", icon: Inbox },
  { id: "funds", label: "Grant funds", icon: FolderLock },
  { id: "payments", label: "Reimbursements", icon: Wallet },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "reports", label: "Reports & privacy", icon: ShieldCheck },
  { id: "activity", label: "Activity", icon: History },
  { id: "recovery", label: "Backup & recovery", icon: HardDrive },
] as const;
type Page = (typeof pages)[number]["id"];
export function App() {
  const [data, setData] = useState<Snapshot>();
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string>();
  const [exists, setExists] = useState(false);
  const [page, setPage] = useState<Page>("receipts");
  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<() => void>();
  const [toast, setToast] = useState<{ text: string; error: boolean }>();
  const [busy, setBusy] = useState(false);
  const [privacy, setPrivacy] = useState<string>();
  const [pay, setPay] = useState<string>();
  const [paused, setPaused] = useState(false);
  const [temporaryCount, setTemporaryCount] = useState(0);
  const [importing, setImporting] = useState<File[] | null>(null);
  const [importResult, setImportResult] = useState<ImportResult>();
  const [resetting, setResetting] = useState(false);
  const [firstFund, setFirstFund] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const personal = !desktop && api.browserMode() === "personal";
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const review = useRef<ReviewHandle>(null);
  const search = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  function notify(text: string, error = false) {
    setToast({ text, error });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(undefined), 7000);
  }
  function update(s: Snapshot) {
    setTemporaryCount(
      !desktop && api.browserMode() === "personal" ? s.expenses.length : 0,
    );
    setData(s);
    setSelected((id) =>
      s.expenses.some((e) => e.id === id) ? id : s.expenses[0]?.id || "",
    );
    setExists(true);
  }
  async function loadWorkspace() {
    setReady(false);
    setStartupError(undefined);
    try {
      const state = await api.status();
      setExists(state.exists);
      if (state.unlocked) update(await api.snapshot());
    } catch (error) {
      setStartupError(String(error));
    } finally {
      setReady(true);
    }
  }
  useEffect(() => {
    void loadWorkspace();
  }, []);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const unlisten = await win.onCloseRequested((event) => {
        if (dirtyRef.current) {
          event.preventDefault();
          setPending(() => () => {
            setDirty(false);
            dirtyRef.current = false;
            void win.close();
          });
        }
      });
      if (disposed) unlisten();
      else off = unlisten;
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || (personal && temporaryCount > 0)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, personal, temporaryCount]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    void import("@tauri-apps/api/event").then(async ({ listen }) => {
      const a = await listen<ImportResult>("receipts-imported", (event) => {
        void api.snapshot().then(update);
        if (event.payload.failures.length) setImportResult(event.payload);
        notify(
          `${event.payload.outcomes.filter((x) => !x.duplicate).length} originals archived. Reading locally.`,
        );
      });
      const b = await listen<string>("import-error", (e) =>
        notify(e.payload, true),
      );
      if (disposed) {
        a();
        b();
      } else cleanups.push(a, b);
    });
    return () => {
      disposed = true;
      cleanups.forEach((f) => f());
    };
  }, []);
  function guard(action: () => void) {
    if (!dirty) {
      action();
      return;
    }
    void review.current
      ?.saveDraft()
      .then(() => {
        setDirty(false);
        action();
      })
      .catch(() => setPending(() => action));
  }
  function navigate(p: Page) {
    guard(() => {
      setDirty(false);
      setPage(p);
    });
  }
  async function importReceipts() {
    if (!desktop) {
      guard(() => setImporting([]));
      return;
    }
    setBusy(true);
    try {
      const result = await api.import();
      const outcomes = result.outcomes;
      if (result.failures.length) setImportResult(result);
      if (outcomes.length) {
        update(await api.snapshot());
        guard(() => {
          setPage("receipts");
          setSelected(outcomes[0].expenseId);
          setDirty(false);
        });
        const duplicates = outcomes.filter((o) => o.duplicate).length;
        notify(
          duplicates
            ? `${outcomes.length - duplicates} imported · ${duplicates} exact duplicate${duplicates === 1 ? "" : "s"} already archived.`
            : desktop
              ? `${outcomes.length} original${outcomes.length === 1 ? "" : "s"} archived. Reading locally.`
              : "A fictional receipt was added to this sample.",
        );
      }
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  async function importBrowserFiles(files: File[]) {
    if (!files.length || busy) return;
    setBusy(true);
    setImporting(null);
    try {
      if (api.browserMode() === "sample") {
        setPrivacy(undefined);
        setPay(undefined);
        setSelected("");
        setQuery("");
        setFilter("all");
        update(await api.startPersonal());
      }
      const result = await api.importFiles(files);
      const snapshot = await api.snapshot();
      update(snapshot);
      setPage("receipts");
      setDirty(false);
      if (result.outcomes.length) setSelected(result.outcomes[0].expenseId);
      if (result.failures.length) setImportResult(result);
      else {
        const duplicates = result.outcomes.filter((x) => x.duplicate).length;
        notify(
          duplicates
            ? `${duplicates} exact duplicate${duplicates === 1 ? " is" : "s are"} already in this tab. Originals were not added again.`
            : `${result.outcomes.length} receipt${result.outcomes.length === 1 ? "" : "s"} added to this tab. Reading locally.`,
        );
      }
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  async function returnToSample() {
    setPrivacy(undefined);
    setPay(undefined);
    setSelected("");
    setQuery("");
    setFilter("all");
    setPage("receipts");
    setDirty(false);
    setResetting(false);
    update(await api.startSample());
    notify(
      "Fictional sample restored. Your temporary browser session was cleared.",
    );
  }
  async function lock() {
    try {
      await api.lock();
      setData(undefined);
      setDirty(false);
      if (!desktop) setPaused(true);
    } catch (error) {
      notify(String(error), true);
    }
  }
  const expense = data?.expenses.find((e) => e.id === selected);
  const privacyExpense = data?.expenses.find((e) => e.id === privacy);
  const payExpense = data?.expenses.find((e) => e.id === pay);
  const visible =
    data?.expenses.filter(
      (e) =>
        (filter === "all" ||
          (filter === "review" && !e.reviewed) ||
          (filter === "approval" && e.reviewed && !e.approved) ||
          (filter === "settlement" &&
            e.approved &&
            e.reconciledMinor !== e.eligibleMinor)) &&
        `${e.merchant} ${e.filename} ${e.claimant} ${e.purpose}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    ) || [];
  if (!ready)
    return (
      <div className="boot-screen">
        <img src="/mark.svg" width="48" />
        <LoaderCircle className="spin" />
        <p>Opening FundThread…</p>
      </div>
    );
  if (!data)
    return (
      <Unlock
        exists={exists}
        connectionError={startupError}
        onRetry={() => void loadWorkspace()}
        paused={paused}
        onOpen={update}
        notify={notify}
        onPreview={async () => {
          update(await api.snapshot());
          setPaused(false);
        }}
      />
    );
  return (
    <div
      className={`app-shell ${dragging ? "is-receipt-dragging" : ""}`}
      onDragEnter={(e) => {
        if (!desktop && e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (!dragDepth.current) setDragging(false);
      }}
      onDragOver={(e) => {
        if (!desktop && e.dataTransfer.types.includes("Files"))
          e.preventDefault();
      }}
      onDrop={(e) => {
        if (desktop || !e.dataTransfer.files.length) return;
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        guard(() =>
          personal ? void importBrowserFiles(files) : setImporting(files),
        );
      }}
    >
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          aria-label="FundThread home"
          onClick={(e) => {
            e.preventDefault();
            navigate("receipts");
          }}
        >
          <span className="brand-monogram">FT</span>
        </a>
        <nav aria-label="Workspace">
          {pages.map((p) => (
            <button
              key={p.id}
              aria-label={p.label}
              title={p.label}
              onClick={() => navigate(p.id)}
              aria-current={page === p.id ? "page" : undefined}
              className={page === p.id ? "active" : ""}
            >
              <p.icon size={19} />
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="operator"
            aria-label={
              desktop
                ? "Disconnect workspace"
                : personal
                  ? "Pause workspace"
                  : "Pause sample"
            }
            title={
              desktop
                ? "Disconnect workspace"
                : personal
                  ? "Pause workspace"
                  : "Pause sample"
            }
            disabled={busy}
            onClick={() => guard(() => void lock())}
          >
            <span className="avatar small">{data.operator.slice(0, 1)}</span>
          </button>
        </div>
      </aside>
      <main className="main-content">
        <header className="app-header">
          <div className="breadcrumb">
            Workspace
            <ChevronRight size={13} />
            <strong>{pages.find((p) => p.id === page)?.label}</strong>
          </div>
          <div className="header-end">
            {personal && (
              <button
                className="icon-button"
                aria-label="Return to sample"
                title="Return to sample"
                disabled={busy}
                onClick={() => guard(() => setResetting(true))}
              >
                <FlaskConical size={16} />
              </button>
            )}
            <span className="local-status">
              <span className="tiny-dot" />
              {desktop
                ? "Database · connected"
                : personal
                  ? "On-device · temporary"
                  : "Sample data"}
            </span>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void importReceipts()}
            >
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <ArrowDownToLine size={16} />
              )}
              {busy ? "Importing…" : "Import receipts"}
            </button>
          </div>
        </header>
        <div hidden={page !== "receipts"} className="batch-page">
          {dragging && (
            <div className="batch-drop-feedback" role="status">
              <ArrowDownToLine size={20} />
              <strong>Drop receipts to import</strong>
              <span>PDF · JPEG · PNG</span>
            </div>
          )}
          <BatchWorkbench
            key={desktop ? "desktop" : api.browserMode()}
            ref={review}
            data={data}
            onData={update}
            onDirty={setDirty}
            notify={notify}
            onPrivacy={(e) => setPrivacy(e.id)}
            onPay={(e) => setPay(e.id)}
            onFund={() => setFirstFund(true)}
            onImport={() => void importReceipts()}
          />
        </div>
        {page === "receipts" ? null : page === "funds" ? (
          <FundsPanel data={data} onData={update} notify={notify} />
        ) : page === "payments" ? (
          <PaymentsPanel
            data={data}
            onData={update}
            notify={notify}
            onPay={(e) => setPay(e.id)}
          />
        ) : page === "reports" ? (
          <ReportsPanel
            data={data}
            onData={update}
            notify={notify}
            onPrivacy={(e) => setPrivacy(e.id)}
          />
        ) : page === "analytics" ? (
          <AnalyticsPanel data={data} onData={update} notify={notify} />
        ) : page === "activity" ? (
          <ActivityPanel data={data} />
        ) : (
          <RecoveryPanel
            data={data}
            onData={update}
            notify={notify}
            onReports={() => navigate("reports")}
          />
        )}
      </main>
      {firstFund && (
        <NewFundModal
          notify={notify}
          onClose={() => setFirstFund(false)}
          onCreated={(next) => update(next)}
        />
      )}
      {importing !== null && (
        <ImportReceipts
          sample={!personal}
          initialFiles={importing}
          onFiles={importBrowserFiles}
          onClose={() => setImporting(null)}
        />
      )}
      {importResult && (
        <Modal
          title="Receipt import results"
          subtitle={
            desktop
              ? "Successful imports remain in the organization database."
              : "Successfully imported originals remain in this tab."
          }
          onClose={() => setImportResult(undefined)}
        >
          <div className="modal-content">
            <p>
              {importResult.outcomes.filter((x) => !x.duplicate).length} added ·{" "}
              {importResult.outcomes.filter((x) => x.duplicate).length} exact
              duplicates · {importResult.failures.length} couldn’t be imported
            </p>
            <div className="import-failures">
              {importResult.failures.map((f, i) => (
                <div key={i}>
                  <strong>{f.filename}</strong>
                  <p>{f.reason}</p>
                </div>
              ))}
            </div>
            <button
              className="button primary full"
              onClick={() => setImportResult(undefined)}
            >
              Continue reviewing
            </button>
          </div>
        </Modal>
      )}
      {resetting && (
        <Modal
          title="Return to the fictional sample?"
          subtitle="Your current browser session will be cleared."
          onClose={() => setResetting(false)}
        >
          <div className="modal-content">
            <p>
              Download any reviewed PDFs and reports you need first. Your source
              files on this computer are unchanged.
            </p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setResetting(false)}
              >
                Keep my workspace
              </button>
              <button
                className="button primary"
                onClick={() => void returnToSample()}
              >
                Clear session & open sample
              </button>
            </div>
          </div>
        </Modal>
      )}
      {privacyExpense && (
        <PrivacyReview
          expense={privacyExpense}
          notify={notify}
          onClose={() => setPrivacy(undefined)}
        />
      )}
      {payExpense && (
        <PaymentModal
          expense={payExpense}
          onData={update}
          notify={notify}
          onClose={() => setPay(undefined)}
        />
      )}
      {pending && (
        <Modal
          title="Keep your changes?"
          subtitle="Some edits haven’t been saved."
          onClose={() => setPending(undefined)}
        >
          <div className="modal-content">
            <p>
              Save these drafts before continuing, or return to correct the
              highlighted fields.
            </p>
            <div className="dialog-actions">
              <button
                className="button quiet"
                onClick={async () => {
                  await review.current?.discardDrafts?.();
                  setDirty(false);
                  pending();
                  setPending(undefined);
                }}
              >
                Discard edits
              </button>
              <button
                className="button secondary"
                onClick={() => setPending(undefined)}
              >
                Keep editing
              </button>
              <button
                className="button primary"
                onClick={async () => {
                  try {
                    await review.current?.saveDraft();
                    pending();
                    setPending(undefined);
                  } catch {
                    /* Save errors are shown by the review desk. */
                  }
                }}
              >
                Save draft & continue
              </button>
            </div>
          </div>
        </Modal>
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? "toast-error" : ""}`}
          role={toast.error ? "alert" : "status"}
        >
          {toast.error ? <X size={18} /> : <Check size={18} />}
          <span>{toast.text}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast(undefined)}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
function Unlock({
  exists,
  connectionError,
  onRetry,
  paused,
  onOpen,
  notify,
  onPreview,
}: {
  exists: boolean;
  connectionError?: string;
  onRetry: () => void;
  paused: boolean;
  onOpen: (s: Snapshot) => void;
  notify: (s: string, error?: boolean) => void;
  onPreview: () => void;
}) {
  const [organization, setOrganization] = useState("");
  const [operator, setOperator] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open() {
    setBusy(true);
    setError("");
    try {
      onOpen(
        exists ? await api.unlock() : await api.create(organization, operator),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="unlock-page">
      <div className="unlock-story">
        <a className="brand" href="#">
          <img src="/mark.svg" alt="" />
          <span>FundThread</span>
        </a>
        <span className="eyebrow">FOR THE PEOPLE BEHIND THE MISSION.</span>
        <h1>
          Keep the receipt.
          <br />
          Follow the funds.
        </h1>
        <p>
          A careful home for nonprofit receipts, restricted funds, reimbursement
          records and the information you choose to share.
        </p>
        <div className="unlock-thread">
          <span>Evidence</span>
          <i />
          <span>Decision</span>
          <i />
          <span>Accountability</span>
        </div>
        <div className="unlock-foot">
          <LockKeyhole size={18} />
          <span>Careful records. Organizational custody.</span>
        </div>
      </div>
      <div className="unlock-form">
        <span className="large-icon">
          <LockKeyhole size={27} />
        </span>
        <h2>
          {!desktop
            ? api.browserMode() === "personal"
              ? "Your receipt session is paused."
              : "Your sample is paused."
            : exists
              ? "Welcome back."
              : "Give your records a home."}
        </h2>
        <p>
          {!desktop
            ? api.browserMode() === "personal"
              ? "Your documents remain in this tab. Pausing does not lock or encrypt this session."
              : "Resume exploring fictional receipts and grant records."
            : exists
              ? "Connect to your organization’s database workspace."
              : "Initialize your organization’s configured database workspace."}
        </p>
        {!desktop ? (
          <button className="button primary full" onClick={onPreview}>
            {api.browserMode() === "personal"
              ? "Resume workspace"
              : "Resume sample"}
            <ArrowRight size={16} />
          </button>
        ) : connectionError ? (
          <div className="form-stack">
            <p className="form-error" role="alert">
              {connectionError}
            </p>
            <p>
              Ask your administrator to check the database connection, then try
              again. Your existing records have not been replaced.
            </p>
            <button className="button primary full" onClick={onRetry}>
              Try database connection again
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void open();
            }}
            className="form-stack"
          >
            {!exists && (
              <>
                <label>
                  Organization
                  <input
                    required
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    autoComplete="organization"
                  />
                </label>
                <label>
                  Your name or operator ID
                  <input
                    required
                    value={operator}
                    onChange={(e) => setOperator(e.target.value)}
                    autoComplete="name"
                  />
                  <small>
                    This labels your activity; it does not authenticate your
                    identity.
                  </small>
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <LockKeyhole size={16} />
              )}
              {exists ? "Connect to workspace" : "Create workspace"}
            </button>
          </form>
        )}
        <small className="unlock-detail">
          {desktop
            ? "Database access is managed by your organization. Files you export are separate copies."
            : "This browser workspace holds documents only in this tab. It has no passphrase lock or encrypted archive."}
        </small>
      </div>
    </div>
  );
}
