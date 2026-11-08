import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
const evidenceRoot = process.env.FUNDTHREAD_EVIDENCE_DIR;
if (evidenceRoot)
  for (const dir of ["screenshots", "examples", "metrics"])
    mkdirSync(join(evidenceRoot, dir), { recursive: true });
function evidencePath(original: string) {
  return evidenceRoot
    ? join(
        evidenceRoot,
        original.includes("screenshots/") ? "screenshots" : "examples",
        basename(original),
      )
    : original;
}
async function capture(page: Page, name: string) {
  if (evidenceRoot)
    await page.screenshot({
      path: join(evidenceRoot, "screenshots", name + ".png"),
      animations: "disabled",
    });
}
function metric(name: string, value: unknown) {
  if (evidenceRoot)
    writeFileSync(
      join(evidenceRoot, "metrics", name + ".json"),
      JSON.stringify(value, null, 2) + "\n",
    );
}
test.afterEach(async ({ page }, info) => {
  if (evidenceRoot && info.status !== info.expectedStatus)
    await capture(
      page,
      "UNEXPECTED-FAILURE-" +
        info.title.replace(/[^a-z0-9]+/gi, "-").slice(0, 90),
    );
});
import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFNumber,
  StandardFonts,
} from "pdf-lib";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("region", { name: "Receipt workbench" }).waitFor();
});
test("privacy mask plans persist and exported PDF has only fresh page images", async ({
  page,
}) => {
  if (await page.getByRole("dialog").count())
    await page.getByRole("dialog").getByLabel("Close dialog").click();
  await page
    .getByRole("button", { name: "Reports & privacy", exact: true })
    .click();
  if (!(await page.locator(".list-row.clickable").first().isVisible()))
    await page.locator(".receipt-copies > summary").click();
  await page.locator(".list-row.clickable").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".canvas-mount canvas").waitFor();
  await dialog
    .getByRole("button", { name: "Find likely private details" })
    .click();
  await dialog
    .locator(".privacy-matches button")
    .filter({ hasText: "marta@example.invalid" })
    .click();
  await dialog
    .locator(".privacy-matches button")
    .filter({ hasText: "Marta Silva" })
    .click();
  const email = dialog
    .locator(".privacy-matches button")
    .filter({ hasText: "marta@example.invalid" });
  await expect(email).toHaveAttribute("aria-pressed", "true");
  await email.click();
  await expect(dialog.locator(".privacy-mask")).toHaveCount(1);
  await email.click();
  await expect(dialog.locator(".privacy-mask")).toHaveCount(2);
  const mask = await dialog
    .locator(".privacy-mask")
    .first()
    .evaluate((el) => ({
      x: parseFloat((el as HTMLElement).style.left) / 100,
      y: parseFloat((el as HTMLElement).style.top) / 100,
      w: parseFloat((el as HTMLElement).style.width) / 100,
      h: parseFloat((el as HTMLElement).style.height) / 100,
    }));
  await page.screenshot({
    path: evidencePath("docs/screenshots/04-privacy-review.png"),
  });
  await dialog
    .getByLabel(
      "I’ve reviewed all pages and the information this copy will share.",
    )
    .check();
  await capture(page, "10-privacy-copy-attested-before-export");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save reviewed PDF copy" }).click();
  const file = await download;
  await file.saveAs(evidencePath("docs/examples/reviewed-receipt.sample.pdf"));
  const path = await file.path();
  const { readFile } = await import("node:fs/promises");
  const doc = await PDFDocument.load(await readFile(path!));
  expect(doc.getPageCount()).toBe(1);
  expect(doc.catalog.get(PDFName.of("Names"))).toBeUndefined();
  const fonts = doc.getPage(0).node.Resources()?.lookup(PDFName.of("Font"));
  expect(fonts instanceof PDFDict ? fonts.keys().length : 0).toBe(0);
  const image = doc.context
    .enumerateIndirectObjects()
    .map(([, o]) => o)
    .find(
      (o) =>
        o instanceof PDFRawStream &&
        o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    ) as PDFRawStream;
  expect(image).toBeDefined();
  const width = (image.dict.get(PDFName.of("Width")) as PDFNumber).asNumber(),
    height = (image.dict.get(PDFName.of("Height")) as PDFNumber).asNumber();
  const { inflateSync } = await import("node:zlib");
  const pixels = inflateSync(image.getContents());
  const offset =
    (Math.floor((mask.y + mask.h / 2) * height) * width +
      Math.floor((mask.x + mask.w / 2) * width)) *
    3;
  expect([...pixels.subarray(offset, offset + 3)]).toEqual([17, 17, 17]);
  expect(
    doc.getPage(0).node.Resources()?.lookup(PDFName.of("XObject")),
  ).toBeDefined();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  if (!(await page.locator(".list-row.clickable").first().isVisible()))
    await page.locator(".receipt-copies > summary").click();
  await page.locator(".list-row.clickable").first().click();
  await expect(page.getByRole("dialog").locator(".privacy-mask")).toHaveCount(
    2,
  );
  await expect(
    page.getByLabel(
      "I’ve reviewed all pages and the information this copy will share.",
    ),
  ).not.toBeChecked();
  await capture(page, "11-saved-masks-require-new-attestation");
});

