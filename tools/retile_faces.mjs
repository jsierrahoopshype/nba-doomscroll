/* Rebuild the race face tiles in place, without rebuilding the races.
 *
 *     node tools/retile_faces.mjs --local "C:\Users\Jorge Sierra\Documents\GitHub\bar-chart-race\assets\headshots"
 *     node tools/retile_faces.mjs --local <folder> --write
 *     node tools/retile_faces.mjs --local <folder> --write --set teammates
 *     node tools/retile_faces.mjs --local <folder> --explain allen-iverson
 *
 * A SOURCE FOLDER MUST BE NAMED. THIS USED TO GUESS, AND IT PUT JAMAL
 * CRAWFORD'S FACE ON ALLEN IVERSON'S TILE.
 *
 * The old version searched the home directory, merged all thirteen headshot
 * checkouts it found, and for each slug took the LARGEST file - on the
 * reasoning that size tracks resolution and the small ones are CDN
 * placeholders. Size also tracks "a completely different, bigger photograph
 * filed under this name", and that is what happened:
 *
 *   Allen Iverson.png   67,339 bytes   in four folders     - Iverson
 *   Allen Iverson.png   82,748 bytes   in two folders      - Jamal Crawford
 *
 * The 82,748-byte file is a copy of nba-headshots' 2037-allen-iverson.png,
 * whose id and slug disagree: 947 is Iverson, 2037 is Crawford. Largest-wins
 * chose it over four correct copies, the run reported a 100% match rate, and
 * 859 tiles were rewritten before anyone looked at a face.
 *
 * A byte count cannot answer a question about identity. So it no longer tries:
 * the folder is named, precedence is the order it is named in, and when two
 * named folders disagree about a slug the disagreement is REPORTED rather than
 * resolved. A wrong folder is now a thing you can see in the log.
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
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { raceFaceTile, decodePng, encodePng, resize, crop } from "./lib/png.mjs";
import { BCR_PIXEL_ASPECT, headTile, tileSlugVariants } from "./lib/faces.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* TWO TILE SETS, ONE MATCHER.
 *
 * data/races/faces are 112x80 landscape, drawn as bars. data/teammates/faces
 * are 128x128 squares, drawn as circles. Different shapes, different tile
 * functions - but the same job: find the best source for a slug across every
 * headshot checkout on the machine and re-bake in place, without rebuilding
 * the pool that references them.
 *
 * They were separate before and only the races got re-baked, so the Teammates
 * scoreboard kept its distorted faces through two rounds of "the faces are
 * fixed". Adding it here rather than writing a third tool is the only version
 * where that cannot happen again.
 */
const PNG = { decodePng, encodePng, resize, crop };
const SETS = {
  races: {
    dir: path.join(REPO, "data/races/faces"),
    label: "data/races/faces  (112x80, bar races)",
    bake: file => raceFaceTile(file, 112, 80, { srcAspect: BCR_PIXEL_ASPECT })
  },
  teammates: {
    dir: path.join(REPO, "data/teammates/faces"),
    label: "data/teammates/faces  (128x128, Teammates scoreboard)",
    bake: file => headTile(file, 128, PNG, { srcAspect: BCR_PIXEL_ASPECT })
  }
};
// Same rule build_races.mjs applies: below this a file is an NBA CDN
// silhouette placeholder, which is a grey outline of nobody.
const MIN_SRC_BYTES = 15000;

const argv = process.argv.slice(2);
const li = argv.indexOf("--local");
const WRITE = argv.includes("--write");
const FIND = argv.includes("--find") || li < 0;   // searching is the default

/* Windows hands paths in with debris on the end. A cmd FOR loop's %~dp
 * expansion ends in a backslash, so "...\headshots\" reaches the process as
 * ...headshots" - cmd read the backslash as escaping the closing quote. A
 * pasted path can also arrive with its own trailing separator. Both are the
 * folder the person meant, so strip them rather than reporting "no such
 * folder" at someone who typed the right thing. */
