/* Un-squash the face tiles already committed to this repo.
 *
 *     node tools/unsquash_face_tiles.mjs            # dry run, changes nothing
 *     node tools/unsquash_face_tiles.mjs --write    # rewrite data/faces/*.png
 *
 * WHY THIS EXISTS RATHER THAN A REBUILD
 *
 * tools/build_data.mjs --local --refresh-faces is the proper fix and produces
 * better tiles, but it needs the bar-chart-race source repo, which is not on
 * the machine. These 1,231 PNGs are, and the distortion in them is a known
 * linear transform, so it can simply be undone.
 *
 * WHAT IT DOES, GEOMETRICALLY
 *
 * Each tile holds a region that was square in SOURCE pixels and therefore
 * 1.4:1 in display - the person inside is 1.4x too narrow. Stretching the tile
 * back to 1.4:1 makes the face correct and the frame too wide, so it is then
 * centre-cropped square again. That costs the outer edges of the frame, which
 * the framing could afford: headTile allowed 2.25 head-widths across, and what
 * survives is still comfortably more than the head.
 *
 * A one-off. Running it twice would squash them the other way, so it refuses:
 * data/faces/index.json records src_aspect once the tiles are corrected, and a
 * file that already says so is left alone.
 *
 * NOTHING IS DELETED AND NOTHING IS TOUCHED WITHOUT --write. The dry run
 * reports what it would do; the tiles are git-tracked either way, so the whole
 * thing is one `git checkout` from being undone.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decodePng, encodePng, resize, crop } from "./lib/png.mjs";
import { BCR_PIXEL_ASPECT } from "./lib/faces.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, "data", "faces");
const INDEX = path.join(DIR, "index.json");
const WRITE = process.argv.includes("--write");
const A = BCR_PIXEL_ASPECT;

const line = s => console.log(s);

/** Stretch to the true proportions, then centre-crop back to square. */
export function unsquash(img, a) {
  const wide = Math.max(1, Math.round(img.w * a));
  const stretched = resize(img, wide, img.h);
  const side = Math.min(img.h, wide);
  const x = Math.max(0, Math.round((wide - side) / 2));
  return crop(stretched, x, 0, side, side);
}

line("");
line("  " + DIR);
line("  " + "-".repeat(66));

let index = null;
try { index = JSON.parse(fs.readFileSync(INDEX, "utf8")); }
catch (e) {
  line("  data/faces/index.json is missing or unreadable. Refusing to touch the");
  line("  tiles without the manifest that says what they are.");
  line("");
  process.exit(1);
}

if (index.src_aspect) {
  line("  index.json already records src_aspect " + index.src_aspect + ".");
  line("  These tiles have been corrected. Doing it twice would squash them the");
  line("  other way, so nothing was changed.");
  line("");
  process.exit(0);
}

const files = fs.readdirSync(DIR).filter(f => /\.png$/i.test(f)).sort();
line("  " + files.length + " tiles, stretching " + A + "x wide then cropping square");
line("  " + (WRITE ? "WRITING" : "dry run - pass --write to actually change them"));
line("");

let done = 0, skipped = 0, failed = 0, sizes = {};
for (const f of files) {
  const p = path.join(DIR, f);
  const img = decodePng(p);
  if (!img) { failed++; continue; }
  sizes[img.w + "x" + img.h] = (sizes[img.w + "x" + img.h] || 0) + 1;
  /* A tile that is not square was not produced by the path this corrects. */
  if (img.w !== img.h) { skipped++; continue; }
  if (WRITE) fs.writeFileSync(p, encodePng(unsquash(img, A)));
  done++;
}

line("  corrected   " + done + (WRITE ? "" : "  (would be)"));
if (skipped) line("  skipped     " + skipped + "  (not square - not from this path)");
if (failed) line("  unreadable  " + failed);
line("  sizes       " + Object.keys(sizes).map(k => k + " x" + sizes[k]).join(", "));

if (WRITE) {
  index.src_aspect = A;
  index.unsquashed = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(INDEX, JSON.stringify(index) + "\n");
  line("");
  line("  index.json now records src_aspect " + A + ", so this cannot run twice.");
  line("");
  line("  Check a few in the browser before committing. To undo all of it:");
  line("     git checkout -- data/faces");
} else {
  line("");
  line("  Nothing was changed. Run it again with --write when ready.");
}
line("");