test("fund creation, history and recovery communicate their real state", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Grant funds", exact: true }).click();
  await page.getByRole("button", { name: "New fund", exact: true }).click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("Fund name", { exact: true })
    .fill("Synthetic mentor travel");
  await d.getByLabel("Grant / fund code").fill("TEST-TRAVEL");
  await d.getByLabel("Opening budget · USD").fill("1500.00");
  await d.getByRole("button", { name: "Create fund", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Synthetic mentor travel" }),
  ).toBeVisible();
  await page.screenshot({
    path: evidencePath("docs/screenshots/02-grant-funds.png"),
  });
  await page
    .getByRole("button", { name: "Backup & recovery", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Export report", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Export report", exact: true })
    .click();
  await page
    .getByLabel("I’ve checked the fields and recipients for this export.")
    .check();
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save CSV", exact: true }).click();
  const file = await waiting;
  const { readFile } = await import("node:fs/promises");
  const csv = (await readFile((await file.path())!)).toString("utf8");
  expect(csv).toContain("approved_allocation_usd");
  expect(csv).toContain('"140.00"');
  expect(csv).not.toContain("claimant");
  await file.saveAs(
    evidencePath("docs/examples/recovery-export-report.sample.csv"),
  );
  await expect(
    page.getByRole("heading", { name: "Export report", exact: true }),
  ).toBeVisible();
  await capture(page, "12-recovery-direct-actual-report-export");
});