function cleanPath(p) {
  if (!p) return p;
  let s = String(p).trim().replace(/["']+$/, "").replace(/^["']+/, "");
  // Not on a bare root ("C:\", "/"), where the separator is the path.
  if (s.length > 3) s = s.replace(/[\\/]+$/, "");
  return s;
}

/* Every non-flag argument after --local is a folder, so several can be given
 * at once and are merged exactly as --find merges what it discovers. */
const explicit = [];
if (li >= 0) {
  for (let i = li + 1; i < argv.length && !argv[i].startsWith("--"); i++) {
    const p = cleanPath(argv[i]);
    if (p) explicit.push(p);
  }
}

/* Walks the home directory for folders literally named "headshots". Bounded
 * at six levels and skipping the usual heavy directories, which keeps it to a
 * second or two rather than a scan of everything a machine has ever held. */
const SKIP = new Set([
  "node_modules", ".git", ".venv", "venv", "__pycache__", ".cache", "AppData",
  "Library", "Windows", "Program Files", "Program Files (x86)", ".next", "dist", "build"
]);
function findHeadshotFolders(root, depth = 0, out = []) {
  if (depth > 6) return out;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { return out; }                       // unreadable, not our business
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const full = path.join(root, e.name);
    if (e.name.toLowerCase() === "headshots") { out.push(full); continue; }
    findHeadshotFolders(full, depth + 1, out);
  }
  return out;
}

const SOURCES = explicit;

/* --find is kept as a DISCOVERY aid and no longer feeds the bake. It lists the
 * candidates and stops, because the whole lesson of the Iverson tile is that
 * choosing between them is a judgement about whose data to trust and not a
 * calculation this tool can make. */
if (!SOURCES.length) {
  if (FIND) {
    const home = os.homedir();
    process.stdout.write(`  searching ${home} for headshot folders...`);
    const found = findHeadshotFolders(home);
    console.log(` found ${found.length}\n`);
    found.forEach(f => console.log("    " + f));
    console.log(`
  Pick one and pass it with --local. This no longer merges them: two of the
  folders on this machine carry a file called "Allen Iverson.png" that is a
  photograph of Jamal Crawford, and the old merge preferred it because it was
  larger. A byte count cannot tell you whose face is in a file.

  The folder that produced the data/faces tiles already accepted is:
    C:\\Users\\Jorge Sierra\\Documents\\GitHub\\bar-chart-race\\assets\\headshots
`);
  } else {
    console.error(`usage:
  node tools/retile_faces.mjs --local <folder> [<folder> ...] [--set races|teammates|both] [--write]
  node tools/retile_faces.mjs --local <folder> --explain <slug>
  node tools/retile_faces.mjs --find          (lists candidate folders, bakes nothing)

A source folder must be named. See the header for why this stopped guessing.`);
  }
  process.exit(1);
}
for (const s of SOURCES) {
  if (!fs.existsSync(s)) { console.error(`no such folder: ${s}`); process.exit(1); }
}
const si = argv.indexOf("--set");
const setArg = si >= 0 && argv[si + 1] ? argv[si + 1] : "both";
if (!["races", "teammates", "both"].includes(setArg)) {
  console.error(`--set must be races, teammates or both (got "${setArg}")`);
  process.exit(1);
}
const CHOSEN = (setArg === "both" ? ["races", "teammates"] : [setArg])
  .map(k => SETS[k])
  /* A missing folder is not an error when both were asked for: a checkout that
   * has never built the teammates pool simply has nothing to re-bake there. */
  .filter(cfg => {
    if (fs.existsSync(cfg.dir)) return true;
    console.log(`  skipping ${cfg.label} - the folder is not in this checkout`);
    return false;
  });
if (!CHOSEN.length) {
  console.error("nothing to rebuild: neither tile folder is present");
  process.exit(1);
}

/* Slugging lives in lib/faces.mjs now, as tileSlugVariants, because this is
 * the third time a tile and its source file have disagreed over punctuation
 * and the first two fixes were made here where nothing could test them.
 * tools/test_tile_slugs.mjs covers it. */
const slugsFor = name => tileSlugVariants(name);

/* slug -> source, by PRECEDENCE: the first folder named on the command line
 * that has the file wins. Not the largest, not the newest. If you want a
 * different folder to win, name it first.
 *
 * Where two named folders hold the same slug at different sizes they are
 * recorded as a conflict and printed. That is the signal the old version threw
 * away: the Iverson fork was visible in the data all along, and largest-wins
 * silently resolved it the wrong way instead of saying "these disagree". */
const bySlug = new Map();
const conflicts = [];

/* ONE PASS PER VARIANT LEVEL, so an exact match can never be displaced by a
 * fuzzier one from a folder named later. Doing it in a single pass per file
 * would let "Nenê" claim nene before some other file's exact nene arrived.
 *
 * Files are SORTED within each folder. readdir order is the filesystem's
 * business, and letting it decide which of two candidates wins makes a build's
 * output depend on the machine's mood - the same reason foldedPngIndex sorts. */
const listing = SOURCES.map(dir => {
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith(".png")).sort(); }
  catch (e) { /* unreadable folder, reported by the existence check above */ }
  return { dir, files };
});

const LEVELS = 4;
for (let level = 0; level < LEVELS; level++) {
  for (let i = 0; i < listing.length; i++) {
    const { dir, files } = listing[i];
    for (const f of files) {
      const variants = slugsFor(f.slice(0, -4));
      const slug = variants[level];
      if (!slug) continue;
      const full = path.join(dir, f);
      let size;
      try { size = fs.statSync(full).size; } catch (e) { continue; }
      const prev = bySlug.get(slug);
      if (!prev) { bySlug.set(slug, { file: full, size, dir, rank: i, level }); continue; }
      /* A conflict only counts within the SAME level: an exact match beating a
       * punctuation-cut one is the precedence working, not a disagreement.
       * Same bytes is a copy of one file in two checkouts, also not one. */
      if (prev.level === level && prev.size !== size) {
        conflicts.push({ slug, kept: prev, other: { file: full, size } });
      }
    }
  }
}

