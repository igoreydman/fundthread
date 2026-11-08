import { test, expect, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { PDFDocument } from "pdf-lib";
const evidence = process.env.FUNDTHREAD_EVIDENCE_DIR;
const fixture = resolve(
  "../output/fundthread-core-audit-2026-11-08/mixed-batch",
);
async function capture(page: Page, name: string) {
  if (!evidence) return;
  await mkdir(join(evidence, "screenshots"), { recursive: true });
  await page.screenshot({
    path: join(evidence, "screenshots", name + ".png"),
    animations: "disabled",
  });
}
async function importBatch(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Import receipts", exact: true })
    .click();
  await page
    .getByLabel("Choose receipt files")
    .setInputFiles(
      [
        "01-text-receipt.pdf",
        "02-photo-receipt.png",
        "03-scan-receipt.png",
        "04-duplicate-receipt.pdf",
        "05-unsupported.txt",
      ].map((f) => join(fixture, f)),
    );
  const outcome = page.getByRole("dialog", { name: "Receipt import results" });
  await expect(outcome).toContainText("3 added");
  await expect(outcome).toContainText("1 exact duplicates");
  await expect(outcome).toContainText("1 couldn’t be imported");
  await outcome.getByLabel("Close dialog").click();
  await expect(page.locator(".batch-row")).toHaveCount(3);
}
test("mixed batch reads automatically, preserves edits through filters and keeps review, approval, payment and export distinct", async ({
  page,
}) => {
  test.setTimeout(120000);
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.setViewportSize({ width: 1280, height: 720 });
  await importBatch(page);
  await expect(page.locator(".batch-table thead th")).toHaveCount(6);
  await expect(
    page.getByRole("columnheader", { name: "Status", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Action", exact: true }),
  ).toBeVisible();
  // Enter a human value while OCR can still be working on this row.
  const scanMerchant = page.getByLabel("Merchant · 03-scan-receipt.png", {
    exact: true,
  });
  await scanMerchant.fill("Example Scan Supply");
  await page.getByLabel("Search receipts").fill("CANAL");
  await page.getByLabel("Search receipts").fill("");
  await expect(scanMerchant).toHaveValue("Example Scan Supply");
  await expect(
    page.getByLabel("Receipt total · 01-text-receipt.pdf", { exact: true }),
  ).toHaveValue("53.25", { timeout: 45000 });
  await expect(
    page.getByLabel("Receipt total · 02-photo-receipt.png", { exact: true }),
  ).toHaveValue("53.25", { timeout: 45000 });
  await expect(
    page.getByLabel("Receipt total · 03-scan-receipt.png", { exact: true }),
  ).toHaveValue("1.23", { timeout: 45000 });
  await expect(scanMerchant).toHaveValue("Example Scan Supply");
  await expect(
    page.getByLabel("Receipt date · 03-scan-receipt.png", { exact: true }),
  ).toHaveValue("");
  await expect(page.locator(".batch-progress")).not.toContainText("Reading");
  expect(
    await page
      .getByRole("button", { name: "Read receipt", exact: true })
      .count(),
  ).toBe(0);
  await capture(page, "batch-01-auto-read-exception");
  const visible = await page.locator(".batch-row").evaluateAll(
    (rows) =>
      rows.filter((row) => {
        const r = row.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= innerHeight;
      }).length,
  );
  expect(visible).toBe(3);
  await page
    .getByLabel("View original · 01-text-receipt.pdf", { exact: true })
    .click();
  await page.getByRole("dialog").locator(".canvas-mount canvas").waitFor();
  await page.keyboard.press("Escape");
  await expect(
    page.getByLabel("Receipt total · 01-text-receipt.pdf", { exact: true }),
  ).toBeFocused();
  await page
    .getByLabel("Receipt date · 03-scan-receipt.png", { exact: true })
    .fill("2026-10-23");
  await page.getByRole("button", { name: "Add fund", exact: true }).click();
  const fund = page.getByRole("dialog", { name: "Create a fund" });
  await fund
    .getByLabel("Fund name", { exact: true })
    .fill("Example Workshop Fund");
  await fund.getByLabel("Grant / fund code").fill("EXAMPLE-2026");
  await fund.getByLabel("Opening budget · USD").fill("200.00");
  await fund.getByRole("button", { name: "Create fund", exact: true }).click();
  for (const [filename, amount] of [
    ["01-text-receipt.pdf", "53.25"],
    ["02-photo-receipt.png", "53.25"],
    ["03-scan-receipt.png", "1.23"],
  ]) {
    await page
      .getByLabel(`Review receipt · ${filename}`, { exact: true })
      .click();
    const editor = page.locator(".batch-edit-row:visible");
    await editor.getByLabel("Person being reimbursed").fill("Avery Example");
    await editor
      .getByLabel("Purpose", { exact: true })
      .fill("Example workshop supplies");
    await editor
      .getByRole("combobox", { name: "Category", exact: true })
      .selectOption("Workshop supplies");
    await editor.getByLabel("Eligible · USD", { exact: true }).fill(amount);
    await editor
      .getByRole("combobox", { name: "Fund", exact: true })
      .selectOption({ label: "EXAMPLE-2026 · Example Workshop Fund" });
    await editor
      .getByRole("button", { name: "Mark reviewed", exact: true })
      .click();
    await expect(
      page.getByLabel(`Open record · ${filename}`, { exact: true }),
    ).toBeVisible();
  }
  await expect(page.locator(".batch-progress")).toContainText(
    "3 reviewed · 3 awaiting decision",
  );
  await page
    .getByRole("button", { name: "Reports & privacy", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Prepare report", exact: true })
    .click();
  await expect(page.locator(".report-human-summary")).toContainText("$0.00");
  await page.getByRole("button", { name: "Receipts", exact: true }).click();
  for (const filename of [
    "01-text-receipt.pdf",
    "02-photo-receipt.png",
    "03-scan-receipt.png",
  ]) {
    await page.getByLabel(`Open record · ${filename}`, { exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("tab", { name: /Decision/ }).click();
    await dialog
      .getByLabel("Approver", { exact: true })
      .fill("Example Director");
    await dialog
      .getByLabel("Approval evidence reference")
      .fill(`EXAMPLE-${filename}`);
    await dialog
      .getByRole("button", { name: "Record approval", exact: true })
      .click();
    await expect(dialog).toContainText(/approval recorded/i);
    await dialog.getByLabel("Close dialog").click();
  }
  await page
    .getByRole("button", { name: "Reimbursements", exact: true })
    .click();
  const paymentRow = page
    .locator(".reimbursement-row")
    .filter({ hasText: "CANAL SUPPLY" });
  await paymentRow
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  const payment = page.getByRole("dialog");
  await payment.getByLabel("Amount paid · USD").fill("20.00");
  await payment
    .getByLabel("External payment reference")
    .fill("EXAMPLE-BANK-20");
  await payment
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  await expect(page.locator(".stat-row")).toContainText("$107.73");
  await expect(page.locator(".stat-row")).toContainText("$87.73");
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  const totals = page.getByLabel("Analytics totals", { exact: true });
  await expect(totals).toContainText("$107.73");
  await expect(totals).toContainText("$20.00");
  await expect(totals).toContainText("$87.73");
  await page
    .getByLabel("Organization name for this export", { exact: true })
    .fill("Maré Example Alliance");
  await capture(page, "batch-02-analytics-exact-money");
  await page
    .getByRole("button", { name: "Reports & privacy", exact: true })
    .click();
  await expect(
    page.getByLabel("Organization name for this export", { exact: true }),
  ).toHaveValue("Maré Example Alliance");
  await page
    .getByRole("button", { name: "Prepare report", exact: true })
    .click();
  await expect(page.locator(".report-human-summary")).toContainText("$107.73");
  await page
    .getByLabel("I’ve checked the fields and recipients for this export.")
    .check();
  for (const format of ["CSV", "PDF"]) {
    const waiting = page.waitForEvent("download");
    await page
      .getByRole("button", { name: `Save ${format}`, exact: true })
      .click();
    const file = await waiting;
    const bytes = await readFile((await file.path())!);
    if (evidence) {
      await mkdir(join(evidence, "examples"), { recursive: true });
      await file.saveAs(
        join(
          evidence,
          "examples",
          `batch-funder.synthetic.${format.toLowerCase()}`,
        ),
      );
    }
    if (format === "CSV") {
      const csv = bytes.toString("utf8");
      expect(csv).not.toContain("Avery");
      expect(csv).not.toContain("CANAL");
      expect(csv).not.toContain("workshop supplies");
      expect(csv).toContain('"53.25"');
      expect(csv).toContain('"1.23"');
    } else {
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getTitle()).toContain("Maré Example Alliance");
      expect(pdf.getPageCount()).toBe(1);
    }
  }
  expect(pageErrors).toEqual([]);
  if (evidence)
    await writeFile(
      join(evidence, "batch-check.json"),
      JSON.stringify(
        {
          visibleRows: visible,
          pageErrors,
          automaticReadStarts: 3,
          manualReadClicks: 0,
          sourceReturn: "receipt total field",
          approvedMinor: "10773",
          paidMinor: "2000",
          owedMinor: "8773",
          limit:
            "Synthetic browser check, not stakeholder timing or native UI verification",
        },
        null,
        2,
      ),
    );
});

test("invalid unsaved edits survive hiding and guarded navigation without changing another receipt", async ({
  page,
}) => {
  await page.goto("/");
  const total = page.getByLabel("Receipt total · receipt-ft-1042.pdf", {
    exact: true,
  });
  await total.fill("1.234");
  await page.getByLabel("Search receipts").fill("Little River");
  await page.getByLabel("Search receipts").fill("");
  await expect(total).toHaveValue("1.234");
  await expect(page.getByRole("alert")).toContainText("two decimal");
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Keep your changes?" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(total).toHaveValue("1.234");
  await page
    .getByRole("button", { name: "Reset unsaved edits", exact: true })
    .click();
  await expect(total).toHaveValue("184.75");
  await expect(
    page.getByLabel("Receipt total · receipt-ft-1041.pdf", { exact: true }),
  ).toHaveValue("92.40");
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(
    page.getByLabel("Analytics totals", { exact: true }),
  ).toContainText("$188.15");
});

test("a failed local read can retry while other originals and successful suggestions remain intact", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Import receipts", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Try your receipts", exact: false }),
  ).toHaveCount(0);
  const external: string[] = [];
  page.on("request", (request) => {
    if (!new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/))
      external.push(request.url());
  });
  await page
    .getByRole("button", { name: "Import receipts", exact: true })
    .click();
  await page.getByLabel("Choose receipt files").setInputFiles([
    {
      name: "working-receipt.pdf",
      mimeType: "application/pdf",
      buffer: await readFile(join(fixture, "01-text-receipt.pdf")),
    },
    {
      name: "damaged-receipt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "%PDF-1.7\nThis fictional file has a damaged body.\n",
      ),
    },
  ]);
  const retry = page.getByRole("button", {
    name: "Retry reading",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await expect(
    page.getByLabel("Receipt total · working-receipt.pdf", { exact: true }),
  ).toHaveValue("53.25", { timeout: 30000 });
  await expect(page.locator(".batch-row")).toHaveCount(2);
  await retry.click();
  await expect(
    page.getByText("Reading failed. Original retained.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Receipt total · working-receipt.pdf", { exact: true }),
  ).toHaveValue("53.25");
  await expect(
    page.getByLabel("Merchant · damaged-receipt.pdf", { exact: true }),
  ).toBeEnabled();
  expect(external).toEqual([]);
  await capture(page, "batch-03-read-retry-keeps-successes");
  await page
    .getByRole("button", { name: "Return to sample", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "browser session will be cleared",
  );
  await page
    .getByRole("button", { name: "Keep my workspace", exact: true })
    .click();
  await expect(page.locator(".batch-row")).toHaveCount(2);
});
