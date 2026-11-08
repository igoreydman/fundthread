import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
const root = process.env.FUNDTHREAD_EVIDENCE_DIR;
async function capture(page: Page, name: string) {
  if (!root) return;
  await mkdir(join(root, "screenshots"), { recursive: true });
  await page.screenshot({
    path: join(root, "screenshots", name + ".png"),
    animations: "disabled",
  });
}
async function saveDownload(page: Page, format: "CSV" | "PDF", name: string) {
  const waiting = page.waitForEvent("download");
  await page
    .getByRole("button", { name: `Save ${format}`, exact: true })
    .click();
  const file = await waiting;
  if (root) {
    await mkdir(join(root, "examples"), { recursive: true });
    await file.saveAs(join(root, "examples", name));
  }
  return readFile((await file.path())!);
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("region", { name: "Receipt workbench" }).waitFor();
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    await capture(
      page,
      "UNEXPECTED-core-" + info.title.slice(0, 55).replaceAll(" ", "-"),
    );
});

test("Analytics keeps approved expense, receipt-date filters and portable aggregate scope distinct", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(page.locator(".single-day-chart")).toContainText(
    "Workshop supplies",
  );
  await expect(page.locator(".single-day-chart")).toContainText("$140.00");
  await expect(page.locator(".single-day-chart")).toContainText("Travel");
  await expect(page.locator(".single-day-chart")).toContainText("$48.15");
  await page.getByRole("button", { name: /Workshop supplies.*140.00/ }).click();
  await expect(page.locator(".analytics-daily-table")).toHaveAttribute(
    "open",
    "",
  );
  await page.locator(".analytics-daily-table > summary").click();
  const totals = page.getByLabel("Analytics totals", { exact: true });
  await expect(totals).toContainText("$188.15");
  await expect(totals).toContainText("$165.00");
  await expect(totals).toContainText("$23.15");
  await expect(page.locator(".analytics-context")).toContainText("$530.30");
  await expect(page.locator(".analytics-context")).toContainText("1 · $65.00");
  await page
    .getByLabel("Analytics start date", { exact: true })
    .fill("2026-10-20");
  await page
    .getByLabel("Analytics end date", { exact: true })
    .fill("2026-10-24");
  await expect(page.locator(".analytics-context")).toContainText("$465.30");
  const day = page.locator('[data-chart-day="2"]');
  await day.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".analytics-daily-table")).toHaveAttribute(
    "open",
    "",
  );
  await expect(page.locator(".analytics-daily-table tbody tr")).toHaveCount(5);
  await expect(page.locator(".analytics-daily-table tbody")).toContainText(
    "$0.00",
  );
  await page
    .getByRole("button", { name: "Prepare analytics export", exact: true })
    .click();
  await page
    .getByLabel("I’ve checked the fields and recipients for this export.")
    .check();
  const csv = (
    await saveDownload(page, "CSV", "analytics-date-range.synthetic.csv")
  ).toString("utf8");
  expect(csv).toContain("2026-10-20 to 2026-10-24");
  expect(csv).toContain('"188.15"');
  expect(csv).toContain('"465.30"');
  expect(csv).toContain('"amount_usd"');
  expect(csv).toContain('"Category · Workshop supplies"');
  expect(csv).toContain('"Category · Travel"');
  expect(csv).not.toContain("Marta Silva");
  expect(csv).not.toContain("ft-1040");
  const bytes = await saveDownload(
    page,
    "PDF",
    "analytics-date-range.synthetic.pdf",
  );
  const pdf = await PDFDocument.load(bytes);
  expect(pdf.getTitle()).toContain("Tidepath Family Alliance");
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  await capture(page, "core-01-analytics-approved-range-and-export");
  await page
    .getByLabel("Analytics start date", { exact: true })
    .fill("2026-10-23");
  await expect(
    page.getByRole("button", { name: "Save PDF", exact: true }),
  ).toHaveCount(0);
  await expect(totals).toContainText("$0.00");
  await page
    .getByLabel("Analytics start date", { exact: true })
    .fill("2026-10-25");
  await expect(page.getByRole("alert")).toContainText(
    "valid receipt-date range",
  );
  await page.getByRole("button", { name: "All dates", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture(page, "core-02-compact-analytics-all-dates");
});

