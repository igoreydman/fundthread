import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const root = process.env.FUNDTHREAD_EVIDENCE_DIR;
test.use({
  video: { mode: "on", size: { width: 1280, height: 720 } },
  trace: "on",
  viewport: { width: 1280, height: 720 },
});

for (const reduced of [false, true])
  test(`${reduced ? "reduced" : "normal"} motion keeps real drag, read, commit, error and source states usable`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await page.addInitScript(() => {
      const events: any[] = [];
      (window as any).__microEvents = events;
      for (const type of [
        "animationstart",
        "animationend",
        "transitionrun",
        "transitionend",
      ])
        document.addEventListener(
          type,
          (event) => {
            const e = event as AnimationEvent & TransitionEvent;
            const target = e.target as HTMLElement;
            if (
              target?.matches(
                ".modal,.modal-backdrop,.batch-source-button,.batch-row,.batch-save-state,.batch-review-button,.button,.nav-overflow>summary",
              )
            )
              events.push({
                type,
                at: performance.now(),
                elapsedSeconds: e.elapsedTime,
                property: e.propertyName,
                animation: e.animationName,
                target: target.className,
              });
          },
          true,
        );
      document.addEventListener("DOMContentLoaded", () => {
        let previous = "";
        new MutationObserver(() => {
          const state = [
            ...document.querySelectorAll(
              ".batch-progress,.batch-save-state,[role=alert]",
            ),
          ]
            .map((n) => n.textContent)
            .filter(Boolean)
            .join(" | ");
          if (state !== previous) {
            events.push({ type: "state", at: performance.now(), text: state });
            previous = state;
          }
        }).observe(document.body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["disabled"],
        });
      });
    });
    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Receipt workbench" }),
    ).toBeVisible();
    await expect(page.locator(".sample-banner")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Import receipts", exact: true }),
    ).toHaveCount(1);
    await expect(page.locator(".batch-table th").first()).toHaveCSS(
      "background-color",
      "rgb(23, 33, 58)",
    );
    const rows = await page.locator(".batch-row").evaluateAll(
      (ns) =>
        ns.filter((n) => {
          const r = n.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight;
        }).length,
    );
    expect(rows).toBe(5);
    if (root) {
      await mkdir(join(root, "screenshots"), { recursive: true });
      await page.screenshot({
        path: join(
          root,
          "screenshots",
          `${reduced ? "reduced" : "normal"}-ledger-laptop.png`,
        ),
      });
    }
    const original = page.getByLabel("View original · receipt-ft-1042.pdf", {
      exact: true,
    });
    await original.hover();
    await expect(original).toHaveCSS("background-color", "rgb(237, 241, 255)");
    await original.click();
    await page.getByRole("dialog").locator(".canvas-mount canvas").waitFor();
    if (reduced)
      await expect(page.locator(".modal")).toHaveCSS("animation-name", "none");
    else
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as any).__microEvents.some(
              (e: any) =>
                e.type === "animationend" && e.animation === "modal-reveal",
            ),
          ),
        )
        .toBe(true);
    await page.keyboard.press("Escape");
    const total = page.getByLabel("Receipt total · receipt-ft-1042.pdf", {
      exact: true,
    });
    await expect(total).toBeFocused();
    const merchant = page.getByLabel("Merchant · receipt-ft-1042.pdf", {
      exact: true,
    });
    await merchant.fill("Community Supply · corrected");
    const commit = page.locator(
      '[data-expense-id="ft-1042"] .batch-save-state',
    );
    await expect(commit).toContainText("Kept in tab");
    await total.fill("1.234");
    await expect(page.getByRole("alert")).toContainText("two decimal");
    await expect(commit).toHaveText("Not saved");
    await total.fill("184.75");
    await expect(commit).toContainText("Kept in tab");
    await page
      .getByLabel("Review receipt · receipt-ft-1042.pdf", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Mark reviewed", exact: true })
      .click();
    await expect(
      page.getByLabel("Open record · receipt-ft-1042.pdf", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Check fields/ }).click();
    await page.getByRole("button", { name: /^All 5$/ }).click();
    await page.keyboard.press("Escape");
    const bytes = Array.from(
      await readFile(
        resolve(
          "../output/fundthread-core-audit-2026-11-08/mixed-batch/01-text-receipt.pdf",
        ),
      ),
    );
    const transfer = await page.evaluateHandle((data) => {
      const dt = new DataTransfer();
      dt.items.add(
        new File([new Uint8Array(data)], "example.pdf", {
          type: "application/pdf",
        }),
      );
      return dt;
    }, bytes);
    await page
      .locator(".app-shell")
      .dispatchEvent("dragenter", { dataTransfer: transfer });
    await expect(
      page.getByText("Drop receipts to import", { exact: true }),
    ).toBeVisible();
    await page
      .locator(".app-shell")
      .dispatchEvent("dragleave", { dataTransfer: transfer });
    await expect(page.locator(".batch-drop-feedback")).toHaveCount(0);
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
        ].map((f) =>
          resolve("../output/fundthread-core-audit-2026-11-08/mixed-batch", f),
        ),
      );
    await page
      .getByRole("dialog", { name: "Receipt import results" })
      .getByLabel("Close dialog")
      .click();
    await expect(
      page.getByLabel("Receipt total · 02-photo-receipt.png", { exact: true }),
    ).toHaveValue("53.25", { timeout: 45000 });
    await expect(
      page.getByLabel("Receipt total · 03-scan-receipt.png", { exact: true }),
    ).toHaveValue("1.23", { timeout: 45000 });
    await expect(page.locator(".batch-progress")).not.toContainText("Reading");
    await expect(page.locator(".batch-row")).toHaveCount(3);
    await page.setViewportSize({ width: 390, height: 844 });
    const photoSource = page.getByLabel(
      "View original · 02-photo-receipt.png",
      { exact: true },
    );
    await photoSource.scrollIntoViewIfNeeded();
    await photoSource.click();
    await page.getByRole("dialog").locator(".canvas-mount canvas").waitFor();
    await page.keyboard.press("Escape");
    await expect(
      page.getByLabel("Receipt total · 02-photo-receipt.png", { exact: true }),
    ).toBeFocused();
    await expect(page.locator(".batch-active-context")).toContainText(
      "02-photo-receipt.png",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (root) {
      const events = await page.evaluate(() => (window as any).__microEvents);
      await writeFile(
        join(root, `${reduced ? "reduced" : "normal"}-interaction-events.json`),
        JSON.stringify(
          {
            reducedMotion: reduced,
            rowsAt1280: rows,
            url: page.url(),
            scripts: await page
              .locator("script[src]")
              .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("src"))),
            events,
            limits:
              "Synthetic operated trace. Timing is browser animation/transition events, not stakeholder speed, OCR confidence or native UI verification.",
          },
          null,
          2,
        ),
      );
      await page.screenshot({
        path: join(
          root,
          "screenshots",
          `${reduced ? "reduced" : "normal"}-compact-source-return.png`,
        ),
      });
    }
  });
