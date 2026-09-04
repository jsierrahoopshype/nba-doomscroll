#!/usr/bin/env node
/* Does the head-normalised tile actually put the head where it says?
 *
 * The point of headRaceTile is that a head lands at the same size and height
 * whatever the source framing. That is a geometric claim, and it can be
 * checked without a single real photograph: build cut-outs whose head is at a
 * known place and size, crop them, and measure where the head came out.
 *
 * The fixtures are RGBA with a transparent background, like the real face
 * crops, and colour the head differently from the shoulders so the head can be
 * found again in the output. Real portraits do not do that - this is a
 * measuring device, not a stand-in for the pictures.
 *
 *   node tools/test_head_tile.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import { decodePng, encodePng, resize, crop } from "./lib/png.mjs";
import { headRaceTile, TILE_HEAD_HEIGHT, TILE_HEAD_CENTRE } from "./lib/faces.mjs";

const png = { decodePng, encodePng, resize, crop };
let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${detail ? "\n         " + detail : ""}`); fail++; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headtile-"));

/* A cut-out shaped like the real thing: a narrow crown widening to cheekbones,
 * a neck, then shoulders twice the head's width running to the bottom edge.
 *
 * The first fixtures were a plain circle on a rectangle, and that shape hid the
 * bug that mattered: on a real portrait the top rows are a few pixels of hair,
 * which is what made a "crown width" reference collapse. A fixture has to have
 * the feature the code reasons about or it tests nothing. */
function cutout(name, { w, h, headCx, headTop, headH, headW, shoulders = true }) {
  const data = Buffer.alloc(w * h * 4, 0);
  const headBottom = headTop + headH;
  const neckW = headW * 0.42;
  const shoulderTop = headBottom + Math.round(headH * 0.10);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    let hit = 0;
    if (y >= headTop && y < headBottom) {
      // Ellipse: a few pixels wide at the crown, widest at the cheekbones.
      const t = (y - headTop) / headH;
      const r = (headW / 2) * Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.55) / 0.55, 2)));
      if (Math.abs(x - headCx) <= r) hit = 1;
    }
    if (!hit && shoulders && y >= headBottom && y < shoulderTop &&
        Math.abs(x - headCx) <= neckW / 2) hit = 2;
    if (!hit && shoulders && y >= shoulderTop &&
        Math.abs(x - headCx) <= headW * 1.05) hit = 2;
    if (hit === 1) { data[i] = 220; data[i+1] = 40; data[i+2] = 40; data[i+3] = 255; }
    else if (hit === 2) { data[i] = 40; data[i+1] = 80; data[i+2] = 220; data[i+3] = 255; }
  }
  const f = path.join(dir, name);
  fs.writeFileSync(f, encodePng({ w, h, data }));
  return f;
}

/* Where is the red in the tile, as fractions of the tile? */
function headIn(buf) {
  const tmp = path.join(dir, "_out.png");
  fs.writeFileSync(tmp, buf);
  const img = decodePng(tmp);
  if (!img) return null;
  const { w, h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 32) continue;
    if (data[i] > 140 && data[i + 1] < 110 && data[i + 2] < 110) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return {
    height: (y1 - y0 + 1) / h,
    centre: ((y0 + y1) / 2) / h,
    top: y0 / h, bottom: y1 / h
  };
}

const W = 112, H = 80;

/* THE CASE THE FIXED CROP GETS WRONG: two sources framing the same person
 * differently. A tight portrait and a chest-up one currently produce heads of
 * very different sizes; after normalising they should not. */
const tight = cutout("tight.png", { w: 400, h: 520, headCx: 200, headTop: 30, headH: 260, headW: 190 });
const wide  = cutout("wide.png",  { w: 400, h: 900, headCx: 200, headTop: 60, headH: 150, headW: 110 });

const tTight = headRaceTile(tight, W, H, png);
const tWide  = headRaceTile(wide,  W, H, png);
ok("both cut-outs produce a tile", tTight && tWide);

const hTight = tTight && headIn(tTight.buf);
const hWide  = tWide  && headIn(tWide.buf);
ok("the head is found in both tiles", hTight && hWide);

