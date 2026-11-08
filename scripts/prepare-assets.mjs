import { createHash } from "node:crypto";
import { cp, mkdir, readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
await mkdir("public/ocr/core", { recursive: true });
await cp(
  "node_modules/tesseract.js/dist/worker.min.js",
  "public/ocr/worker.min.js",
);
for (const name of await readdir("node_modules/tesseract.js-core"))
  if (/\.(js|wasm)$|^LICENSE$/.test(name))
    await cp(
      join("node_modules/tesseract.js-core", name),
      join("public/ocr/core", name),
    );
for (const name of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await mkdir("public/pdf", { recursive: true });
  await cp(join("node_modules/pdfjs-dist", name), join("public/pdf", name), {
    recursive: true,
  });
}
await cp("node_modules/pdfjs-dist/LICENSE", "public/pdf/LICENSE");
await stat("public/ocr/eng.traineddata").catch(() => {
  throw new Error(
    "Missing bundled OCR language file. See README: local language setup. No runtime download is allowed.",
  );
});
if (
  createHash("sha256")
    .update(await readFile("public/ocr/eng.traineddata"))
    .digest("hex") !==
  "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2"
)
  throw new Error("Bundled OCR language file checksum did not match.");
console.log(
  "Local PDF and OCR assets prepared and language checksum verified.",
);
