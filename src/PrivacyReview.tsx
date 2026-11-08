import { useEffect, useRef, useState } from "react";
import {
  Check,
  Download,
  Info,
  LoaderCircle,
  ScanText,
  Search,
  Shield,
  Undo2,
} from "lucide-react";
import { Modal } from "./Modal";
import { DocumentView, type DocumentHandle } from "./DocumentView";
import { api, desktop } from "./api";
import { suggestedMask } from "./pdfGeometry";
import type { Box, Expense, Word } from "./types";
export function PrivacyReview({
  expense,
  onClose,
  notify,
}: {
  expense: Expense;
  onClose: () => void;
  notify: (s: string, error?: boolean) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);
  const [focus, setFocus] = useState<Box>();
  const viewer = useRef<DocumentHandle>(null);
  const [masks, setMasks] = useState<Box[]>([]);
  const [words, setWords] = useState<Word[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [seen, setSeen] = useState<Set<number>>(new Set());
  const [count, setCount] = useState(1);
  const [search, setSearch] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  useEffect(() => {
    let dead = false;
    alive.current = true;
    void api
      .privacyPlan(expense.documentId)
      .then((x) => {
        if (!dead) {
          setMasks(x);
          setLoaded(true);
        }
      })
      .catch((e) => notify(String(e), true));
    return () => {
      dead = true;
      alive.current = false;
    };
  }, [expense.documentId]);
  async function changeMasks(x: Box[]) {
    if (!loaded || busy) return;
    setMasks(x);
    setConfirmed(false);
    try {
      await api.savePrivacyPlan(expense.documentId, x);
    } catch (e) {
      notify(`Mask plan could not be saved: ${String(e)}`, true);
    }
  }
  const matches = words.filter((w) =>
    search.trim()
      ? w.text.toLowerCase().includes(search.trim().toLowerCase())
      : /@|\b\d{3}[-.]\d{2}[-.]\d{4}\b/.test(w.text) ||
        (!/^\d{4}-\d{2}-\d{2}$/.test(w.text.trim()) &&
          /(?:\+?\d[\d ().-]{7,}\d)/.test(w.text)) ||
        expense.claimant
          .toLowerCase()
          .split(/\s+/)
          .filter((x) => x.length > 1)
          .some((x) => w.text.toLowerCase().includes(x)),
  );
  async function find() {
    setBusy(true);
    try {
      const x = await viewer.current!.extract();
      setWords(x.words);
      notify(
        "Suggestions are ready for this page. Check names and other private details manually.",
      );
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  async function write() {
    setBusy(true);
    try {
      const bytes = await viewer.current!.exportPdf([...masks]);
      if (!alive.current) return;
      if (await api.writePdf(expense, bytes, confirmed))
        notify(
          desktop
            ? "Reviewed copy saved. The archived original is unchanged."
            : "Reviewed PDF downloaded. The original in this tab is unchanged.",
        );
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Share a receipt, with care"
      subtitle={
        desktop
          ? "Create a separate copy. Your original stays in the organization’s database."
          : "Create a separate copy. Your original stays unchanged in this tab."
      }
      onClose={onClose}
      wide
    >
      <div className="privacy-workspace">
        <DocumentView
          ref={viewer}
          expense={expense}
          fitToPage
          highlight={focus}
          privacy
          maskingDisabled={busy || !loaded}
          masks={masks}
          onMasks={(x) => void changeMasks(x)}
          onProgress={setProgress}
          onPage={(page, total) => {
            setCount(total);
            setSeen((x) => new Set([...x, page]));
          }}
        />
        <aside className="privacy-controls">
          <div className="privacy-hero">
            <Shield size={25} />
            <h3>Only share what’s needed.</h3>
            <p>
              Drag over names, contact details, account numbers or unrelated
              information on the receipt.
            </p>
          </div>
          <div className="privacy-count">
            <strong>{masks.length}</strong>
            <span>
              regions masked
              <br />
              <small>
                {seen.size} of {count} pages opened
              </small>
            </span>
          </div>
          <button
            className="button secondary full"
            disabled={busy || !loaded}
            onClick={find}
          >
            {busy && progress !== null ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ScanText size={16} />
            )}
            Find likely private details
          </button>
          <label className="search-field">
            <Search size={15} />
            <input
              value={search}
              placeholder="Find a name or word"
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="privacy-matches">
            {matches.map((w, i) => {
              const region = suggestedMask(w);
              const same = (m: Box) =>
                m.page === region.page &&
                m.x === region.x &&
                m.y === region.y &&
                m.w === region.w &&
                m.h === region.h;
              const masked = masks.some(same);
              return (
                <button
                  key={i}
                  disabled={busy || !loaded}
                  aria-pressed={masked}
                  onClick={() => {
                    setFocus(w);
                    void changeMasks(
                      masked
                        ? masks.filter((m) => !same(m))
                        : [...masks, region],
                    );
                  }}
                >
                  <span>{w.text}</span>
                  <span>
                    {masked ? "Unmask" : "Mask"}
                    {masked && <Check size={12} />}
                  </span>
                </button>
              );
            })}
            {!matches.length && words.length > 0 && (
              <p>
                No matching suggestions on this page. Continue your visual
                review.
              </p>
            )}
          </div>
          <div className="inline-note">
            <Info size={16} />
            <p>
              Suggestions can miss private information. Review every page. This
              copy contains rendered pixels, with no original PDF text or
              attachments.
            </p>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={seen.size < count || busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              I’ve reviewed all pages and the information this copy will share.
            </span>
          </label>
          <button
            className="button primary full"
            disabled={!loaded || !confirmed || busy || seen.size < count}
            onClick={write}
          >
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <Download size={16} />
            )}
            Save reviewed PDF copy
          </button>
          <small className="privacy-session-note">
            Mask positions are saved separately from the original. Review every
            page again before each export.
          </small>
        </aside>
      </div>
    </Modal>
  );
}
