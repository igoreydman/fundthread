import { test, expect, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.env.FUNDTHREAD_EVIDENCE_DIR;
async function capture(page: Page, name: string) {
  if (!root) return;
  mkdirSync(join(root, "screenshots"), { recursive: true });
  await page.screenshot({
    path: join(root, "screenshots", name + ".png"),
    animations: "disabled",
  });
}
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("region", { name: "Receipt workbench" }).waitFor();
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus)
    await capture(
      page,
      "UNEXPECTED-experience-" + info.title.slice(0, 55).replaceAll(" ", "-"),
    );
});

test("compact reimbursement context and visible activity filter remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Reimbursements", exact: true })
    .click();
  const row = page.locator(".reimbursement-row").first();
  const description = await row.locator(".grow").boundingBox();
  const amount = await row.locator(".amount").boundingBox();
  const action = await row
    .getByRole("button", { name: /Record payment/ })
    .boundingBox();
  expect(description!.width).toBeGreaterThan(170);
  expect(amount!.y).toBeGreaterThanOrEqual(
    description!.y + description!.height,
  );
  expect(action!.y).toBeGreaterThan(amount!.y);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture(page, "27-compact-reimbursement-context-and-action");
  await row.getByRole("button", { name: /Record payment/ }).click();
  await expect(
    page.getByRole("dialog", {
      name: "Record an external payment",
      exact: true,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Activity", exact: true }).click();
  const filter = page.getByLabel("Filter by receipt", { exact: true });
  await expect(filter).toBeVisible();
  await capture(page, "28-compact-activity-visible-filter");
  await filter.selectOption({ index: 1 });
  await expect(
    page.getByRole("heading", { name: "Saved record versions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Human-reviewed values", exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture(page, "29-compact-activity-filtered-record");
});

test("compact workbench retains horizontal editing and the source returns to its field", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const original = page.getByLabel("View original · receipt-ft-1042.pdf", {
    exact: true,
  });
  await original.scrollIntoViewIfNeeded();
  await original.click();
  await page.getByRole("dialog").locator(".canvas-mount canvas").waitFor();
  await page.keyboard.press("Escape");
  await expect(
    page.getByLabel("Receipt total · receipt-ft-1042.pdf", { exact: true }),
  ).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture(page, "compact-batch-source-return");
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(
    page.getByLabel("Analytics totals", { exact: true }),
  ).toContainText("$188.15");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
