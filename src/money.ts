export function toMinor(value: string): string {
  const raw = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{0,2})?$/.test(raw))
    throw new Error("Enter an amount with up to two decimal places.");
  const text = raw.replace(/,/g, "");
  const [whole, fraction = ""] = text.split(".");
  const n = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (n > 1000000000000000n)
    throw new Error("Amount exceeds the supported range.");
  return n.toString();
}
export function decimal(minor: string): string {
  const n = BigInt(minor || "0");
  return `${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}
export function money(minor: string | bigint): string {
  const n = BigInt(minor || "0");
  const a = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}$${new Intl.NumberFormat("en-US").format(a / 100n)}.${(a % 100n).toString().padStart(2, "0")}`;
}
export const sum = (values: string[]) =>
  values.reduce((a, b) => a + BigInt(b || "0"), 0n);
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quote && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quote = !quote;
    } else if (c === "," && !quote) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" && !quote) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
