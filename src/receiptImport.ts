export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_SESSION_BYTES = 100 * 1024 * 1024;
const signature = (b: Uint8Array, values: number[]) =>
  values.every((v, i) => b[i] === v);
export function inspectReceipt(bytes: Uint8Array): {
  mime: string;
  width?: number;
  height?: number;
} {
  if (bytes.length > MAX_FILE_BYTES)
    throw new Error("This file exceeds 20 MB. Choose a smaller scan.");
  if (signature(bytes, [37, 80, 68, 70, 45]))
    return { mime: "application/pdf" };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0,
    height = 0,
    mime = "";
  if (signature(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
    if (
      bytes.length < 33 ||
      view.getUint32(8) !== 13 ||
      String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR"
    )
      throw new Error("This PNG header is damaged.");
    width = view.getUint32(16);
    height = view.getUint32(20);
    mime = "image/png";
  } else if (signature(bytes, [255, 216, 255])) {
    mime = "image/jpeg";
    let offset = 2;
    const frames = new Set([
      0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
      0xcf,
    ]);
    while (offset + 1 < bytes.length) {
      if (bytes[offset++] !== 255)
        throw new Error("This JPEG header is damaged.");
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xd8 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7))
        continue;
      if (offset + 2 > bytes.length) break;
      const size = view.getUint16(offset);
      if (size < 2 || offset + size > bytes.length)
        throw new Error("This JPEG header is damaged.");
      if (frames.has(marker)) {
        if (size < 8) throw new Error("This JPEG frame is damaged.");
        height = view.getUint16(offset + 3);
        width = view.getUint16(offset + 5);
        break;
      }
      offset += size;
    }
  } else
    throw new Error(
      "Choose a PDF, JPEG or PNG. For HEIC photos, export a JPEG first.",
    );
  if (!width || !height)
    throw new Error(
      "Could not read this image’s dimensions. Choose another copy.",
    );
  if (width * height > 24_000_000)
    throw new Error(
      "This image exceeds 24 megapixels. Resize it before importing.",
    );
  return { mime, width, height };
}
export async function receiptHash(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error(
      "Open this app over HTTPS or localhost to use local receipt verification.",
    );
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export type ImportResult = {
  outcomes: { expenseId: string; duplicate: boolean }[];
  failures: { filename: string; reason: string }[];
};
