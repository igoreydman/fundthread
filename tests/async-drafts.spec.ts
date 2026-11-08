import { test, expect } from "@playwright/test";

// Test-only interception of the development API module. No production hooks,
// native IPC, native window, or database-failure claim is implied.
test.beforeEach(async ({ page }) => {
  test.skip(
    !process.env.FUNDTHREAD_BASE_URL?.includes(":1420"),
    "The delay/failure harness intercepts the development module; run separately on1420.",
  );
  await page.route(/\/src\/api\.ts(?:\?|$)/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        (await response.text()) +
        `
window.__draftHarnessReadyForTest = true;
const actualSaveForTest = api.save;
api.save = async input => {
  window.__draftCallsForTest = (window.__draftCallsForTest || 0) + 1;
  await new Promise(resolve => setTimeout(resolve, 2000));
  if (window.__draftRejectForTest) throw new Error("Example save failed; nothing was committed.");
  return actualSaveForTest(input);
};
`,
    });
  });
  await page.goto("/");
  await expect
    .poll(() => page.evaluate(() => (window as any).__draftHarnessReadyForTest))
    .toBe(true);
  await page.getByRole("region", { name: "Receipt workbench" }).waitFor();
});

test("explicit review freezes fields until the delayed commit finishes", async ({
  page,
}) => {
  await page
    .getByLabel("Review receipt · receipt-ft-1042.pdf", { exact: true })
    .click();
  const row = page.locator(".batch-edit-row:visible");
  const action = row.getByRole("button", {
    name: "Mark reviewed",
    exact: true,
  });
  await action.click();
  await expect(
    page.getByLabel("Merchant · receipt-ft-1042.pdf", { exact: true }),
  ).toBeDisabled();
  await expect(row.getByLabel("Person being reimbursed")).toBeDisabled();
  await expect(action).toBeDisabled();
  await expect(
    page.getByLabel("Open record · receipt-ft-1042.pdf", { exact: true }),
  ).toBeVisible();
});

test("a rejected review keeps values editable and never claims review or save success", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).__draftRejectForTest = true;
  });
  await page
    .getByLabel("Review receipt · receipt-ft-1042.pdf", { exact: true })
    .click();
  const row = page.locator(".batch-edit-row:visible");
  await row
    .getByLabel("Person being reimbursed")
    .fill("Retained Example Claimant");
  await row.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Example save failed");
  await expect(
    page.getByLabel("Merchant · receipt-ft-1042.pdf", { exact: true }),
  ).toBeEnabled();
  await expect(row.getByLabel("Person being reimbursed")).toHaveValue(
    "Retained Example Claimant",
  );
  await expect(
    page.getByLabel("Open record · receipt-ft-1042.pdf", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".batch-save-row")).not.toContainText(
    "Draft saved",
  );
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Keep your changes?" }),
  ).toBeVisible();
});

test("leaving drains a late edit during delayed autosave and resumes the latest draft", async ({
  page,
}) => {
  const merchant = page.getByLabel("Merchant · receipt-ft-1042.pdf", {
    exact: true,
  });
  await merchant.fill("First draft value");
  await page.locator(".operator").click();
  await expect(
    page.locator('[data-expense-id="ft-1042"] .batch-save-state'),
  ).toContainText("Saving");
  await merchant.fill("Latest human edit while saving");
  await expect(
    page.getByRole("button", { name: "Resume sample", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page
    .getByRole("button", { name: "Resume sample", exact: true })
    .click();
  await expect(merchant).toHaveValue("Latest human edit while saving");
  expect(
    await page.evaluate(() => (window as any).__draftCallsForTest),
  ).toBeGreaterThanOrEqual(2);
  await merchant.fill("Valid draft before Analytics");
  await page.getByRole("button", { name: "Analytics", exact: true }).click();
  await expect(
    page.getByLabel("Analytics totals", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Receipts", exact: true }).click();
  await expect(merchant).toHaveValue("Valid draft before Analytics");
});
