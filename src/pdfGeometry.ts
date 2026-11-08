import type { Box } from "./types";

function normalizedBox(
  left: number,
  top: number,
  right: number,
  bottom: number,
  width: number,
  height: number,
  page: number,
): Box | null {
  if (
    ![left, top, right, bottom, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    return null;
  const x = Math.min(1, Math.max(0, left / width));
  const y = Math.min(1, Math.max(0, top / height));
  const endX = Math.min(1, Math.max(0, right / width));
  const endY = Math.min(1, Math.max(0, bottom / height));
  return endX > x && endY > y ? { x, y, w: endX - x, h: endY - y, page } : null;
}

// The transformed PDF origin is the text baseline, not its lower glyph edge.
// Include both ascent AND descent. A modest advance-direction allowance covers
// overhanging/italic glyphs; suggestions add their visible safety margin below.
export function pdfTextBounds(
  t: number[],
  advance: number,
  viewport: { width: number; height: number },
  style: { ascent?: number; descent?: number } | undefined,
  page: number,
): Box | null {
  if (
    t.length !== 6 ||
    !t.every(Number.isFinite) ||
    !Number.isFinite(advance) ||
    advance <= 0
  )
    return null;
  const em = Math.hypot(t[2], t[3]);
  const baselineScale = Math.hypot(t[0], t[1]);
  if (em <= 0 || baselineScale <= 0) return null;
  const ascent =
    Number.isFinite(style?.ascent) && style!.ascent! > 0 && style!.ascent! <= 2
      ? style!.ascent!
      : 1;
  const descent =
    Number.isFinite(style?.descent) &&
    style!.descent! < 0 &&
    style!.descent! >= -1
      ? style!.descent!
      : -0.3;
  const ux = t[0] / baselineScale,
    uy = t[1] / baselineScale;
  const overhang = Math.max(0.5, em * 0.15);
  const corners = [-overhang, advance + overhang].flatMap((distance) =>
    [ascent, descent].map((vertical) => ({
      x: t[4] + ux * distance + t[2] * vertical,
      y: t[5] + uy * distance + t[3] * vertical,
    })),
  );
  return normalizedBox(
    Math.min(...corners.map((p) => p.x)),
    Math.min(...corners.map((p) => p.y)),
    Math.max(...corners.map((p) => p.x)),
    Math.max(...corners.map((p) => p.y)),
    viewport.width,
    viewport.height,
    page,
  );
}

// Only new suggested masks use this margin. Manual/saved regions are not
// silently rewritten; the displayed mask is exactly the region saved/exported.
export function suggestedMask(box: Box): Box {
  const padX = Math.max(0.001, box.w * 0.015);
  const padY = Math.max(0.001, box.h * 0.15);
  const region = normalizedBox(
    box.x - padX,
    box.y - padY,
    box.x + box.w + padX,
    box.y + box.h + padY,
    1,
    1,
    box.page,
  );
  if (!region)
    throw new Error(
      "This suggested region has invalid geometry. Draw a mask manually.",
    );
  return region;
}