if (hTight && hWide) {
  /* The whole point. Not "each is close to a target" - that would pass even if
   * both were wrong in the same direction - but that two very differently
   * framed sources now agree with each other. */
  const diff = Math.abs(hTight.height - hWide.height);
  ok("a tight and a wide source give heads of near-equal size",
    diff < 0.12, `tight ${hTight.height.toFixed(3)} vs wide ${hWide.height.toFixed(3)} (diff ${diff.toFixed(3)})`);

  /* AGREEMENT IS NOT CORRECTNESS.
   *
   * The test above passed while the crop was zooming into foreheads on real
   * photographs, because two crops wrong in the same way agree perfectly. So
   * the size is also checked against what it claims to produce. */
  ok("the head is about the size the constant asks for, not just consistent",
    Math.abs(hTight.height - TILE_HEAD_HEIGHT) < 0.18 &&
    Math.abs(hWide.height - TILE_HEAD_HEIGHT) < 0.18,
    `target ${TILE_HEAD_HEIGHT}, got ${hTight.height.toFixed(3)} and ${hWide.height.toFixed(3)}`);

  /* Over-zoom has a signature: the head runs off both the top and the bottom,
   * so almost nothing of the tile is background. */
  ok("the tile is not a close-up of a forehead",
    hTight.height < 0.95 && hWide.height < 0.95,
    `${hTight.height.toFixed(3)} and ${hWide.height.toFixed(3)} of the tile`);

  const cdiff = Math.abs(hTight.centre - hWide.centre);
  ok("and at near-equal height in the frame",
    cdiff < 0.12, `tight ${hTight.centre.toFixed(3)} vs wide ${hWide.centre.toFixed(3)} (diff ${cdiff.toFixed(3)})`);

  /* The failure that reads as a rendering bug rather than a framing one. */
  ok("the crown of the head is not cut off",
    hTight.top > 0.005 && hWide.top > 0.005,
    `tops at ${hTight.top.toFixed(3)} and ${hWide.top.toFixed(3)}`);

  ok("the head sits in the upper half, not centred like a chest",
    hTight.centre < 0.62 && hWide.centre < 0.62,
    `centres at ${hTight.centre.toFixed(3)} and ${hWide.centre.toFixed(3)}`);
}

/* A head hard against the left edge cannot be centred without reading past the
 * source, so the crop is clamped inside it and the tile carries transparency on
 * the other side.
 *
 * This first asserted "no fully empty column", which failed - and the
 * assertion was wrong, not the code. A cut-out has a transparent background by
 * definition; a tile whose subject does not span it is a framing consequence,
 * not a fault, and these tiles are drawn over a coloured bar where that
 * transparency is invisible. What actually has to hold is that the head is all
 * there and nothing was read from outside the source. */
const edge = cutout("edge.png", { w: 400, h: 600, headCx: 70, headTop: 40, headH: 150, headW: 115 });
const tEdge = headRaceTile(edge, W, H, png);
ok("a head near the edge still produces a tile", !!tEdge);
if (tEdge) {
  const hEdge = headIn(tEdge.buf);
  ok("the whole head survives a crop clamped to the edge",
    hEdge && hEdge.top > 0.005 && hEdge.bottom < 0.995,
    hEdge ? `head spans ${hEdge.top.toFixed(3)}-${hEdge.bottom.toFixed(3)}` : "no head found");
  ok("and it is still about the intended size",
    hEdge && Math.abs(hEdge.height - hTight.height) < 0.15,
    hEdge ? `edge ${hEdge.height.toFixed(3)} vs tight ${hTight.height.toFixed(3)}` : "no head found");
}

/* A head-only cut-out, floating with no shoulders. There is no neck to find,
 * so the whole subject is the head - and the crop must not treat the widest
 * part of the head as a shoulder line and zoom in. */
const headOnly = cutout("headonly.png",
  { w: 300, h: 300, headCx: 150, headTop: 40, headH: 200, headW: 150, shoulders: false });
const tHeadOnly = headRaceTile(headOnly, W, H, png);
ok("a head-only cut-out still produces a tile", !!tHeadOnly);
if (tHeadOnly) {
  const hOnly = headIn(tHeadOnly.buf);
  ok("and is not zoomed into part of the face",
    hOnly && hOnly.height < 0.95 && Math.abs(hOnly.height - TILE_HEAD_HEIGHT) < 0.22,
    hOnly ? `head is ${hOnly.height.toFixed(3)} of the tile` : "no head found");
}

/* No alpha, nothing to measure. Returning null is what makes the caller fall
 * back to the existing crop instead of inventing one. */
const opaque = (() => {
  const w = 200, h = 200, data = Buffer.alloc(w * h * 4, 255);
  const f = path.join(dir, "opaque.png");
  fs.writeFileSync(f, encodePng({ w, h, data }));
  return f;
})();
ok("an opaque source returns null rather than a guess",
  headRaceTile(opaque, W, H, png) === null);

ok("a missing file returns null", headRaceTile(path.join(dir, "nope.png"), W, H, png) === null);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
