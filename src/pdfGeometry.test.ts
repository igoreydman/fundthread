import { expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { pdfTextBounds, suggestedMask } from "./pdfGeometry";
import { demo, demoDocument } from "./demo";
import { api } from "./api";

it("includes descent below the PDF baseline and leaves conservative advance bounds", () => {
  const box = pdfTextBounds(
    [30, 0, 0, -30, 40, 120],
    250,
    { width: 400, height: 600 },
    { ascent: 0.8, descent: -0.25 },
    1,
  )!;
  expect(box.y).toBe(96 / 600);
  expect(box.y + box.h).toBeCloseTo(127.5 / 600);
  expect(box.x).toBeLessThan(40 / 400);
  expect(box.x + box.w).toBeGreaterThan(290 / 400);
  const mask = suggestedMask(box);
  expect(mask.y).toBeLessThan(box.y);
  expect(mask.y + mask.h).toBeGreaterThan(box.y + box.h);
});

it("uses transformed corners for rotated text and clamps suggested masks to the page", () => {
  const box = pdfTextBounds(
    [0, 20, 20, 0, 200, 50],
    100,
    { width: 400, height: 600 },
    { ascent: 0.8, descent: -0.25 },
    2,
  )!;
  expect(box.x).toBeCloseTo(195 / 400);
  expect(box.x + box.w).toBeCloseTo(216 / 400);
  expect(box.y).toBeLessThan(50 / 600);
  expect(box.y + box.h).toBeGreaterThan(150 / 600);
  const edge = suggestedMask({ x: 0, y: 0, w: 1, h: 1, page: 2 });
  expect(edge).toEqual({ x: 0, y: 0, w: 1, h: 1, page: 2 });
});

it("uses descent fallback for missing metrics and rejects invalid/off-page geometry", () => {
  const box = pdfTextBounds(
    [20, 0, 0, -20, 40, 100],
    80,
    { width: 400, height: 600 },
    undefined,
    1,
  )!;
  expect(box.y + box.h).toBeGreaterThan(100 / 600);
  expect(
    pdfTextBounds(
      [0, 0, 0, 0, 0, 0],
      10,
      { width: 400, height: 600 },
      undefined,
      1,
    ),
  ).toBeNull();
  expect(
    pdfTextBounds(
      [20, 0, 0, -20, 900, 100],
      80,
      { width: 400, height: 600 },
      undefined,
      1,
    ),
  ).toBeNull();
  expect(
    pdfTextBounds(
      [NaN, 0, 0, -20, 0, 100],
      80,
      { width: 400, height: 600 },
      undefined,
      1,
    ),
  ).toBeNull();
});

it("saving a conservative mask plan preserves exact original bytes and hash", async () => {
  await api.startPersonal();
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("SYNTHETIC gyp@example.invalid");
  const original = Uint8Array.from(await pdf.save());
  await api.importFiles([
    new File([original], "synthetic-private.pdf", { type: "application/pdf" }),
  ]);
  const e = (await api.snapshot()).expenses[0];
  const before = Uint8Array.from((await demoDocument(e.documentId)).bytes);
  const region = suggestedMask(
    pdfTextBounds(
      [30, 0, 0, -30, 40, 120],
      250,
      { width: 400, height: 600 },
      { ascent: 0.8, descent: -0.25 },
      1,
    )!,
  );
  await api.savePrivacyPlan(e.documentId, [region]);
  expect(await api.privacyPlan(e.documentId)).toEqual([region]);
  expect(Uint8Array.from((await demoDocument(e.documentId)).bytes)).toEqual(
    before,
  );
  expect(before).toEqual(original);
  expect((await api.snapshot()).expenses[0].hash).toBe(e.hash);
  await demo.startPersonal();
});
