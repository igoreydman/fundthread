import { money, parseCsv } from "./money";
import { summarizeReport } from "./reportSummary";
import type { Report } from "./types";

export type PreparedPdf = {
  bytes: Uint8Array;
  pages: string[];
  token: string;
  text: string[];
};
const WIDTH = 612,
  HEIGHT = 792,
  MARGIN = 42,
  BOTTOM = 748;
export function wrapText(
  text: string,
  width: number,
  measure: (value: string) => number,
) {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    const words = paragraph.split(/(\s+)/u);
    for (const word of words) {
      if (measure(line + word) <= width) {
        line += word;
        continue;
      }
      if (line.trim()) {
        lines.push(line.trimEnd());
        line = "";
      }
      if (measure(word) <= width) {
        line = word.trimStart();
        continue;
      }
      // Segment at grapheme boundaries where supported, so long IDs/URLs and
      // non-Latin words wrap instead of being replaced or silently clipped.
      const parts =
        typeof Intl.Segmenter === "function"
          ? [
              ...new Intl.Segmenter(undefined, {
                granularity: "grapheme",
              }).segment(word),
            ].map((part) => part.segment)
          : Array.from(word);
      for (const part of parts) {
        if (measure(part) > width)
          throw new Error(
            "A character is too wide for the PDF. Use CSV for this export.",
          );
        if (line && measure(line + part) > width) {
          lines.push(line);
          line = "";
        }
        line += part;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines.length ? lines : [""];
}
export function reportText(report: Report) {
  const rows = report.rows.map((row) => [...row]),
    header = rows.shift() ?? [];
  if (report.spec.kind === "analytics") {
    const records = rows.filter((row) => row.some(Boolean));
    const at = (row: string[], key: string) => row[header.indexOf(key)] ?? "";
    const values = (row: string[], noun = "claims") =>
      [
        at(row, "amount_minor") ? money(at(row, "amount_minor")) : "",
        at(row, "count")
          ? `${at(row, "count")} ${at(row, "count") === "1" ? noun.replace(/s$/, "") : noun}`
          : "",
      ]
        .filter(Boolean)
        .join(" · ");
    const result = [
      {
        title: "Summary",
        fields: records
          .filter((r) => at(r, "section") === "summary")
          .map((r) => ({
            label: at(r, "metric"),
            value: at(r, "amount_minor")
              ? `${money(at(r, "amount_minor"))}${at(r, "count") ? ` · ${at(r, "count")} ${at(r, "metric") === "Approved expense" ? "claims" : "receipts"}` : ""}`
              : at(r, "count"),
          })),
      },
    ];
    for (const [section, title] of [
      ["daily", "Daily approved expense"],
      ["category", "By expense category"],
      ["fund", "By fund"],
    ]) {
      const selected = records.filter((r) => at(r, "section") === section);
      if (selected.length)
        result.push({
          title,
          fields: selected.map((r) => ({
            label:
              section === "daily"
                ? `${at(r, "period_or_date")}${at(r, "metric") === "Approved expense" ? " · Total" : ` · ${at(r, "metric")}`}`
                : at(r, "metric"),
            value: values(r),
          })),
        });
    }
    const undated = records.find((r) => at(r, "section") === "undated");
    if (undated)
      result.push({
        title: "Undated receipts",
        fields: [
          { label: at(undated, "metric"), value: values(undated, "receipts") },
        ],
      });
    return result;
  }
  const labels: Record<string, string> = {
    claim_id: "Claim",
    revision: "Revision",
    expense_date: "Receipt date",
    fund_code: "Fund",
    approved_allocation_minor: "Approved allocation",
    payment_status: "Payment status",
    merchant: "Merchant",
    purpose: "Purpose",
    claimant: "Claimant",
    approver: "Approver",
    approval_reference: "Approval reference",
  };
  return rows
    .filter((row) => row.some(Boolean))
    .map((row, index) => ({
      title: `Allocation ${index + 1}`,
      fields: header.flatMap((key, i) =>
        key === "currency" || !row[i]
          ? []
          : [
              {
                label:
                  labels[key] ||
                  key.replace(/_minor$/, " · USD").replaceAll("_", " "),
                value:
                  key.endsWith("_minor") && /^-?\d+$/.test(row[i] ?? "")
                    ? money(row[i])
                    : row[i] || "—",
              },
            ],
      ),
    }));
}
export async function prepareReportPdf(
  report: Report,
  current: () => boolean = () => true,
): Promise<PreparedPdf> {
  const checkCurrent = () => {
    if (!current()) throw new Error("The preview changed.");
  };
  checkCurrent();
  const { PDFDocument } = await import("pdf-lib");
  if (report.organization.length > 300)
    throw new Error(
      "This organization name is too long for the PDF letterhead. Use a shorter official name or download CSV.",
    );
  const records = reportText(report);
  const summary =
    report.spec.kind === "report" ? summarizeReport(report.rows) : null;
  if (records.length > 1000)
    throw new Error(
      report.spec.kind === "analytics"
        ? "This report is too large for a PDF. Narrow the date range or download CSV."
        : "This report is too large for a PDF. Download CSV instead.",
    );
  await document.fonts.ready;
  const style = getComputedStyle(document.documentElement);
  const ink = style.getPropertyValue("--ink").trim() || "#17213A";
  const accent = style.getPropertyValue("--coral").trim() || "#E98167";
  const muted = style.getPropertyValue("--muted").trim() || "#596375";
  const border = style.getPropertyValue("--line").trim() || "#DCE1E9";
  const pdf = await PDFDocument.create();
  pdf.setTitle(
    `${report.organization} — ${report.spec.kind === "analytics" ? "Analytics" : "Expense report"}`,
  );
  pdf.setAuthor(report.organization);
  pdf.setSubject(
    report.spec.kind === "analytics"
      ? "Aggregate analytics for selected receipt dates"
      : `${report.spec.profile} approved allocation report`,
  );
  const images: string[] = [],
    text: string[] = [];
  let canvas!: HTMLCanvasElement,
    ctx!: CanvasRenderingContext2D,
    y = 0,
    pageNumber = 0;
  const font = (size: number, bold = false, serif = false) => {
    ctx.font = `${bold ? "600" : "400"} ${size}px ${serif ? '\"Iowan Old Style\", Georgia, serif' : '-apple-system, BlinkMacSystemFont, \"Segoe UI\", Arial, sans-serif'}`;
  };
  function draw(value: string, x: number, top: number) {
    ctx.fillText(value, x, top);
    text.push(value);
  }
  function beginPage() {
    if (++pageNumber > 25)
      throw new Error(
        report.spec.kind === "analytics"
          ? "This report needs too many PDF pages. Narrow the date range or use CSV; no rows have been omitted."
          : "This report needs too many PDF pages. Use CSV; no rows have been omitted.",
      );
    canvas = document.createElement("canvas");
    canvas.width = WIDTH * 2;
    canvas.height = HEIGHT * 2;
    ctx = canvas.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.textBaseline = "top";
    ctx.fillStyle = "#FAF8F3";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = ink;
    font(20, false, true);
    draw("FT", MARGIN, 37);
    ctx.fillStyle = accent;
    ctx.fillRect(MARGIN, 64, 23, 2);
    font(11, true);
    ctx.fillStyle = ink;
    y = 41;
    for (const line of wrapText(
      report.organization,
      WIDTH - MARGIN * 2 - 42,
      (value) => ctx.measureText(value).width,
    )) {
      draw(line, MARGIN + 38, y);
      y += 15;
    }
    y = Math.max(87, y + 22);
    font(27, false, true);
    draw(
      report.spec.kind === "analytics"
        ? "Fund overview"
        : report.spec.profile === "funder"
          ? "Funder expense report"
          : "Bookkeeper expense report",
      MARGIN,
      y,
    );
    y += 39;
    font(10);
    ctx.fillStyle = muted;
    draw(
      report.spec.kind === "analytics"
        ? !report.spec.start && !report.spec.end
          ? "All receipt dates · USD"
          : `${report.spec.start || "First receipt"} — ${report.spec.end || "Latest receipt"} · receipt dates`
        : "Approved allocations · USD",
      MARGIN,
      y,
    );
    y += 24;
    let stats: { label: string; value: string }[] = [];
    if (summary)
      stats = [
        { label: "APPROVED", value: money(summary.approvedMinor) },
        { label: "CLAIMS", value: String(summary.claims) },
        { label: "ALLOCATION ROWS", value: String(summary.allocations) },
      ];
    else {
      const header = report.rows[0],
        metric = header.indexOf("metric"),
        amount = header.indexOf("amount_minor");
      stats = [
        ["APPROVED EXPENSE", "Approved expense"],
        ["PAID", "Paid on these expenses"],
        ["STILL OWED", "Still owed"],
      ].map(([label, key]) => ({
        label,
        value: money(
          report.rows.find(
            (row) => row[0] === "summary" && row[metric] === key,
          )?.[amount] || "0",
        ),
      }));
    }
    ctx.fillStyle = "#11172C";
    ctx.fillRect(MARGIN, y, WIDTH - MARGIN * 2, 56);
    stats.forEach((stat, i) => {
      const x = MARGIN + (i * (WIDTH - MARGIN * 2)) / 3 + 12,
        available = (WIDTH - MARGIN * 2) / 3 - 24;
      ctx.fillStyle = "#d7dced";
      font(8);
      draw(stat.label, x, y + 10);
      ctx.fillStyle = "#FAF8F3";
      let size = 18;
      font(size, false, true);
      while (ctx.measureText(stat.value).width > available && size > 10)
        font(--size, false, true);
      draw(stat.value, x, y + 27);
    });
    y += 75;
    ctx.strokeStyle = border;
    ctx.beginPath();
    ctx.moveTo(MARGIN, y);
    ctx.lineTo(WIDTH - MARGIN, y);
    ctx.stroke();
    y += 17;
  }
  async function finishPage() {
    checkCurrent();
    ctx.fillStyle = muted;
    font(9);
    draw(
      `Page ${pageNumber} · ${report.spec.kind === "analytics" ? "Aggregate totals; no claimant or receipt identity columns" : "Recipient copy; originals are not attached"}`,
      MARGIN,
      763,
    );
    const png = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not render the PDF page.")),
        "image/png",
      ),
    );
    const bytes = new Uint8Array(await png.arrayBuffer());
    const image = await pdf.embedPng(bytes);
    pdf
      .addPage([WIDTH, HEIGHT])
      .drawImage(image, { x: 0, y: 0, width: WIDTH, height: HEIGHT });
    images.push(canvas.toDataURL("image/png"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  beginPage();
  if (!records.length) {
    ctx.fillStyle = muted;
    font(12);
    draw("No records in this preview.", MARGIN, y);
  }
  for (const [index, record] of records.entries()) {
    checkCurrent();
    if (y + 48 > BOTTOM) {
      await finishPage();
      beginPage();
    }
    ctx.fillStyle = ink;
    font(10, true);
    for (const line of wrapText(
      record.title,
      WIDTH - MARGIN * 2,
      (s) => ctx.measureText(s).width,
    )) {
      if (y + 16 > BOTTOM) {
        await finishPage();
        beginPage();
        ctx.fillStyle = ink;
        font(10, true);
      }
      draw(line, MARGIN, y);
      y += 15;
    }
    y += 4;
    for (const field of record.fields) {
      ctx.fillStyle = ink;
      font(11);
      const lines = wrapText(
        `${field.label}: ${field.value}`,
        WIDTH - MARGIN * 2,
        (s) => ctx.measureText(s).width,
      );
      for (const line of lines) {
        if (y + 16 > BOTTOM) {
          await finishPage();
          beginPage();
          ctx.fillStyle = muted;
          font(9);
          draw(`${record.title} continued`, MARGIN, y);
          y += 18;
          ctx.fillStyle = ink;
          font(11);
        }
        draw(line, MARGIN, y);
        y += 15;
      }
      y += 4;
    }
    y += 12;
  }
  await finishPage();
  return {
    bytes: await pdf.save(),
    pages: images,
    token: report.revisionToken,
    text,
  };
}
