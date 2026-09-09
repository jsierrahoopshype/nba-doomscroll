/* Re-bake data/faces from the original photographs, at a chosen size.
 *
 *   node tools/rebake_face_tiles.mjs <bar-chart-race/assets/headshots>
 *   node tools/rebake_face_tiles.mjs <dir> --px 160
 *   node tools/rebake_face_tiles.mjs <dir> --px 160 --write
 *
 * WHY THIS EXISTS RATHER THAN build_data.mjs --refresh-faces
 *
 * That flag works, but only inside a full build: --local needs four source
 * repos on disk and rewrites every pool file on its way past. Changing the
 * face tiles should not be able to change which cards exist. This reads the
 * committed manifest, re-bakes exactly the players already in it, under
 * exactly the filenames already in it, and touches nothing else in the repo.
 *
 * WHY RE-BAKE AT ALL
 *
 * unsquash_face_tiles.mjs corrected the 1.4x distortion by stretching finished
 * 96px tiles, and resize() in lib/png.mjs is a box filter - correct going down,
 * nearest-neighbour going up. So the correction cost real sharpness. Baking
 * from the 256px source instead applies the same correction inside the single
 * crop-and-resize headTile already does, which is a DOWNSCALE on both axes and
 * therefore loses nothing.
 *
 * The size is worth raising while we are here. 96px was chosen for .face.lg
 * (3.2rem, ~51 CSS px). It is far too small for .quiz-sil-mask, which is
 * 9.5rem - 152 CSS px, and 304 device px on a phone.
 *
 * WHAT COMES OUT
 *
 * The same 1,231 filenames, so nothing that reads data/faces/index.json needs
 * to know this ran. Only px changes in the manifest.
 *
 * NOTHING IS WRITTEN WITHOUT --write, and nothing is ever deleted. The dry run
 * bakes every tile in memory so the reported byte total is measured, not
 * estimated - it is the number the repo will actually grow to.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as Png from "./lib/png.mjs";
import * as Faces from "./lib/faces.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(REPO, "data", "faces");
const INDEX = path.join(DIR, "index.json");

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const srcDir = argv.find(a => !a.startsWith("--"));
const pxArg = argv.indexOf("--px");
const PX = pxArg >= 0 && argv[pxArg + 1] ? parseInt(argv[pxArg + 1], 10) : 160;

/* The source's pixel aspect. bar-chart-race's cut-outs hold a person 1.4x too
 * narrow; a square-pixelled folder would want 1. Overridable rather than
 * assumed, because getting it wrong is exactly the bug this is cleaning up. */
const aspArg = argv.indexOf("--src-aspect");
const ASPECT = aspArg >= 0 && argv[aspArg + 1]
  ? parseFloat(argv[aspArg + 1])
  : Faces.BCR_PIXEL_ASPECT;

const line = s => console.log(s);
const die = s => { line(""); line("  " + s); line(""); process.exit(1); };

line("");
line("  re-bake face tiles");
line("  " + "-".repeat(66));

if (!srcDir) {
  die("Give the source folder, e.g.\n" +
      '     node tools/rebake_face_tiles.mjs "C:\\Users\\Jorge Sierra\\Documents\\GitHub\\bar-chart-race\\assets\\headshots" --px 160');
}
if (!Number.isFinite(PX) || PX < 32 || PX > 512) die("--px must be between 32 and 512.");
if (!fs.existsSync(srcDir)) die("No such folder:\n     " + srcDir);

let manifest;
try { manifest = JSON.parse(fs.readFileSync(INDEX, "utf8")); }
catch (e) { die("data/faces/index.json is missing or unreadable. Nothing to re-bake against."); }
if (!manifest.faces) die("data/faces/index.json has no faces map.");

/* An LFS-backed checkout that never ran `git lfs pull` looks like a full folder
 * of tiny text files. Baking from those would silently produce 1,231 failures,
 * so it is worth naming before anything else happens. */
const srcFiles = fs.readdirSync(srcDir).filter(f => /\.png$/i.test(f));
if (!srcFiles.length) die("No PNGs in that folder. Check the path points at the headshots directory itself.");
const pointers = srcFiles.filter(f => {
  try { return fs.statSync(path.join(srcDir, f)).size < 1024; } catch (e) { return false; }
});
if (pointers.length > srcFiles.length / 2) {
  die("Most of those PNGs are under 1KB, which means this is a Git LFS checkout\n" +
      "  whose real files were never fetched. Run `git lfs install` then\n" +
      "  `git lfs pull` in that repo and try again.");
}

const names = Object.keys(manifest.faces);
line("  source      " + srcDir);
line("  " + srcFiles.length + " PNGs found, manifest wants " + names.length + " players");
line("  baking at   " + PX + "px, source pixel aspect " + ASPECT);
line("  " + (WRITE ? "WRITING" : "dry run - pass --write to actually change them"));
line("");

const idx = Faces.buildBcrIndex(srcDir, null);
const baked = [];
let missing = [], failed = [], bytes = 0;

for (const name of names) {
  const src = idx.fileFor(name);
  if (!src) { missing.push(name); continue; }
  const png = Faces.headTile(src, PX, Png, { srcAspect: ASPECT });
  if (!png) { failed.push(name); continue; }
  baked.push([manifest.faces[name], png]);
  bytes += png.length;
}

let wasBytes = 0;
for (const name of names) {
  try { wasBytes += fs.statSync(path.join(DIR, manifest.faces[name])).size; } catch (e) { /* absent */ }
}

line("  baked       " + baked.length + (WRITE ? "" : "  (in memory)"));
if (missing.length) {
  line("  no source   " + missing.length + "  (left exactly as they are on disk)");
  line("              e.g. " + missing.slice(0, 4).join(", "));
}
if (failed.length) {
  line("  undecodable " + failed.length + "  (left exactly as they are on disk)");
  line("              e.g. " + failed.slice(0, 4).join(", "));
}
line("  payload     " + (wasBytes / 1048576).toFixed(1) + " MB  ->  " +
     (bytes / 1048576).toFixed(1) + " MB   (" +
     Math.round(bytes / Math.max(1, baked.length) / 1024 * 10) / 10 + " KB per tile)");

if (!WRITE) {
  line("");
  line("  Nothing was changed. Re-run with --write when the numbers look right.");
  line("");
  process.exit(0);
}

for (const [file, png] of baked) fs.writeFileSync(path.join(DIR, file), png);

/* px is what the manifest is FOR - js/trades.js and js/rumors.js read it. The
 * other keys are carried through untouched rather than rewritten, so a field
 * added later by some other tool is not quietly dropped here. */
manifest.px = PX;
manifest.src_aspect = ASPECT;
manifest.generated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(INDEX, JSON.stringify(manifest) + "\n");

line("");
line("  " + baked.length + " tiles rewritten at " + PX + "px. index.json now says px " + PX + ".");
line("");
line("  Look at a few before committing. To undo all of it:");
line("     git checkout -- data/faces");
line("");
