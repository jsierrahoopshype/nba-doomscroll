/* Face tiles must never distort a head.
 *
 *     node tools/test_face_tiles.mjs
 *
 * raceFaceTile used to end in a straight resize to 112x80, which forces
 * whatever shape the source happens to be into 1.4:1. An official NBA portrait
 * is 1040x760; the top 80% of it is 1.71:1, and squashing that to 1.4:1 makes
 * every head 17% too narrow for its height. Sources of different shapes were
 * distorted by different amounts, so no two rows agreed with each other.
 *
 * The renderer draws the whole tile into a box of the tile's own aspect
 * (1.4 * barH by barH), so tile pixels scale uniformly on screen. That makes
 * this checkable without a browser: draw a circle in a source, build the tile,
 * and the circle must still be a circle.
 *
 * Needs ImageMagick's `convert` to draw the fixtures. Skips with a note rather
 * than failing if it is not installed, since it is a test dependency and not a
 * build one.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { raceFaceTile, decodePng } from "./lib/png.mjs";

const OUT_W = 112, OUT_H = 80;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "facetile-"));

function haveConvert() {
  try { execFileSync("convert", ["-version"], { stdio: "ignore" }); return true; }
  catch (e) { return false; }
}

if (!haveConvert()) {
  console.log("skip: ImageMagick `convert` not installed");
  process.exit(0);
}

/** Alpha bounding box of the drawn shape. */
function blob(img) {
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[(y * img.w + x) * 4 + 3] > 128) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* Every source aspect the headshot folders actually contain, plus two extremes
 * either side. 1040x760 is the official NBA portrait. */
const SHAPES = [
  [1040, 760], [1040, 1040], [512, 512], [600, 900], [900, 600], [256, 190]
];

let failures = 0;
for (const [w, h] of SHAPES) {
  // A small circle high in the frame, so the 80% head-and-shoulders crop
  // never clips it and the bounding box measures the shape, not the cut.
  const cx = Math.round(w / 2), cy = Math.round(h * 0.25);
  const r = Math.round(Math.min(w, h) * 0.12);
  const src = path.join(TMP, `src-${w}x${h}.png`);
  execFileSync("convert", ["-size", `${w}x${h}`, "xc:none", "-fill", "white",
    "-draw", `circle ${cx},${cy} ${cx},${cy - r}`, src]);

  const tileFile = path.join(TMP, `tile-${w}x${h}.png`);
  const png = raceFaceTile(src, OUT_W, OUT_H);
  if (!png) { console.log(`  FAIL ${w}x${h}: tile could not be built`); failures++; continue; }
  fs.writeFileSync(tileFile, png);

  const tile = decodePng(tileFile);
  if (tile.w !== OUT_W || tile.h !== OUT_H) {
    console.log(`  FAIL ${w}x${h}: tile is ${tile.w}x${tile.h}, want ${OUT_W}x${OUT_H}`);
    failures++; continue;
  }
  const b = blob(tile);
  if (!b) { console.log(`  FAIL ${w}x${h}: nothing drawn in the tile`); failures++; continue; }

  const aspect = b.w / b.h;
  // A pixel either way on a ~25px blob is rounding, not distortion.
  const ok = Math.abs(aspect - 1) < 0.10;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} source ${w}x${h} (${(w / h).toFixed(2)}:1) ` +
    `-> circle ${b.w}x${b.h}, aspect ${aspect.toFixed(3)}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n${failures} distorted` : "\nno distortion at any source aspect");
process.exit(failures ? 1 : 0);
