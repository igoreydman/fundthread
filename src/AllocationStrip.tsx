import { money } from "./money";
import type { Allocation, Fund } from "./types";

export function AllocationStrip({
  allocations,
  eligible,
  funds,
}: {
  allocations: Allocation[];
  eligible: string;
  funds: Fund[];
}) {
  const total = BigInt(eligible || "0"),
    allocated = allocations.reduce((sum, a) => sum + BigInt(a.amountMinor), 0n);
  const colors = ["#5965F2", "#E98167", "#2D737B", "#79839C"];
  const color = (id: string) =>
    colors[
      Math.max(
        0,
        funds.findIndex((f) => f.id === id),
      ) % colors.length
    ];
  return (
    <div className="allocation-visual">
      <div className="allocation-visual-heading">
        <span>Fund allocation</span>
        <strong>{money(allocated)}</strong>
      </div>
      <div className="allocation-visual-bar" aria-hidden="true">
        {allocations.map((a) => (
          <span
            key={a.fundId}
            style={{
              width: `${total ? (Number(BigInt(a.amountMinor)) / Number(total)) * 100 : 0}%`,
              background: color(a.fundId),
            }}
          />
        ))}
      </div>
      <ul>
        {allocations.map((a) => (
          <li key={a.fundId}>
            <span
              className="fund-color"
              style={{ background: color(a.fundId) }}
              aria-hidden="true"
            />
            <span>
              {funds.find((f) => f.id === a.fundId)?.name || "Unknown fund"}
            </span>
            <strong>{money(a.amountMinor)}</strong>
          </li>
        ))}
      </ul>
      {allocated < total && (
        <p className="allocation-unassigned">
          {money(total - allocated)} unallocated
        </p>
      )}
      {!allocations.length && (
        <p className="allocation-unassigned">No fund assigned</p>
      )}
    </div>
  );
}
