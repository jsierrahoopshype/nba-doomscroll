/* Rebuild the race face tiles in place, without rebuilding the races.
 *
 *     node tools/retile_faces.mjs --local "<bar-chart-race>/assets/headshots"
 *     node tools/retile_faces.mjs --local "<...>/headshots" --write
 *
 * WHY THIS EXISTS
 *
 * The tiles in data/races/faces were baked by a resize that forced every source
 * into 1.4:1, which made heads 17% too narrow for their height. The fix is in
 * tools/lib/png.mjs, but picking it up through build_races.mjs means a full
 * race rebuild and four local paths. Nothing about the races themselves needs
 * to change - only the 737 PNGs - so this does that one thing from the one
 * path it actually needs.
 *
 * A tile is only rewritten when a source PNG matching its slug is found, so a
 * partial headshots folder degrades to "fixed what it could" and says which
 * ones it could not. Nothing else in the repo is touched: no JSON, no index,
 * no race data.
 *
 * Dry run by default. --write is required to change anything.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { raceFaceTile } from "./lib/png.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FACE_DIR = path.join(REPO, "data/races/faces");
const TILE_W = 112, TILE_H = 80;
// Same rule build_races.mjs applies: below this a file is an NBA CDN
// silhouette placeholder, which is a grey outline of nobody.
const MIN_SRC_BYTES = 15000;

const argv = process.argv.slice(2);
const li = argv.indexOf("--local");
const SRC = li >= 0 ? argv[li + 1] : null;
const WRITE = argv.includes("--write");

if (!SRC) {
  console.error('usage: node tools/retile_faces.mjs --local "<bar-chart-race>/assets/headshots" [--write]');
  process.exit(1);
}
if (!fs.existsSync(SRC)) {
  console.error(`no such folder: ${SRC}`);
  process.exit(1);
}
if (!fs.existsSync(FACE_DIR)) {
  console.error(`no tiles to rebuild: ${FACE_DIR} is missing`);
  process.exit(1);
}

const slugOf = name => name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

// slug -> source file, built from the headshots folder
const bySlug = new Map();
for (const f of fs.readdirSync(SRC)) {
  if (!f.toLowerCase().endsWith(".png")) continue;
  bySlug.set(slugOf(f.slice(0, -4)), path.join(SRC, f));
}

const tiles = fs.readdirSync(FACE_DIR).filter(f => f.endsWith(".png"));
let rebuilt = 0, unchanged = 0, tooSmall = 0, failed = 0;
const missing = [];

for (const tile of tiles) {
  const slug = tile.slice(0, -4);
  const src = bySlug.get(slug);
  if (!src) { missing.push(slug); continue; }
  let size;
  try { size = fs.statSync(src).size; } catch (e) { missing.push(slug); continue; }
  if (size < MIN_SRC_BYTES) { tooSmall++; continue; }

  const buf = raceFaceTile(src, TILE_W, TILE_H);
  if (!buf) { failed++; console.log(`  could not decode ${path.basename(src)}`); continue; }

  const dest = path.join(FACE_DIR, tile);
  const before = fs.readFileSync(dest);
  if (before.equals(buf)) { unchanged++; continue; }
  if (WRITE) fs.writeFileSync(dest, buf);
  rebuilt++;
}

console.log(`
  source folder      ${SRC}
  tiles on disk      ${tiles.length}
  rebuilt            ${rebuilt}${WRITE ? "" : "   (dry run - nothing written)"}
  already correct    ${unchanged}
  source too small   ${tooSmall}   (CDN placeholder, tile left alone)
  no source found    ${missing.length}
  decode failed      ${failed}`);

if (missing.length) {
  console.log(`\n  These keep their old tile - the headshots folder has no file for them:`);
  console.log("  " + missing.slice(0, 12).join(", ") + (missing.length > 12 ? `, and ${missing.length - 12} more` : ""));
}
if (!WRITE && rebuilt) {
  console.log(`\n  Re-run with --write to apply.`);
}
