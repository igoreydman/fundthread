import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "./api";
import { Modal } from "./Modal";
import { toMinor } from "./money";
import { CATEGORIES, type FundInput, type Snapshot } from "./types";

export function NewFundModal({
  onCreated,
  onClose,
  notify,
}: {
  onCreated: (snapshot: Snapshot, fundId: string) => void;
  onClose: () => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    code: "",
    budget: "",
    periodStart: `${new Date().getFullYear()}-01-01`,
    periodEnd: `${new Date().getFullYear()}-12-31`,
    categories: [] as string[],
    restrictions: "",
  });
  async function add() {
    setBusy(true);
    try {
      const input: FundInput = {
        name: form.name.trim(),
        code: form.code.trim(),
        budgetMinor: toMinor(form.budget),
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
        categories: form.categories,
        restrictions: form.restrictions.trim(),
      };
      const next = await api.fund(input);
      const created = next.funds.find((f) => f.code === input.code.trim());
      if (!created) throw new Error("The created fund could not be found.");
      onCreated(next, created.id);
      onClose();
      notify("Fund created with its opening budget and configured rules.");
    } catch (e) {
      notify(String(e), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Create a fund"
      subtitle="Record the grant’s budget and the rules your team will check."
      onClose={() => !busy && onClose()}
    >
      <div className="modal-content form-stack">
        <label>
          Fund name
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Safe Futures workshops"
          />
        </label>
        <div className="field-row">
          <label>
            Grant / fund code
            <input
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              placeholder="SF-2026"
            />
          </label>
          <label>
            Opening budget · USD
            <input
              inputMode="decimal"
              value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })}
              placeholder="24000.00"
            />
          </label>
        </div>
        <div className="field-row">
          <label>
            Period starts
            <input
              type="date"
              value={form.periodStart}
              onChange={(e) =>
                setForm({ ...form, periodStart: e.target.value })
              }
            />
          </label>
          <label>
            Period ends
            <input
              type="date"
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
            />
          </label>
        </div>
        <label>
          Allowed categories
          <small>Leave all unchecked for no category restriction.</small>
        </label>
        <div className="category-checks">
          {CATEGORIES.map((c) => (
            <label key={c} className="check-label">
              <input
                type="checkbox"
                checked={form.categories.includes(c)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    categories: e.target.checked
                      ? [...form.categories, c]
                      : form.categories.filter((x) => x !== c),
                  })
                }
              />
              {c}
            </label>
          ))}
        </div>
        <label>
          Restriction and source notes
          <textarea
            rows={3}
            value={form.restrictions}
            onChange={(e) => setForm({ ...form, restrictions: e.target.value })}
            placeholder="Summarize the grant terms and reference the source agreement."
          />
        </label>
        <button className="button primary full" disabled={busy} onClick={add}>
          Create fund
          <ArrowRight size={16} />
        </button>
      </div>
    </Modal>
  );
}
