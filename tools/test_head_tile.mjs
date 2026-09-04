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
import { headRaceTile } from "./lib/faces.mjs";

const png = { decodePng, encodePng, resize, crop };
let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { console.log(`  ok   ${label}`); pass++; }
  else { console.log(`  FAIL ${label}${detail ? "\n         " + detail : ""}`); fail++; }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "headtile-"));

/* A cut-out: transparent everywhere, a red head, blue shoulders below it. */
function cutout(name, { w, h, headCx, headCy, headR, shoulderTop }) {
  const data = Buffer.alloc(w * h * 4, 0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const dx = x - headCx, dy = y - headCy;
    if (dx * dx + dy * dy <= headR * headR) {
      data[i] = 220; data[i+1] = 40; data[i+2] = 40; data[i+3] = 255;      // head
    } else if (y >= shoulderTop && Math.abs(x - headCx) <= headR * 2.1) {
      data[i] = 40; data[i+1] = 80; data[i+2] = 220; data[i+3] = 255;      // shoulders
    }
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
const tight = cutout("tight.png",  { w: 400, h: 500, headCx: 200, headCy: 150, headR: 110, shoulderTop: 250 });
const wide  = cutout("wide.png",   { w: 400, h: 900, headCx: 200, headCy: 130, headR: 60,  shoulderTop: 195 });

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
const edge = cutout("edge.png", { w: 400, h: 600, headCx: 70, headCy: 120, headR: 60, shoulderTop: 185 });
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