test("organization letterhead PDFs preserve Unicode, recipient scope and long multipage content", async ({
  page,
}) => {
  const original = await PDFDocument.create();
  original
    .addPage([400, 500])
    .drawText("SAMPLE RECEIPT\n2026-10-22\nTOTAL $53.25", {
      x: 30,
      y: 440,
      size: 16,
      lineHeight: 35,
    });
  await page
    .getByRole("button", { name: "Import receipts", exact: true })
    .click();
  await page.getByLabel("Choose receipt files").setInputFiles({
    name: "sample-letterhead-receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(await original.save()),
  });
  await expect(
    page.getByLabel("Receipt total · sample-letterhead-receipt.pdf", {
      exact: true,
    }),
  ).toHaveValue("53.25", { timeout: 30000 });
  await page
    .getByLabel("Merchant · sample-letterhead-receipt.pdf", { exact: true })
    .fill("Canal Supply");
  await page
    .getByLabel("Receipt date · sample-letterhead-receipt.pdf", { exact: true })
    .fill("2026-10-22");
  await page.getByRole("button", { name: "Add fund", exact: true }).click();
  const fund = page.getByRole("dialog", { name: "Create a fund" });
  await fund.getByLabel("Fund name", { exact: true }).fill("Community care");
  await fund.getByLabel("Grant / fund code").fill("+Care");
  await fund.getByLabel("Opening budget · USD").fill("100.00");
  await fund.getByRole("button", { name: "Create fund", exact: true }).click();
  await page
    .getByLabel("Review receipt · sample-letterhead-receipt.pdf", {
      exact: true,
    })
    .click();
  const edit = page.locator(".batch-edit-row:visible");
  await edit.getByLabel("Person being reimbursed").fill("PRIVATE_CLAIMANT");
  await edit
    .getByLabel("Purpose", { exact: true })
    .fill("Apoyo para la niñez · 北京 · الأسرة. ".repeat(70));
  await edit
    .getByRole("combobox", { name: "Category", exact: true })
    .selectOption("Workshop supplies");
  await edit.getByLabel("Eligible · USD", { exact: true }).fill("53.25");
  await edit
    .getByRole("combobox", { name: "Fund", exact: true })
    .selectOption({ label: "+Care · Community care" });
  await edit
    .getByRole("button", { name: "Mark reviewed", exact: true })
    .click();
  await page
    .getByLabel("Open record · sample-letterhead-receipt.pdf", { exact: true })
    .click();
  const record = page.getByRole("dialog");
  await record.getByRole("tab", { name: /Decision/ }).click();
  await record.getByLabel("Approver", { exact: true }).fill("PRIVATE_APPROVER");
  await record
    .getByLabel("Approval evidence reference")
    .fill("PRIVATE_APPROVAL_REF");
  await record
    .getByRole("button", { name: "Record approval", exact: true })
    .click();
  await expect(record).toContainText(/approval recorded/i);
  await record.getByLabel("Close dialog").click();
  await page
    .getByRole("button", { name: "Reports & privacy", exact: true })
    .click();
  const name =
    "Alianza Comunitaria de la Niñez, las Familias y el Apoyo Escolar · 北京 · الأسرة";
  const org = page.getByLabel("Organization name for this export", {
    exact: true,
  });
  await org.fill(name);
  await expect(page.getByRole("button", { name: /^Funder/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page
    .getByRole("button", { name: "Prepare report", exact: true })
    .click();
  await expect(page.locator(".report-preview table")).not.toContainText(
    "PRIVATE_CLAIMANT",
  );
  await page
    .getByLabel("I’ve checked the fields and recipients for this export.")
    .check();
  const funder = await saveDownload(
    page,
    "PDF",
    "funder-unicode-letterhead.synthetic.pdf",
  );
  expect((await PDFDocument.load(funder)).getTitle()).toContain(name);
  const csv = (
    await saveDownload(page, "CSV", "funder-unicode-letterhead.synthetic.csv")
  ).toString("utf8");
  expect(csv).toContain("'+Care");
  expect(csv).not.toContain("PRIVATE_");
  await org.fill("Nueva " + name);
  await expect(
    page.getByRole("button", { name: "Save PDF", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /^Bookkeeper/ }).click();
  await expect(
    page.getByRole("button", { name: /^Bookkeeper/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Prepare report", exact: true })
    .click();
  await page
    .getByLabel("I’ve checked the fields and recipients for this export.")
    .check();
  const detail = await saveDownload(
    page,
    "PDF",
    "bookkeeper-unicode-multipage.synthetic.pdf",
  );
  const detailedPdf = await PDFDocument.load(detail);
  expect(detailedPdf.getTitle()).toContain("Nueva " + name);
  expect(detailedPdf.getPageCount()).toBeGreaterThan(1);
  await expect(page.locator(".pdf-pages img")).toHaveCount(
    detailedPdf.getPageCount(),
  );
  await capture(page, "core-03-unicode-letterhead-and-multipage-preview");
  await page.getByRole("button", { name: /^Funder/ }).click();
  await expect(
    page.getByRole("button", { name: "Save PDF", exact: true }),
  ).toHaveCount(0);
});