test("suggested masks cover full sensitive glyphs and descenders without changing the original", async ({
  page,
}) => {
  const original = await PDFDocument.create();
  const sheet = original.addPage([400, 600]);
  const italic = await original.embedFont(StandardFonts.HelveticaOblique);
  const mono = await original.embedFont(StandardFonts.CourierOblique);
  sheet.drawText("SYNTHETIC PRIVACY TEST", { x: 30, y: 560, size: 15 });
  sheet.drawText("gyp@example.invalid", {
    x: 40,
    y: 480,
    size: 30,
    font: italic,
  });
  sheet.drawText("peggy@example.invalid", {
    x: 40,
    y: 380,
    size: 24,
    font: mono,
  });
  sheet.drawText("TOTAL $1.23", { x: 40, y: 260, size: 16 });
  sheet.drawText("FICTIONAL TEST - NO REAL TRANSACTION", {
    x: 25,
    y: 25,
    size: 9,
  });
  const bytes = Buffer.from(await original.save());
  const { writeFile, readFile } = await import("node:fs/promises");
  await writeFile(
    evidencePath("docs/examples/descenders-original.synthetic.pdf"),
    bytes,
  );
  await page
    .getByRole("button", { name: "Import receipts", exact: true })
    .click();
  await page.getByLabel("Choose receipt files").setInputFiles({
    name: "synthetic-descenders.pdf",
    mimeType: "application/pdf",
    buffer: bytes,
  });
  await page
    .getByLabel("View original · synthetic-descenders.pdf", { exact: true })
    .click();
  const canvas = page.locator(".canvas-mount canvas");
  await canvas.waitFor();
  const originalRasterHash = await canvas.evaluate(async (node) => {
    const c = node as HTMLCanvasElement;
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest), (x) =>
      x.toString(16).padStart(2, "0"),
    ).join("");
  });
  if (await page.getByRole("dialog").count())
    await page.getByRole("dialog").getByLabel("Close dialog").click();
  await page
    .getByRole("button", { name: "Reports & privacy", exact: true })
    .click();
  if (!(await page.locator(".list-row.clickable").first().isVisible()))
    await page.locator(".receipt-copies > summary").click();
  await page.locator(".list-row.clickable").first().click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(".canvas-mount canvas").waitFor();
  await dialog
    .getByRole("button", { name: "Find likely private details" })
    .click();
  for (const email of ["gyp@example.invalid", "peggy@example.invalid"])
    await dialog
      .locator(".privacy-matches button")
      .filter({ hasText: email })
      .click();
  await expect(dialog.locator(".privacy-mask")).toHaveCount(2);
  await capture(page, "18-descender-mask-preview");
  const visibleMasks = await dialog
    .locator(".privacy-mask")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const s = (node as HTMLElement).style;
        return {
          x: parseFloat(s.left) / 100,
          y: parseFloat(s.top) / 100,
          w: parseFloat(s.width) / 100,
          h: parseFloat(s.height) / 100,
        };
      }),
    );
  const sourceBox = await dialog
    .locator(".source-highlight")
    .evaluate((node) => {
      const s = (node as HTMLElement).style;
      return {
        x: parseFloat(s.left) / 100,
        y: parseFloat(s.top) / 100,
        w: parseFloat(s.width) / 100,
        h: parseFloat(s.height) / 100,
      };
    });
  expect(
    visibleMasks.some(
      (m) =>
        m.x <= sourceBox.x &&
        m.y <= sourceBox.y &&
        m.x + m.w >= sourceBox.x + sourceBox.w &&
        m.y + m.h >= sourceBox.y + sourceBox.h,
    ),
  ).toBe(true);
  await dialog
    .getByLabel(
      "I’ve reviewed all pages and the information this copy will share.",
    )
    .check();
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Save reviewed PDF copy" }).click();
  const file = await download;
  await file.saveAs(
    evidencePath("docs/examples/descenders-reviewed.synthetic.pdf"),
  );
  const reviewed = await PDFDocument.load(await readFile((await file.path())!));
  const image = reviewed.context
    .enumerateIndirectObjects()
    .map(([, object]) => object)
    .find(
      (o) =>
        o instanceof PDFRawStream &&
        o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image"),
    ) as PDFRawStream;
  const width = (image.dict.get(PDFName.of("Width")) as PDFNumber).asNumber();
  const height = (image.dict.get(PDFName.of("Height")) as PDFNumber).asNumber();
  const { inflateSync } = await import("node:zlib");
  const pixels = inflateSync(image.getContents());
  expect(pixels.length).toBe(width * height * 3);
  const coverage = [
    { label: "Helvetica Oblique descenders", top: 75, bottom: 138 },
    { label: "Courier Oblique descenders", top: 184, bottom: 238 },
  ].map((region) => {
    let uncoveredDarkPixels = 0,
      uncoveredInkPixels = 0,
      maskedPixels = 0;
    for (
      let y = Math.floor((region.top / 600) * height);
      y < Math.ceil((region.bottom / 600) * height);
      y++
    )
      for (
        let x = Math.floor((20 / 400) * width);
        x < Math.ceil((380 / 400) * width);
        x++
      ) {
        const at = (y * width + x) * 3;
        const color = [pixels[at], pixels[at + 1], pixels[at + 2]];
        if (color.every((v) => v === 17)) maskedPixels++;
        else {
          if (color.some((v) => v < 200)) uncoveredDarkPixels++;
          if (color.some((v) => v !== 255)) uncoveredInkPixels++;
        }
      }
    return { ...region, uncoveredDarkPixels, uncoveredInkPixels, maskedPixels };
  });
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Receipts", exact: true }).click();
  await page
    .getByLabel("View original · synthetic-descenders.pdf", { exact: true })
    .click();
  await page.locator(".canvas-mount canvas").waitFor();
  const afterHash = await page
    .locator(".canvas-mount canvas")
    .evaluate(async (node) => {
      const c = node as HTMLCanvasElement;
      const data = c
        .getContext("2d")!
        .getImageData(0, 0, c.width, c.height).data;
      return Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", data)),
        (x) => x.toString(16).padStart(2, "0"),
      ).join("");
    });
  expect(afterHash).toBe(originalRasterHash);
  metric("sensitive-glyph-edge-coverage", {
    coverage,
    originalRasterHash,
    originalRasterHashAfter: afterHash,
    originalVisualUnchanged: true,
    sourceContainedInVisibleMask: true,
    visibleMasks,
  });
  await capture(page, "19-original-still-unmasked-after-export");
  for (const region of coverage) {
    expect(region.maskedPixels).toBeGreaterThan(100);
    expect(region.uncoveredDarkPixels, region.label).toBe(0);
    expect(region.uncoveredInkPixels, region.label).toBe(0);
  }
});