if (conflicts.length) {
  console.log(`
  ${conflicts.length} slug(s) differ between the folders you named. The FIRST
  folder wins; these are the ones where that choice actually decided something,
  so look at any you do not recognise before writing:`);
  for (const c of conflicts.slice(0, 12)) {
    console.log(`    ${c.slug}`);
    console.log(`       using ${c.kept.size} bytes  ${c.kept.file}`);
    console.log(`       other ${c.other.size} bytes  ${c.other.file}`);
  }
  if (conflicts.length > 12) console.log(`    ...and ${conflicts.length - 12} more`);
}

/* --explain one tile and stop. The question "which file did it pick, and what
 * else was on offer" had no answer at all before, which is why a wrong pick
 * could only be found by opening a PNG in a photo viewer. */
const xi = argv.indexOf("--explain");
if (xi >= 0 && argv[xi + 1]) {
  const want = argv[xi + 1].replace(/\.png$/i, "");
  console.log(`\n  candidates for "${want}" across the ${SOURCES.length} folder(s) named:\n`);
  let n = 0;
  for (const dir of SOURCES) {
    let files = [];
    try { files = fs.readdirSync(dir); } catch (e) { /* skip */ }
    for (const f of files) {
      if (!f.toLowerCase().endsWith(".png")) continue;
      if (!slugsFor(f.slice(0, -4)).includes(want)) continue;
      let size = 0;
      try { size = fs.statSync(path.join(dir, f)).size; } catch (e) { /* skip */ }
      console.log(`    ${String(size).padStart(9)}  ${path.join(dir, f)}`);
      n++;
    }
  }
  const hit = bySlug.get(want);
  console.log(n ? `\n  would use: ${hit ? hit.file : "(none)"}\n`
                : `\n  no file matching that slug in any folder named.\n`);
  process.exit(0);
}

let anyWritten = 0;

for (const cfg of CHOSEN) {
  const tiles = fs.readdirSync(cfg.dir).filter(f => f.endsWith(".png"));
  let rebuilt = 0, unchanged = 0, tooSmall = 0, failed = 0;
  const missing = [];
  const used = new Map(SOURCES.map(x => [x, 0]));

  for (const tile of tiles) {
    const slug = tile.slice(0, -4);
    const hit = bySlug.get(slug);
    if (!hit) { missing.push(slug); continue; }
    if (hit.size < MIN_SRC_BYTES) { tooSmall++; continue; }

    /* The sources are bar-chart-race cut-outs, whose pixels are not square.
     * Without srcAspect the tiles come out correctly FRAMED and 1.4x too
     * narrow, which is what "the Bar Races still look stretched" was. Each
     * set passes it in its own bake function so neither can be forgotten. */
    const buf = cfg.bake(hit.file);
    if (!buf) { failed++; console.log(`  could not decode ${path.basename(hit.file)}`); continue; }
    used.set(hit.dir, (used.get(hit.dir) || 0) + 1);

    const dest = path.join(cfg.dir, tile);
    const before = fs.readFileSync(dest);
    if (before.equals(buf)) { unchanged++; continue; }
    if (WRITE) fs.writeFileSync(dest, buf);
    /* The first few sources, printed. 859 lines would be unreadable and no
     * lines at all is how a wrong folder went unnoticed, so: enough to spot
     * the wrong checkout in the first second of output. */
    if (rebuilt < 6) console.log(`    ${tile}  <-  ${hit.file}`);
    rebuilt++;
  }
  anyWritten += rebuilt;

  /* The match rate is the headline number when comparing checkouts. Five
   * folders called "headshots" can sit on one machine and resolve wildly
   * different numbers of players; picking the wrong one silently leaves most
   * tiles distorted. */
  const matched = tiles.length - missing.length;
  const pct = tiles.length ? Math.round(100 * matched / tiles.length) : 0;

  console.log(`
  ${cfg.label}
  ${"-".repeat(58)}
  folders used       ${SOURCES.length}`);
  for (const [dir, n] of used) console.log(`    ${String(n).padStart(4)} tiles   ${dir}`);
  console.log(`
  MATCH RATE         ${matched} of ${tiles.length} tiles (${pct}%)
  source images      ${bySlug.size} distinct players across all folders
  tiles on disk      ${tiles.length}
  rebuilt            ${rebuilt}${WRITE ? "" : "   (dry run - nothing written)"}
  already correct    ${unchanged}
  source too small   ${tooSmall}   (CDN placeholder, tile left alone)
  no source found    ${missing.length}
  decode failed      ${failed}`);

  if (missing.length) {
    console.log(`\n  These keep their old tile - no file for them in any headshots folder:`);
    console.log("  " + missing.slice(0, 12).join(", ") +
      (missing.length > 12 ? `, and ${missing.length - 12} more` : ""));
  }
}

console.log(WRITE
  ? `\n  ${anyWritten} tiles rewritten. Look at a bar race and a Teammates card before` +
    `\n  committing. To undo all of it:\n     git checkout -- data/races/faces data/teammates/faces\n`
  : `\n  Nothing was changed. Add --write when the match rates look right.\n`);
