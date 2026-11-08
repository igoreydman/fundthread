import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "./api";
import {
  analytics,
  dailySeries,
  type AnalyticsGroup,
  type DateRange,
} from "./analytics";
import { money } from "./money";
import { ExportPanel } from "./ExportPanel";
import type { Snapshot } from "./types";

function Breakdown({ title, rows }: { title: string; rows: AnalyticsGroup[] }) {
  const max = rows.reduce((n, row) => (row.amount > n ? row.amount : n), 0n);
  return (
    <section className="surface analytics-breakdown">
      <h2>{title}</h2>
      {!rows.length ? (
        <p className="empty-inline">No approved expenses in this range.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{title === "By fund" ? "Fund" : "Category"}</th>
              <th className="align-right">Approved expense</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">
                  <span>{row.label}</span>
                  <span className="analytics-meter" aria-hidden="true">
                    <span
                      style={{
                        width: `${max ? (Number(row.amount) / Number(max)) * 100 : 0}%`,
                      }}
                    />
                  </span>
                </th>
                <td className="align-right amount">{money(row.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
const CHART_COLORS = [
  "#5965F2",
  "#596375",
  "#E98167",
  "#11172C",
  "#267D83",
  "#6479CD",
  "#78643D",
  "#99A2B5",
];
function DailyChart({
  rows,
  active,
  onActive,
  onDetails,
}: {
  rows: ReturnType<typeof analytics>["dailyCategories"];
  active: string;
  onActive: (date: string) => void;
  onDetails: (date: string) => void;
}) {
  const view = dailySeries(rows);
  const max = rows.reduce((n, r) => (r.amount > n ? r.amount : n), 0n);
  if (!max)
    return (
      <div className="daily-zero">
        <strong>$0.00</strong>
        <span>No approved expense on these receipt dates.</span>
      </div>
    );
  if (rows.length === 1)
    return (
      <div
        className="single-day-chart"
        aria-label="Approved expense by category for one receipt date"
      >
        <div className="single-day-total">
          <span>{rows[0].label}</span>
          <strong>{money(rows[0].amount)}</strong>
        </div>
        {view.series.map((series, i) => (
          <button
            className="single-category-row"
            key={series.label}
            onClick={() => onDetails(rows[0].label)}
            aria-controls="daily-category-details"
          >
            <span>{series.label}</span>
            <span className="single-category-track" aria-hidden="true">
              <span
                style={{
                  width: `${(Number(view.days[0].amounts[i]) / Number(max)) * 100}%`,
                  background: CHART_COLORS[series.color],
                }}
              />
            </span>
            <strong>{money(view.days[0].amounts[i])}</strong>
          </button>
        ))}
      </div>
    );
  const left = Math.max(88, money(max).length * 6 + 16),
    right = 878,
    bottom = 186,
    top = 24,
    step = (right - left) / rows.length;
  const selected =
    view.days.find((d) => d.label === active) ||
    view.days.find((d) => d.amount > 0n) ||
    view.days[0];
  return (
    <div className="daily-composition">
      <ul className="daily-legend" aria-label="Daily expense categories">
        {view.series.map((series, i) => (
          <li key={series.label}>
            <span
              style={{ background: CHART_COLORS[series.color] }}
              aria-hidden="true"
            />
            {series.label}
          </li>
        ))}
      </ul>
      <svg
        className="daily-chart"
        viewBox="0 0 900 224"
        aria-labelledby="daily-chart-title daily-chart-description"
      >
        <title id="daily-chart-title">
          Approved expense by receipt date and category
        </title>
        <desc id="daily-chart-description">
          Daily totals and category composition. Arrow keys move between dates;
          Enter opens the daily table. Exact dollar values are in the daily
          details.
        </desc>
        {[0, 0.5, 1].map((part) => (
          <g key={part}>
            <line
              x1={left}
              y1={bottom - (bottom - top) * part}
              x2={right}
              y2={bottom - (bottom - top) * part}
              stroke="var(--line)"
            />
            <text
              x={left - 12}
              y={bottom - (bottom - top) * part + 4}
              textAnchor="end"
            >
              {money(part === 1 ? max : part === 0.5 ? max / 2n : 0n)}
            </text>
          </g>
        ))}
        {view.days.map((day, i) => {
          let cumulative = 0n;
          const label = `${day.label}: ${money(day.amount)}. ${view.series.map((s, n) => `${s.label} ${money(day.amounts[n])}`).join("; ")}. Show daily details.`;
          return (
            <g
              key={day.label}
              data-chart-day={i}
              role="button"
              aria-label={label}
              aria-controls="daily-category-details"
              tabIndex={selected.label === day.label ? 0 : -1}
              onMouseEnter={() => onActive(day.label)}
              onFocus={() => onActive(day.label)}
              onClick={() => onDetails(day.label)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onDetails(day.label);
                } else if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  const next =
                    e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? rows.length - 1
                        : Math.max(
                            0,
                            Math.min(
                              rows.length - 1,
                              i + (e.key === "ArrowRight" ? 1 : -1),
                            ),
                          );
                  e.currentTarget.parentElement
                    ?.querySelector<SVGGElement>(`[data-chart-day="${next}"]`)
                    ?.focus();
                }
              }}
            >
              <title>{label}</title>
              <rect
                className="daily-hit-area"
                x={left + step * i}
                y={top}
                width={step}
                height={bottom - top}
                fill={day.label === active ? "#edf1ff" : "transparent"}
              />
              {day.amounts.map((value, n) => {
                const h = (Number(value) / Number(max)) * (bottom - top),
                  y =
                    bottom -
                    (Number(cumulative + value) / Number(max)) * (bottom - top);
                cumulative += value;
                return (
                  <rect
                    key={n}
                    x={left + step * (i + 0.5) - Math.min(40, step * 0.7) / 2}
                    y={y}
                    width={Math.min(40, step * 0.7)}
                    height={h}
                    fill={CHART_COLORS[view.series[n].color]}
                    stroke="#fff"
                    strokeWidth={value ? 0.6 : 0}
                  />
                );
              })}
              {(rows.length <= 7 ||
                i === 0 ||
                i === rows.length - 1 ||
                i === Math.floor(rows.length / 2)) && (
                <text x={left + step * (i + 0.5)} y={210} textAnchor="middle">
                  {day.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="daily-active-value">
        <span>{selected.label}</span>
        <strong>{money(selected.amount)}</strong>
        <span>
          {selected.count} {selected.count === 1 ? "claim" : "claims"}
        </span>
      </p>
    </div>
  );
}
export function AnalyticsPanel({
  data,
  onData,
  notify,
}: {
  data: Snapshot;
  onData: (data: Snapshot) => void;
  notify: (message: string, error?: boolean) => void;
}) {
  const [range, setRange] = useState<DateRange>({ start: "", end: "" });
  const [refreshing, setRefreshing] = useState(false);
  const [activeDay, setActiveDay] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    setActiveDay("");
  }, [range.start, range.end]);
  let result: ReturnType<typeof analytics> | undefined,
    error = "";
  try {
    result = analytics(data, range);
  } catch (reason) {
    error = String(reason);
  }
  return (
    <div className="panel-page analytics-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">THE FINANCIAL PICTURE</span>
          <h1>Analytics</h1>
          <p>Approved expense, payments and work still to review.</p>
        </div>
        <button
          className="button secondary"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            try {
              onData(await api.snapshot());
            } catch (reason) {
              notify(String(reason), true);
            } finally {
              setRefreshing(false);
            }
          }}
        >
          <RefreshCw size={16} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      <fieldset className="analytics-range">
        <legend>Receipt dates</legend>
        <div className="analytics-range-fields">
          <label>
            From
            <input
              type="date"
              aria-label="Analytics start date"
              value={range.start}
              onChange={(e) => setRange({ ...range, start: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              type="date"
              aria-label="Analytics end date"
              value={range.end}
              onChange={(e) => setRange({ ...range, end: e.target.value })}
            />
          </label>
          <button
            className="button secondary"
            onClick={() => setRange({ start: "", end: "" })}
          >
            All dates
          </button>
        </div>
      </fieldset>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="analytics-period">{result.rangeLabel}</p>
          <div className="analytics-stats" aria-label="Analytics totals">
            <div>
              <span>Approved expense</span>
              <strong>{money(result.approvedAmount)}</strong>
              <small>
                {result.approvedCount} approved{" "}
                {result.approvedCount === 1 ? "claim" : "claims"}
              </small>
            </div>
            <div>
              <span>Paid on these expenses</span>
              <strong>{money(result.paid)}</strong>
              <small>For these receipts</small>
            </div>
            <div>
              <span>Still owed</span>
              <strong>{money(result.owed)}</strong>
              <small>On approved claims</small>
            </div>
            <div>
              <span>Needs review</span>
              <strong>{result.needsReview}</strong>
              <small>
                {result.awaitingDecision} awaiting external decision
              </small>
            </div>
          </div>
          <section className="surface analytics-daily">
            <div className="surface-heading">
              <div>
                <h2>Daily approved expense</h2>
                <p>Eligible amounts · receipt dates · USD</p>
              </div>
            </div>
            {!result.daily.length ? (
              <p className="empty-inline">No dated receipts in this range.</p>
            ) : (
              <>
                <DailyChart
                  rows={result.dailyCategories}
                  active={activeDay}
                  onActive={setActiveDay}
                  onDetails={(date) => {
                    setActiveDay(date);
                    setDetailsOpen(true);
                  }}
                />
                <p className="analytics-chart-note">
                  {result.zeroDaysIncluded
                    ? "Days without a recorded approved expense show $0.00."
                    : "Recorded days are shown; gaps are not plotted."}
                </p>
                <details
                  className="analytics-daily-table"
                  id="daily-category-details"
                  open={detailsOpen}
                  onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
                >
                  <summary>Daily amounts & categories</summary>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th className="align-right">Approved expense</th>
                          <th className="align-right">Claims</th>
                          <th>Category breakdown</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.dailyCategories.map((row) => (
                          <tr
                            key={row.label}
                            className={
                              activeDay === row.label ? "active-day" : ""
                            }
                          >
                            <th scope="row">{row.label}</th>
                            <td className="align-right">{money(row.amount)}</td>
                            <td className="align-right">{row.count}</td>
                            <td>
                              <ul className="day-category-values">
                                {row.categories.map((c) => (
                                  <li key={c.label}>
                                    <span>{c.label}</span>
                                    <strong>{money(c.amount)}</strong>
                                  </li>
                                ))}
                              </ul>
                              {!row.categories.length && "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </section>
          <div className="analytics-breakdowns">
            <Breakdown title="By expense category" rows={result.categories} />
            <Breakdown title="By fund" rows={result.funds} />
          </div>
          <section className="surface analytics-context">
            <div>
              <span>Recorded receipt total</span>
              <strong>{money(result.gross)}</strong>
              <small>
                {result.expenses.length} receipts · includes amounts not yet
                approved
              </small>
            </div>
            <div>
              <span>Undated receipts</span>
              <strong>
                {result.undatedCount} · {money(result.undatedGross)}
              </strong>
              <small>
                {range.start || range.end
                  ? "Outside this date filter"
                  : "Included in receipt total; not plotted by day"}
              </small>
            </div>
          </section>
          <ExportPanel
            data={data}
            spec={{ kind: "analytics", ...range }}
            notify={notify}
            onData={onData}
          />
        </>
      )}
    </div>
  );
}
