import type { Box, Extraction, Word } from "./types";
import { toMinor } from "./money";
export function receiptRows(words: Word[], page: number) {
  const rows: { words: Word[]; box: Box }[] = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    let row = rows.find(
      (r) =>
        Math.abs(r.box.y + r.box.h / 2 - (word.y + word.h / 2)) <
        Math.max(word.h, r.box.h) * 0.55,
    );
    if (!row) {
      rows.push({
        words: [word],
        box: { x: word.x, y: word.y, w: word.w, h: word.h, page },
      });
    } else {
      row.words.push(word);
      const x = Math.min(row.box.x, word.x),
        y = Math.min(row.box.y, word.y);
      row.box = {
        x,
        y,
        w: Math.max(row.box.x + row.box.w, word.x + word.w) - x,
        h: Math.max(row.box.y + row.box.h, word.y + word.h) - y,
        page,
      };
    }
  }
  // OCR baselines vary by a few pixels. Group by vertical overlap first, then
  // read each row from left to right rather than appending in Y-sort order.
  return rows.map((row) => ({
    text: row.words
      .sort((a, b) => a.x - b.x || a.y - b.y)
      .map((word) => word.text)
      .join(" "),
    box: row.box,
  }));
}
export function parseReceipt(
  words: Word[],
  page: number,
  engine: string,
): Extraction {
  const rows = receiptRows(words, page);
  const text = rows.map((r) => r.text).join("\n");
  const fields: Extraction["fields"] = {};
  const sources: Extraction["sources"] = {};
  const first = rows.find(
    (r) =>
      r.text.trim().length > 3 &&
      !/synthetic|fictional|sample receipt/i.test(r.text),
  );
  if (first) {
    fields.merchant = first.text.trim();
    sources.merchant = first.box;
  }
  let totalPriority = 0;
  for (const row of rows) {
    const iso = row.text.match(/\b(20\d{2})[-/](\d{2})[-/](\d{2})\b/);
    const us = row.text.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
    if (iso) {
      fields.expenseDate = `${iso[1]}-${iso[2]}-${iso[3]}`;
      sources.expenseDate = row.box;
    } else if (us) {
      fields.expenseDate = `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
      sources.expenseDate = row.box;
    }
    const label = row.text.match(/^\s*(GRAND\s+TOTAL|TOTAL|AMOUNT\s+DUE)\b/i);
    if (label) {
      const priority = /^grand/i.test(label[1])
        ? 3
        : /^total/i.test(label[1])
          ? 2
          : 1;
      const amounts = [
        ...row.text.matchAll(
          /(?:\$|USD\s*)?(\d{1,3}(?:,\d{3})*\.\d{2}|\d+\.\d{2})/g,
        ),
      ];
      if (amounts.length === 1 && priority >= totalPriority) {
        try {
          fields.totalMinor = toMinor(amounts.at(-1)![1]);
          sources.totalMinor = row.box;
          totalPriority = priority;
        } catch {
          /* Leave invalid totals unresolved. */
        }
      }
    }
  }
  return {
    engine,
    page,
    at: new Date().toISOString(),
    text,
    words,
    fields,
    sources,
  };
}
