#!/usr/bin/env node
/* NBA Doomscroll — bar chart race builder
 *
 * Replaces the 12 pre-rendered MP4 clips with compact per-race JSON that the
 * browser animates on a canvas (js/race-player.js). Two reasons:
 *
 *   Size.    A 90-second 720p clip is ~2MB. Thirty of them is 60MB in the repo
 *            and a 2MB download per card. The same race as data is 8-15KB.
 *   Reach.   Franchise / country / draft-class / generation races only become
 *            practical when adding one costs a few KB instead of a render job.
 *
 * Everything is computed from files already in Jorge's repos. Nothing is
 * estimated and no external service is contacted at build time.
 *
 *   rsStats.json / poStats.json   per-season totals, 1947-2026
 *   salaries.json                 salaries 1991-2026 (career earnings race)
 *   bio.json                      NATIONALITY, DRAFT year, BIRTHDAY
 *   awards.json                   All-Star / All-NBA / titles / scoring titles
 *   player-headshots.json         name -> "<nbaId>-<slug>"
 *   nba-headshots face crops      the committed PNGs themselves (see lib/faces.mjs)
 *   Games.csv                     73K games, 1946-2026 (franchise races)
 *   bio.csv (optional)            salary-season-finder's COLLEGE / TEAM column
 *
 * Usage:
 *   node tools/build_races.mjs --find
 *   node tools/build_races.mjs --local <playerDataDir> <nbaHeadshotsRepo> <gamesCsv> [bioCsv] [bcrFaces]
 *
 * --find locates every source by the files it must contain, so none of these
 * paths has to be typed. --local still wins where a machine holds more than
 * one checkout of the same repo. One source can be overridden on its own with
 * --player-data / --headshots / --games / --bio / --faces, for a file the
 * search cannot reach (another drive, or below a skipped folder).
 *
 * --playoffs names a SECOND games file, read only for playoff history. The
 * schedule on this machine ends in June 2023 while the playoff export runs to
 * May 2025, so the playoff races and the championship count merge the two.
 * franchise-wins deliberately does not: see the comment above winInc.
 *
 * Writes data/races/index.json (catalog) and data/races/r/<slug>.json (one per
 * race). Leaves the old data/races/*.mp4 files alone — nothing reads them once
 * this lands, but deleting them is a separate, deliberate commit.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildFaceIndex, reportFaceIndex, foldedPngIndex, foldAccents } from "./lib/faces.mjs";
import { raceFaceTile, decodePng, resize, encodePng } from "./lib/png.mjs";
import { resolveSource, findFiles, findFolders, findCsvWithColumns, cleanPath } from "./lib/find.mjs";
import { GAMES_COLUMNS, GAME_TABLE_COLUMNS, hasRegularSeason, normalizeGames, scheduleSpan, mergePlayoffs } from "./lib/games.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const OUT = path.join(REPO, "data", "races");
const OUT_R = path.join(OUT, "r");

const HEADSHOT_BASE = "https://jsierrahoopshype.github.io/nba-headshots/players/headshots/face/";
const LOGO_BASE = "https://jsierrahoopshype.github.io/nba-headshots/teams/logos/current/svg/";

const KEEP = 15;         // rows stored per step; the player shows 10 and lets
                          // the rest animate in and out of the frame

/* FIVE PATHS WAS FOUR TOO MANY.
 *
 * This builder asked for a player-data checkout, a headshots repo, a CSV, a
 * second CSV and a headshots folder, all typed by hand. That is exactly the
 * shape of request that produced a placeholder pasted verbatim more than once,
 * and it is why two pools sat unbuilt for weeks: not because the work was
 * hard, but because nobody had the paths to hand.
 *
 * --find locates each one by the files it must contain. --local still takes
 * them positionally and still wins, because this machine holds more than one
 * checkout of some repos and an explicit path is the only way to say which. */
const args = process.argv.slice(2);
const li = args.indexOf("--local");
const FIND = args.includes("--find") || li < 0;
let [PD, HSMETA, GAMES_CSV, BIO_CSV, BCR_FACES] = li >= 0 ? args.slice(li + 1) : [];
let PLAYOFF_CSV = null;

/* NAMED OVERRIDES, so one source the search cannot reach does not send anyone
 * back to typing all five. A file kept on another drive, or below a folder the
 * walk skips, is pointed at directly and everything else is still found:
 *
 *     node tools/build_races.mjs --find --games "D:\data\Games.csv"
 */
function flag(name) {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}
PD = flag("player-data") || PD;
HSMETA = flag("headshots") || HSMETA;
GAMES_CSV = flag("games") || GAMES_CSV;
BIO_CSV = flag("bio") || BIO_CSV;
BCR_FACES = flag("faces") || BCR_FACES;
/* A second games file read ONLY for playoff history, where the main schedule
 * does not reach far enough. Found automatically; this pins it. */
PLAYOFF_CSV = flag("playoffs") || PLAYOFF_CSV;

if (!FIND && (li < 0 || args.length - li - 1 < 3)) {
  console.error("usage: node tools/build_races.mjs --find");
  console.error("   or: node tools/build_races.mjs --local <playerData> <nbaHeadshotsRepo> <gamesCsv> [bioCsv] [barRaceHeadshotsDir]");
  console.error("  bioCsv:  salary-season-finder/data_sources/bio.csv — adds the college/club races");
  console.error("  faces:   bar-chart-race/assets/headshots — the preferred headshot source");
  console.error("           (its ../logos is picked up automatically for franchise races)");
  process.exit(1);
}

if (FIND) {
  console.log("Locating source data…");
  /* Each source is named by files it CANNOT be without. rsStats.json alone
   * would match a stale partial copy; naming several means the folder that
   * answers is the real checkout. */
  PD = resolveSource("nba-player-data", {
    explicit: PD,
    markers: ["rsStats.json", "poStats.json", "salaries.json", "player-headshots.json"]
  });
  HSMETA = resolveSource("nba-headshots", {
    explicit: HSMETA,
    markers: [path.join("players", "metadata", "players.json")]
  });
  /* By name first, then BY COLUMNS. There is no file called Games.csv on
   * Jorge's machine - there is a Games_enriched.csv, a game.csv and a
   * Games_Playoffs_Since1946.csv, and only one of them holds what this reads.
   * A filename is what someone called a file; a header row is what the file
   * is. So the fallback asks for the columns the builder cannot work without,
   * which cannot match a lookalike. */
  GAMES_CSV = cleanPath(GAMES_CSV);
  if (!GAMES_CSV) {
    const named = findFiles(["Games.csv"]);
    if (named.length) {
      GAMES_CSV = named[0];
      console.log(`  searching for Games.csv... ${named.length} found`);
      named.forEach((h, i) => console.log(`    ${i === 0 ? "using " : "also  "}${h}`));
    } else {
      process.stdout.write("  no Games.csv by name; searching by columns...");
      /* Both schemas, and then RANKED BY WHETHER THEY HOLD A FULL SCHEDULE.
       *
       * Newest-first picked a playoffs-only subset and shipped a race titled
       * "All-time franchise wins" showing playoff wins. The property that
       * actually matters is not the filename, not the column names and not the
       * modification time - it is whether the file contains regular-season
       * games. So that is what gets checked, by reading the first few hundred
       * rows of each candidate. */
      const byCols = [...new Set([
        ...findCsvWithColumns(GAMES_COLUMNS),
        ...findCsvWithColumns(GAME_TABLE_COLUMNS)
      ])];
      console.log(` ${byCols.length} found`);
      /* Then by COVERAGE among the full ones. Two valid full schedules were
       * found and the newer won, which cost ten seasons of champions -
       * franchise-titles fell from 75 steps to 65 with nothing to say why,
       * because a filesystem date decided a question about history. */
      const ranked = byCols.map(f => ({ f, full: hasRegularSeason(f), span: scheduleSpan(f) }))
        .sort((a, b) =>
          ((b.full === true) - (a.full === true)) || (b.span.rows - a.span.rows));
      if (ranked.length) {
        GAMES_CSV = ranked[0].f;
        ranked.forEach((c, i) => console.log(
          `    ${i === 0 ? "using " : "also  "}${c.f}\n` +
          `           ${c.full ? "full schedule" : "PLAYOFFS ONLY"}, ` +
          `${c.span.rows.toLocaleString()} rows, ${c.span.from || "?"} to ${c.span.to || "?"}`));
        if (ranked.length > 1) console.log("    (full schedule first, then most rows. --games pins one.)");

        /* A REJECTED CANDIDATE CAN STILL BE WORTH READING.
         *
         * The playoffs-only file loses on coverage and is right to lose - but
         * it runs to May 2025 while the chosen schedule stops in June 2023, so
         * discarding it costs two championships. Any candidate whose history
         * reaches further than the winner's is kept as a playoff top-up. */
        const chosenTo = ranked[0].span.to || "";
        const extra = ranked.slice(1)
          .filter(c => (c.span.to || "") > chosenTo)
          .sort((a, b) => String(b.span.to).localeCompare(String(a.span.to)));
        if (!PLAYOFF_CSV && extra.length) {
          PLAYOFF_CSV = extra[0].f;
          console.log(`    playoff top-up: ${PLAYOFF_CSV}`);
          console.log(`           reaches ${extra[0].span.to}, past the chosen schedule's ${chosenTo || "?"}`);
        }
      }
    }
  } else if (!fs.existsSync(GAMES_CSV)) {
    console.error(`  Games.csv: no such path: ${GAMES_CSV}`);
    GAMES_CSV = null;
  }
  if (!PD || !HSMETA || !GAMES_CSV) {
    /* Name the flag for the thing that is missing, rather than the generic
     * "pass explicit paths" that leaves someone reconstructing all five. */
    const miss = [[!PD, "--player-data"], [!HSMETA, "--headshots"], [!GAMES_CSV, "--games"]]
      .filter(m => m[0]).map(m => m[1]);
    console.error(`\nMissing ${miss.length === 1 ? "a source" : "sources"} this build cannot run without: ${miss.join(", ")}.`);
    /* NO PLACEHOLDER. A printed <path> has been pasted back verbatim often
     * enough to count as a design fault rather than a slip, so what is printed
     * is a command that computes the path into a variable and needs nothing
     * substituted into it. */
    if (!GAMES_CSV) {
      console.error("\nThe games file is not called Games.csv and does not carry");
      console.error(`the columns this reads (${GAMES_COLUMNS.join(", ")}).`);
      console.error("To see which of your CSVs has what, in PowerShell:");
      console.error("");
      console.error('  Get-ChildItem $HOME -Recurse -Filter "*.csv" -EA SilentlyContinue |');
      console.error('    Where-Object Name -like "*game*" |');
      console.error('    ForEach-Object { "{0}`n    {1}" -f $_.FullName, (Get-Content $_.FullName -First 1) }');
      console.error("");
      console.error("Then run this, replacing nothing - paste the path between the quotes:");
      console.error("  node tools/build_races.mjs --find --games \"\"");
    }
    process.exit(1);
  }
  /* The last two are optional: without them the build simply emits fewer
   * races and says so, rather than failing. So a miss is a note, not an exit. */
  /* EVERY candidate is printed, not just the winner. These two were the
   * exception and it cost a build: the faces search took an hf_space copy
   * holding a fraction of the portraits, coverage came out at 32%, and the
   * output gave no hint that a fuller folder had been passed over. Showing one
   * line per candidate is the difference between a wrong choice you can see
   * and a wrong choice you cannot. */
  if (!BIO_CSV) {
    const hits = findFiles(["bio.csv"]);
    if (hits.length) {
      BIO_CSV = hits[0];
      hits.forEach((h, i) => console.log(`    ${i === 0 ? "using " : "also  "}${h}`));
    } else console.log("  bio.csv not found — the college and club races will be skipped.");
  }
  if (!BCR_FACES) {
    const hits = findFolders([path.join("assets", "headshots")])
      .map(d => path.join(d, "assets", "headshots"));
    if (hits.length) {
      /* Newest is the wrong tie-break for a picture library: a folder touched
       * yesterday can hold 400 files where an older one holds 5,000, and the
       * bigger library is what a race wants. So these are ranked by how many
       * PNGs they actually contain. */
      const counted = hits.map(dir => {
        let n = 0;
        try { n = fs.readdirSync(dir).filter(f => /\.png$/i.test(f)).length; } catch (e) {}
        return { dir, n };
      }).sort((a, b) => b.n - a.n);
      BCR_FACES = counted[0].dir;
      counted.forEach((c, i) =>
        console.log(`    ${i === 0 ? "using " : "also  "}${c.dir}  (${c.n} PNGs)`));
      if (counted.length > 1) console.log("    (most portraits wins. --faces pins one.)");
    } else {
      console.log("  bar-chart-race headshots not found — tiles will fall back to remote URLs.");
    }
  }
  console.log("");
}

const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
const num = v => { const n = parseFloat(String(v == null ? "" : v).replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; };

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = line => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map(l => {
    const cells = split(l), row = {};
    head.forEach((h, i) => { row[h] = cells[i] === undefined ? "" : cells[i]; });
    return row;
  });
}

/* ---------------- palettes ---------------- */

// Primary colors for the 30 current franchises plus the historical abbreviations
// that appear in rsStats. Public brand colors; used only to tint a bar.
const TEAM_COLOR = {
  ATL: "#e03a3e", BOS: "#007a33", BKN: "#1d1d1f", CHA: "#1d1160", CHI: "#ce1141",
  CLE: "#860038", DAL: "#00538c", DEN: "#0e2240", DET: "#1d42ba", GSW: "#1d428a",
  HOU: "#ce1141", IND: "#002d62", LAC: "#c8102e", LAL: "#552583", MEM: "#5d76a9",
  MIA: "#98002e", MIL: "#00471b", MIN: "#0c2340", NOP: "#0c2340", NYK: "#006bb6",
  OKC: "#007ac1", ORL: "#0077c0", PHI: "#006bb6", PHX: "#1d1160", POR: "#e03a3e",
  SAC: "#5a2d81", SAS: "#6b6b70", TOR: "#ce1141", UTA: "#002b5c", WAS: "#002b5c",
  // relocated / defunct, so a 1970s race still gets a sensible tint
  SEA: "#00653a", VAN: "#00808c", NJN: "#0044a8", NOH: "#0c2340", NOK: "#0c2340",
  CHH: "#1d1160", WSB: "#002b5c", KCK: "#5a2d81", SDC: "#c8102e", BUF: "#c8102e",
  CIN: "#002d62", STL: "#e03a3e", SYR: "#006bb6", ROC: "#5d76a9", FTW: "#1d42ba",
  MNL: "#552583", PHW: "#006bb6", BAL: "#002b5c", SFW: "#1d428a", CAP: "#002b5c",
  NOJ: "#002b5c", SDR: "#c8102e", MLH: "#e03a3e", TRI: "#e03a3e", INO: "#002d62",
  AND: "#1d42ba", SHE: "#00471b", WAT: "#5d76a9", DNN: "#0e2240", CHS: "#ce1141",
  CHZ: "#1d1160", CHP: "#1d1160", PIT: "#1d1d1f", PRO: "#007a33", TOK: "#5a2d81",
  BOM: "#007a33", DTF: "#1d42ba", WSC: "#002b5c", CLR: "#860038", STB: "#e03a3e"
};

// Neutral ramp for non-team entities (countries, draft classes, generations).
const RAMP = [
  "#3b82f6", "#1d8a40", "#b26b00", "#7c3aed", "#0f766e", "#d12c2c",
  "#2563eb", "#059669", "#c2410c", "#9333ea", "#0891b2", "#be123c",
  "#4338ca", "#15803d", "#a16207", "#6d28d9", "#0e7490", "#9f1239"
];
function rampColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
  return RAMP[h % RAMP.length];
}

/* ---------------- load ---------------- */

console.log("Reading source data…");
const rs = readJson(path.join(PD, "rsStats.json"));
const po = readJson(path.join(PD, "poStats.json"));
const bioRows = readJson(path.join(PD, "bio.json"));
const salaries = readJson(path.join(PD, "salaries.json"));
const awards = readJson(path.join(PD, "awards.json"));
const headMap = readJson(path.join(PD, "player-headshots.json"));
let games;
try {
  const norm = normalizeGames(parseCsv(fs.readFileSync(GAMES_CSV, "utf8")));
  games = norm.rows;
  if (norm.schema === "game-table") {
    console.log("  games file uses the NBA game-table schema; columns mapped.");
    if (norm.noResult) console.log(`  ${norm.noResult} rows carry no W/L and count as no result.`);
  }
} catch (e) {
  console.error("\n" + e.message);
  process.exit(1);
}

/* The playoff-history top-up. Optional: without it the playoff races simply
 * end where the primary schedule ends, which is the behaviour that existed
 * before this file was ever consulted. */
let playoffGames = games.filter(g => g.gameType === "Playoffs");
if (PLAYOFF_CSV) {
  try {
    const sec = normalizeGames(parseCsv(fs.readFileSync(PLAYOFF_CSV, "utf8")));
    const merged = mergePlayoffs(games, sec.rows);
    playoffGames = merged.rows;
    console.log(`  playoff history topped up from ${path.basename(PLAYOFF_CSV)}: ` +
      `${merged.fromPrimary.toLocaleString()} playoff games in the schedule, ` +
      `${merged.added.toLocaleString()} more it did not have.`);
    if (!merged.added) {
      console.log("    (nothing new — the schedule already covers that file.)");
    }
  } catch (e) {
    console.log(`  playoff top-up skipped: ${e.message.split("\n")[0]}`);
  }
}

// Which names resolve to a face crop that is actually committed, with the
// father/son collisions in the name map screened out. See tools/lib/faces.mjs —
// reading players.json alone was why this used to report 5% coverage.
const FACES = buildFaceIndex(HSMETA, headMap);
reportFaceIndex(FACES, "Headshots");

const bio = new Map(bioRows.map(b => [b.PLAYER, b]));

/* ---------------- headshot tiles ----------------
 *
 * bar-chart-race/assets/headshots is the better source by a distance: 5,082
 * PNGs keyed by plain player name, covering Wilt, Russell, Bird, West,
 * Havlicek, Mikan and Unseld — none of whom nba-headshots can resolve at all.
 * Files under 15KB are NBA CDN silhouette placeholders and are skipped, which
 * is the same rule render.py applies.
 *
 * Each one is baked here into the tile the theme actually displays: top 80% of
 * the source, then cover-cropped to 1.4:1 landscape. That drops ~55KB portraits
 * to ~10KB tiles, and leaves the browser with nothing to crop.
 *
 * Cropped, not squashed. It used to resize straight to 112x80, which forces any
 * source shape into 1.4:1 and made every head 17% too narrow for its height.
 * See tools/lib/png.mjs and tools/test_face_tiles.mjs.
 */
const TILE_W = 112, TILE_H = 80;
const MIN_SRC_BYTES = 15000;
const FACE_DIR = path.join(OUT, "faces");
const tileCache = new Map();

/* ACCENTS: the race data spells names in ASCII, the files on disk keep their
 * diacritics. So "Jusuf Nurkic" asked the filesystem for "Jusuf Nurkic.png"
 * while "Jusuf Nurkić.png" sat right there, and those players silently fell
 * through to the remote headshot URL instead of getting a baked tile.
 *
 * Folded once into an index, not folded per lookup: a directory listing is one
 * syscall and there are thousands of lookups.
 *
 * Deliberately fold-only. tools/lib/faces.mjs has buildBcrIndex, which the
 * other three builders use and which would also match on a suffix-stripped
 * stem - and that resolves "Tim Hardaway" to his son's photograph unless its
 * guards catch it. Accents are the gap; stem matching is a different decision
 * about a builder whose output Jorge checks by eye, so it is not smuggled in
 * here. Both live in tools/lib/faces.mjs; this builder takes the safe half. */
let foldedFiles = null;   // folded stem -> absolute path, built on first use
let accentHits = 0;

function foldedIndex() {
  if (!foldedFiles) foldedFiles = foldedPngIndex(BCR_FACES);
  return foldedFiles;
}

function sourceFor(name) {
  // Exact path first: a folder whose filenames are already ASCII resolves
  // exactly as it did before this index existed.
  const direct = path.join(BCR_FACES, name + ".png");
  if (fs.existsSync(direct)) return direct;
  const hit = foldedIndex().get(foldAccents(name));
  if (hit) accentHits++;
  return hit || direct;   // the direct path, so the statSync below reports it
}

function tileFor(name) {
  if (!BCR_FACES) return null;
  if (tileCache.has(name)) return tileCache.get(name);
  let out = null;
  const src = sourceFor(name);
  try {
    if (fs.statSync(src).size >= MIN_SRC_BYTES) {
      const buf = raceFaceTile(src, TILE_W, TILE_H);
      if (buf) {
        const slug = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
        fs.mkdirSync(FACE_DIR, { recursive: true });
        fs.writeFileSync(path.join(FACE_DIR, slug + ".png"), buf);
        out = "data/races/faces/" + slug + ".png";
      }
    }
  } catch (e) { /* no file for this player */ }
  tileCache.set(name, out);
  return out;
}

// Prefer the baked tile; fall back to nba-headshots for the handful it adds.
const faceFor = name => tileFor(name) || FACES.urlFor(name);

// The team a player logged the most games for — used to tint their bar and to
// tag the card. Stable across the whole race, unlike their team that season.
//
// Keyed by a nested Map rather than a joined "player<sep>team" string. The old
// version joined on a separator that had to survive names containing spaces,
// and the character that ended up in the file was a literal NUL — which worked,
// but made git treat this whole file as binary and refuse to diff it.
const gpByPlayerTeam = new Map();   // player -> Map(team -> games)
for (const r of rs) {
  let m = gpByPlayerTeam.get(r.PLAYER);
  if (!m) { m = new Map(); gpByPlayerTeam.set(r.PLAYER, m); }
  m.set(r.TEAM, (m.get(r.TEAM) || 0) + num(r.GP));
}
const mainTeam = new Map();
for (const [player, m] of gpByPlayerTeam) {
  let bestTeam = null, bestGp = -1;
  for (const [team, gp] of m) if (gp > bestGp) { bestGp = gp; bestTeam = team; }
  if (bestTeam && bestTeam !== "TOT") mainTeam.set(player, bestTeam);
}


/* ---------------- race assembly ---------------- */

/* Builds one race from a flat list of {step, key, value} increments.
 * Values accumulate step over step. Steps are emitted in sorted order and any
 * step where nothing has happened yet is skipped, so a race never opens on an
 * empty chart. */
function buildRace(spec, increments, entityFor) {
  const perStep = new Map();       // step -> Map(key -> delta)
  for (const inc of increments) {
    if (!inc.step || !inc.key || !inc.value) continue;
    let m = perStep.get(inc.step);
    if (!m) { m = new Map(); perStep.set(inc.step, m); }
    m.set(inc.key, (m.get(inc.key) || 0) + inc.value);
  }
  const steps = [...perStep.keys()].sort();
  if (steps.length < 6) return null;

  const total = new Map();
  const labels = [];
  const frames = [];
  const usedKeys = new Set();

  for (const step of steps) {
    for (const [k, v] of perStep.get(step)) total.set(k, (total.get(k) || 0) + v);
    const rows = [...total.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP);
    if (rows.length < 3) continue;       // skip the thin opening seasons
    labels.push(String(step));
    frames.push(rows);
    rows.forEach(([k]) => usedKeys.add(k));
  }
  if (labels.length < 6) return null;

  // Only entities that ever made the top KEEP get shipped.
  const keys = [...usedKeys];
  const idx = new Map(keys.map((k, i) => [k, i]));
  const entities = keys.map(entityFor);

  return {
    slug: spec.slug,
    group: spec.group,
    title: spec.title,
    subtitle: spec.subtitle,
    unit: spec.unit,
    fmt: spec.fmt || "int",
    kind: spec.kind,
    tier: spec.tier || 2,
    note: spec.note || "",
    tags: spec.tags || {},
    labels,
    e: entities,
    f: frames.map(rows => rows.map(([k, v]) => [idx.get(k), Math.round(v * (spec.fmt === "float1" ? 10 : 1))]))
  };
}

const playerEntity = name => {
  const t = mainTeam.get(name) || null;
  const img = faceFor(name);
  const e = {
    n: name,
    img,
    c: (t && TEAM_COLOR[t]) || rampColor(name),
    t: t
  };
  // A baked tile needs no source box: it is already the exact landscape crop
  // the theme draws. Only the nba-headshots fallback carries one, and `b` is
  // also what tells the renderer this is a person rather than a franchise.
  if (img && !/^data\/races\/faces\//.test(img)) {
    const b = FACES.boxFor(name); if (b) e.b = b;
  } else if (img) {
    e.b = [0, 0, 1, 1];
  }
  return e;
};

const races = [];
function add(race) {
  if (!race) return;
  races.push(race);
  const steps = race.labels.length;
  const bytes = Buffer.byteLength(JSON.stringify(race));
  console.log(`  ${race.slug.padEnd(26)} ${String(steps).padStart(3)} steps  ${String(race.e.length).padStart(3)} entities  ${(bytes / 1024).toFixed(1)}KB`);
}

/* ---- career regular-season totals ---- */

console.log("Career totals…");
const CAREER = [
  { slug: "career-points",   col: "PTS", title: "All-time scoring leaders",    unit: "pts",  tier: 1 },
  { slug: "career-rebounds", col: "REB", title: "All-time rebounding leaders", unit: "reb",  tier: 1 },
  { slug: "career-assists",  col: "AST", title: "All-time assist leaders",     unit: "ast",  tier: 1 },
  { slug: "career-threes",   col: "3P",  title: "All-time 3-pointers made",    unit: "3PM",  tier: 1 },
  { slug: "career-steals",   col: "STL", title: "All-time steals leaders",     unit: "stl",  tier: 2 },
  { slug: "career-blocks",   col: "BLK", title: "All-time blocks leaders",     unit: "blk",  tier: 2 },
  // Demoted per review: counting stats that mostly reward longevity. Still
  // built, but tier 3 so the feed reaches for them last.
  { slug: "career-games",    col: "GP",  title: "Most career games played",    unit: "games", tier: 3 },
  { slug: "career-minutes",  col: "MIN", title: "Most career minutes played",  unit: "min",  tier: 3 },
  { slug: "career-fgm",      col: "FGM", title: "Most career field goals made", unit: "FGM", tier: 3 },
  { slug: "career-ftm",      col: "FTM", title: "Most career free throws made", unit: "FTM", tier: 3 }
];
// Turnovers dropped entirely: the column only starts in 1978, so the "race" is
// really a race to have played after 1978, and leading it is not a distinction.

for (const c of CAREER) {
  add(buildRace({
    slug: c.slug, group: "Career", title: c.title,
    subtitle: "Regular-season " + c.unit + ", cumulative by season",
    unit: c.unit, kind: "player", tier: c.tier,
    tags: { category: ["career", "leaders"] }
  }, rs.map(r => ({ step: r.YEAR, key: r.PLAYER, value: num(r[c.col]) })), playerEntity));
}

/* ---- career earnings ---- */

add(buildRace({
  slug: "career-earnings", group: "Career",
  title: "Most career earnings", subtitle: "Cumulative salary, 1991 onward",
  unit: "", fmt: "money", kind: "player", tier: 2,
  note: "Salary data starts in 1991, so players who earned before then start from zero here.",
  tags: { category: ["career", "salary"] }
}, salaries.map(s => ({ step: s.YEAR, key: s.PLAYER, value: num(s.SALARY) })), playerEntity));

/* ---- playoffs ---- */

console.log("Playoffs…");
const PO = [
  { slug: "playoff-points",   col: "PTS", title: "All-time playoff scoring leaders", unit: "pts", tier: 1 },
  { slug: "playoff-rebounds", col: "REB", title: "All-time playoff rebounding leaders", unit: "reb", tier: 2 },
  { slug: "playoff-assists",  col: "AST", title: "All-time playoff assist leaders", unit: "ast", tier: 2 },
  { slug: "playoff-threes",   col: "3P",  title: "All-time playoff 3-pointers made", unit: "3PM", tier: 2 },
  { slug: "playoff-games",    col: "GP",  title: "Most playoff games played", unit: "games", tier: 3 }
];
for (const c of PO) {
  add(buildRace({
    slug: c.slug, group: "Playoffs", title: c.title,
    subtitle: "Playoff " + c.unit + ", cumulative by postseason",
    unit: c.unit, kind: "player", tier: c.tier,
    tags: { category: ["playoffs", "leaders"] }
  }, po.map(r => ({ step: r.YEAR, key: r.PLAYER, value: num(r[c.col]) })), playerEntity));
}

/* ---- franchises ---- */

console.log("Franchises…");
// teamId is stable through relocations and renames, so a franchise race follows
// the Sonics into Oklahoma City rather than restarting them. The label is the
// franchise's most recent name.
const teamName = new Map();
const teamAbbrev = new Map();
const ABBREV_BY_NICK = {};
// HSMETA may be the nba-headshots repo root or its players/metadata directory,
// so find teams.json rather than assuming which one was passed.
function findInHeadshots(...rel) {
  for (const base of [HSMETA, path.join(HSMETA, "..", ".."), path.join(HSMETA, "..")]) {
    const p = path.join(base, ...rel);
    if (fs.existsSync(p)) return p;
  }
  throw new Error("could not find " + rel.join("/") + " under " + HSMETA);
}
for (const t of readJson(findInHeadshots("teams", "metadata", "teams.json"))) {
  ABBREV_BY_NICK[t.full_name] = t.abbrev;
  teamAbbrev.set(String(t.team_id), t.abbrev);
  teamName.set(String(t.team_id), t.full_name);
}
for (const g of games) {                              // fill in defunct franchises
  for (const side of ["home", "away"]) {
    const id = g[side + "teamId"];
    if (!id || teamName.has(id)) continue;
    teamName.set(id, (g[side + "teamCity"] + " " + g[side + "teamName"]).trim());
  }
}
function gameSeason(g) {
  // NBA season year = the calendar year the Finals are played in, so anything
  // from August on belongs to next year's season.
  //
  // Exception: the 2020 bubble. That season restarted in July and its Finals
  // ended on 11 October 2020, so the plain month rule pushed every restart game
  // into 2021 and quietly cost the Lakers their 2020 title. July-October 2020
  // is the only stretch in this file where the rule breaks.
  const d = String(g.gameDate || g.gameDateTimeEst || "");
  const y = parseInt(d.slice(0, 4), 10), m = parseInt(d.slice(5, 7), 10);
  if (!y) return null;
  if (y === 2020 && m >= 7 && m <= 10) return "2020";
  return String(m >= 8 ? y + 1 : y);
}
/* The tool draws franchises from bar-chart-race/assets/logos/<ABBREV>.png.
 * Those are used here too, downsized into data/races/logos/, in preference to
 * nba-headshots' SVGs — partly for fidelity, partly because those SVGs carry a
 * viewBox and no width/height, which Chromium rasterises at 400px while
 * reporting naturalWidth 150. */
const LOGO_DIR = path.join(OUT, "logos");
const logoCache = new Map();
function logoFor(ab) {
  if (!ab) return null;
  if (logoCache.has(ab)) return logoCache.get(ab);
  let out = null;
  if (BCR_FACES) {
    const src = path.join(BCR_FACES, "..", "logos", ab + ".png");
    try {
      const img = decodePng(src);
      if (img) {
        fs.mkdirSync(LOGO_DIR, { recursive: true });
        fs.writeFileSync(path.join(LOGO_DIR, ab + ".png"), encodePng(resize(img, 96, 96)));
        out = "data/races/logos/" + ab + ".png";
      }
    } catch (e) { /* fall through */ }
  }
  if (!out) out = LOGO_BASE + ab.toLowerCase() + ".svg";
  logoCache.set(ab, out);
  return out;
}

const franchiseEntity = id => {
  const ab = teamAbbrev.get(id);
  return {
    n: teamName.get(id) || id,
    img: logoFor(ab),
    c: (ab && TEAM_COLOR[ab]) || rampColor(id),
    t: ab || null
  };
};

const winInc = [], poWinInc = [];
// The champion is the winner of the last playoff game a season plays — that
// game is the clinching Finals game by definition. Deliberately NOT read off
// gameLabel: the label is blank for every Finals from 1983 to 1996, which
// silently cost the Lakers, Celtics, Pistons, Bulls and Rockets their titles
// when this was first built. Deliberately NOT read off awards.json either: its
// TEAM column on an "NBA Champion" row is the player's team, not the champion.
const lastPlayoffGame = new Map();

/* TOTAL WINS COME FROM THE PRIMARY SCHEDULE ONLY.
 *
 * Not from the merged set below. The primary file ends in June 2023 and the
 * playoff file runs to May 2025, so a merged total would count regular-season
 * wins through 2023 and playoff wins through 2025 - a race whose two halves
 * stop in different years, which is a subtler wrong number than the one this
 * whole exercise started with. It ends where its data ends. */
for (const g of games) {
  const step = gameSeason(g);
  const w = g.winner;
  if (!step || !w) continue;
  winInc.push({ step, key: w, value: 1 });
}

/* Playoff wins and championships read the MERGED playoff set, which is the
 * primary's playoff rows topped up from the playoff-history file. */
for (const g of playoffGames) {
  const step = gameSeason(g);
  const w = g.winner;
  if (!step || !w) continue;
  poWinInc.push({ step, key: w, value: 1 });
  const when = String(g.gameDateTimeEst || g.gameDate || "");
  const cur = lastPlayoffGame.get(step);
  if (!cur || when > cur.when) lastPlayoffGame.set(step, { step, key: w, value: 1, when });
}
const finalsBySeason = lastPlayoffGame;

/* IS THIS ACTUALLY THE WHOLE SCHEDULE?
 *
 * franchise-wins counts every row; franchise-playoff-wins counts the rows
 * marked Playoffs. Hand it a playoffs-only export and both races come out
 * identical - same steps, same entities, same byte count - while the first one
 * still calls itself "All-time franchise wins" and is off by a factor of ten.
 * Nothing errors, because a playoffs-only file is a perfectly valid CSV.
 *
 * The build now says so. It does not refuse: which file to use is Jorge's
 * call, and a playoffs-only run is still useful for the playoff races. */
const typeTally = new Map();
for (const g of games) typeTally.set(g.gameType, (typeTally.get(g.gameType) || 0) + 1);
const regularSeasonRows = games.length - (typeTally.get("Playoffs") || 0);
if (games.length && regularSeasonRows === 0) {
  console.log("");
  console.log("  !! The games file holds ONLY playoff rows.");
  console.log(`     ${path.basename(GAMES_CSV)}: ${games.length} rows, all gameType=Playoffs.`);
  console.log("     franchise-wins is supposed to be every win a franchise has;");
  console.log("     from this file it is playoff wins, identical to franchise-playoff-wins.");
  console.log("     Point --games at a full schedule to fix it, or drop those two races.");
  console.log("");
} else if (games.length && regularSeasonRows / games.length < 0.5) {
  console.log(`  note: only ${Math.round(100 * regularSeasonRows / games.length)}% of the games file is` +
    ` non-playoff. franchise-wins will be low.`);
}
/* SKIPPED rather than shipped wrong. A race titled "All-time franchise wins"
 * built from a playoffs-only file is not a thin version of the truth, it is a
 * different number wearing the right label - the Lakers show ~500 wins instead
 * of ~3,500 and a reader has no way to tell. One fewer race is a gap; this
 * would be a lie on the page. The playoff race below is still correct and
 * still ships. Point --games at a full schedule and this comes back on its
 * own. */
if (regularSeasonRows > 0) {
  add(buildRace({
    slug: "franchise-wins", group: "Franchises",
    title: "All-time franchise wins", subtitle: "Regular season and playoffs, cumulative",
    unit: "wins", kind: "team", tier: 1, tags: { category: ["franchise", "history"] }
  }, winInc, franchiseEntity));
} else {
  console.log("  franchise-wins            SKIPPED — would be playoff wins under a regular-season title");
}

add(buildRace({
  slug: "franchise-playoff-wins", group: "Franchises",
  title: "All-time franchise playoff wins", subtitle: "Postseason games won, cumulative",
  unit: "wins", kind: "team", tier: 2, tags: { category: ["franchise", "playoffs"] }
}, poWinInc, franchiseEntity));

add(buildRace({
  slug: "franchise-titles", group: "Franchises",
  title: "The championship count", subtitle: "NBA titles, cumulative by season",
  unit: "titles", kind: "team", tier: 1,
  note: "Champion taken as the winner of the last playoff game each season played.",
  tags: { category: ["franchise", "titles"] }
}, [...finalsBySeason.values()], franchiseEntity));

/* ---- countries ---- */

console.log("Countries…");
const natOf = name => { const b = bio.get(name); return b && b.NATIONALITY ? b.NATIONALITY : null; };
const countryEntity = c => ({ n: c, img: null, c: rampColor(c), t: null });

add(buildRace({
  slug: "country-points", group: "Countries",
  title: "Points scored by country", subtitle: "Every NBA point, credited to the scorer's country",
  unit: "pts", kind: "country", tier: 1,
  note: "Country is the nationality listed for the player, not necessarily where they were born.",
  tags: { category: ["international", "country"] }
}, rs.map(r => ({ step: r.YEAR, key: natOf(r.PLAYER), value: num(r.PTS) })), countryEntity));

// One increment per player the first season they appear, so this reads as a
// cumulative count of players a country has ever put in the league.
const debut = new Map();
for (const r of rs) {
  const y = r.YEAR;
  if (!debut.has(r.PLAYER) || y < debut.get(r.PLAYER)) debut.set(r.PLAYER, y);
}
add(buildRace({
  slug: "country-players", group: "Countries",
  title: "NBA players produced, by country", subtitle: "Cumulative count of players who have appeared",
  unit: "players", kind: "country", tier: 2, tags: { category: ["international", "country"] }
}, [...debut].map(([p, y]) => ({ step: y, key: natOf(p), value: 1 })), countryEntity));

const asRows = awards.filter(a => a.AWARD === "All-Star");
add(buildRace({
  slug: "country-allstars", group: "Countries",
  title: "All-Star selections by country", subtitle: "Cumulative All-Star nods",
  unit: "selections", kind: "country", tier: 2, tags: { category: ["international", "awards"] }
}, asRows.map(a => ({ step: a.YEAR, key: natOf(a["PLAYER / COACH"]), value: 1 })), countryEntity));

/* ---- draft classes ---- */

console.log("Draft classes…");
const draftOf = name => {
  const b = bio.get(name);
  const y = b && b.DRAFT ? parseInt(b.DRAFT, 10) : NaN;
  return isNaN(y) ? null : String(y);
};
const classEntity = y => ({ n: "Class of " + y, img: null, c: rampColor("c" + y), t: null });

add(buildRace({
  slug: "class-points", group: "Draft classes",
  title: "Points scored by draft class", subtitle: "Career points, credited to the class that entered together",
  unit: "pts", kind: "class", tier: 1,
  note: "Undrafted players carry no class and are not counted.",
  tags: { category: ["draft", "class"] }
}, rs.map(r => ({ step: r.YEAR, key: draftOf(r.PLAYER), value: num(r.PTS) })), classEntity));

add(buildRace({
  slug: "class-allstars", group: "Draft classes",
  title: "All-Star selections by draft class", subtitle: "Cumulative All-Star nods per class",
  unit: "selections", kind: "class", tier: 2, tags: { category: ["draft", "awards"] }
}, asRows.map(a => ({ step: a.YEAR, key: draftOf(a["PLAYER / COACH"]), value: 1 })), classEntity));

/* ---- generations ---- */

console.log("Generations…");
const genOf = name => {
  const b = bio.get(name);
  if (!b || !b.BIRTHDAY) return null;
  const y = parseInt(String(b.BIRTHDAY).split("/").pop(), 10);
  if (isNaN(y) || y < 1900 || y > 2015) return null;
  return String(Math.floor(y / 10) * 10);
};
const genEntity = d => ({ n: "Born in the " + d + "s", img: null, c: rampColor("g" + d), t: null });

add(buildRace({
  slug: "gen-points", group: "Generations",
  title: "Points scored by birth decade", subtitle: "Every NBA point, credited to the decade the scorer was born in",
  unit: "pts", kind: "gen", tier: 2, tags: { category: ["history", "generations"] }
}, rs.map(r => ({ step: r.YEAR, key: genOf(r.PLAYER), value: num(r.PTS) })), genEntity));

/* ---- colleges and clubs ---- */

// Optional: nba-player-data's bio.json has no college field, but the bio.csv
// that salary-season-finder builds from does — one "COLLEGE / TEAM" column
// covering 5,079 of the 5,105 players in rsStats.
//
// For Americans it holds a college. For international players it holds the pro
// club they came from (Partizan, Mega Basket, Real Madrid, CSKA Moscow), which
// is why these races are titled "college or club" rather than "college". Both
// are the same fact — where a player came from before the NBA — and calling the
// race "colleges" while Mega Basket sits on a bar would just be wrong.
if (BIO_CSV) {
  console.log("Colleges and clubs…");
  const schoolOf = new Map();
  for (const row of parseCsv(fs.readFileSync(BIO_CSV, "utf8"))) {
    const name = (row.PLAYER || "").trim();
    const school = (row["COLLEGE / TEAM"] || "").trim();
    if (name && school) schoolOf.set(name, school);
  }
  const matched = new Set(rs.map(r => r.PLAYER)).size;
  console.log(`  bio.csv: ${schoolOf.size} players carry a college or club`);
  const school = name => schoolOf.get(name) || null;
  const schoolEntity = s => ({ n: s, img: null, c: rampColor("s" + s), t: null });

  add(buildRace({
    slug: "school-points", group: "Colleges & clubs",
    title: "Points scored by college or club",
    subtitle: "Career points, credited to where the player came from",
    unit: "pts", kind: "school", tier: 1,
    note: "American players are credited to their college, international players to the club they left for the NBA.",
    tags: { category: ["college", "origins"] }
  }, rs.map(r => ({ step: r.YEAR, key: school(r.PLAYER), value: num(r.PTS) })), schoolEntity));

  add(buildRace({
    slug: "school-players", group: "Colleges & clubs",
    title: "NBA players produced, by college or club",
    subtitle: "Cumulative count of players who have appeared",
    unit: "players", kind: "school", tier: 2,
    note: "Counted the first season each player appeared in an NBA game.",
    tags: { category: ["college", "origins"] }
  }, [...debut].map(([p, y]) => ({ step: y, key: school(p), value: 1 })), schoolEntity));

  add(buildRace({
    slug: "school-allstars", group: "Colleges & clubs",
    title: "All-Star selections by college or club",
    subtitle: "Cumulative All-Star nods",
    unit: "selections", kind: "school", tier: 2,
    tags: { category: ["college", "awards"] }
  }, asRows.map(a => ({ step: a.YEAR, key: school(a["PLAYER / COACH"]), value: 1 })), schoolEntity));
} else {
  console.log("Colleges and clubs… skipped (pass salary-season-finder/data_sources/bio.csv as the 4th argument)");
}

/* ---- team races: players within one franchise ---- */

/* The franchise races above compare franchises to each other. These compare
 * PLAYERS INSIDE one franchise, which is a different thing entirely and the one
 * people actually argue about: the Lakers all-time scoring list, the Celtics
 * assist list, who has earned the most money in a Bulls jersey.
 *
 * 30 franchises x 6 measures. Rows are filtered by the TEAM column, so a player
 * is credited only for what he did in that uniform — Shaq's Lakers points do not
 * follow him to Miami. Relocations keep the modern abbreviation's history
 * separate (SEA and OKC are different races) because the stats file records the
 * abbreviation of the day, and merging them is a judgement call rather than a
 * fact.
 *
 * Bars carry the franchise colour: it is a Lakers race, so it is purple. The
 * headshots and names are what separate the runners.
 */

console.log("Team races…");
const NICK = new Map();
for (const t of readJson(findInHeadshots("teams", "metadata", "teams.json"))) {
  NICK.set(t.abbrev, t.nickname || t.full_name.split(" ").pop());
}

const TEAM_MEASURES = [
  { key: "PTS", slug: "points",   noun: "scoring leaders",    unit: "pts",   tier: 1 },
  { key: "REB", slug: "rebounds", noun: "rebounding leaders", unit: "reb",   tier: 2 },
  { key: "AST", slug: "assists",  noun: "assist leaders",     unit: "ast",   tier: 2 },
  { key: "3P",  slug: "threes",   noun: "3-point leaders",    unit: "3PM",   tier: 2 },
  { key: "GP",  slug: "games",    noun: "games played",       unit: "games", tier: 3 }
];

// Only franchises with a real body of history get races; a two-season 1940s
// club produces a chart with three bars and nothing to watch.
const teamSeasons = new Map();
for (const r of rs) {
  if (!r.TEAM || r.TEAM === "TOT") continue;
  if (!teamSeasons.has(r.TEAM)) teamSeasons.set(r.TEAM, new Set());
  teamSeasons.get(r.TEAM).add(r.YEAR);
}
const TEAM_ABBREVS = [...teamSeasons.entries()]
  .filter(([ab, yrs]) => yrs.size >= 12 && (TEAM_COLOR[ab] || NICK.has(ab)))
  .map(([ab]) => ab)
  .sort();
console.log(`  ${TEAM_ABBREVS.length} franchises with 12+ seasons of history`);

const teamPlayerEntity = ab => name => {
  const img = faceFor(name);
  const e = { n: name, img, c: TEAM_COLOR[ab] || rampColor(ab), t: ab };
  if (img && !/^data\/races\/faces\//.test(img)) {
    const b = FACES.boxFor(name); if (b) e.b = b;
  } else if (img) {
    e.b = [0, 0, 1, 1];
  }
  return e;
};

const teamLabel = ab => NICK.get(ab) || ab;

for (const ab of TEAM_ABBREVS) {
  const rows = rs.filter(r => r.TEAM === ab);
  const entityFor = teamPlayerEntity(ab);
  for (const m of TEAM_MEASURES) {
    add(buildRace({
      slug: "team-" + ab.toLowerCase() + "-" + m.slug,
      group: "Teams",
      title: teamLabel(ab) + " all-time " + m.noun,
      subtitle: "Regular-season " + m.unit + " in a " + teamLabel(ab) + " uniform, cumulative",
      unit: m.unit, kind: "player", tier: m.tier,
      note: "Counts only what each player did for this franchise.",
      tags: { category: ["team", "franchise"], team: ab }
    }, rows.map(r => ({ step: r.YEAR, key: r.PLAYER, value: num(r[m.key]) })), entityFor));
  }

  // Money earned in this uniform. Watchable in a way the stat races are not:
  // the Lakers list runs Magic -> Worthy -> Shaq -> Kobe -> LeBron.
  add(buildRace({
    slug: "team-" + ab.toLowerCase() + "-earnings",
    group: "Teams",
    title: "Most money earned as a " + teamLabel(ab).replace(/s$/, ""),
    subtitle: "Cumulative salary paid by the franchise, 1991 onward",
    unit: "", fmt: "money", kind: "player", tier: 2,
    note: "Salary data starts in 1991.",
    tags: { category: ["team", "salary"], team: ab }
  }, salaries.filter(x => x.TEAM === ab)
      .map(x => ({ step: x.YEAR, key: x.PLAYER, value: num(x.SALARY) })), entityFor));
}

/* ---- money ---- */

console.log("Money…");
add(buildRace({
  slug: "earnings-by-country", group: "Money",
  title: "NBA earnings by country",
  subtitle: "Every dollar paid, credited to the player's country",
  unit: "", fmt: "money", kind: "country", tier: 1,
  note: "Salary data starts in 1991.",
  tags: { category: ["salary", "international"] }
}, salaries.map(x => ({ step: x.YEAR, key: natOf(x.PLAYER), value: num(x.SALARY) })), countryEntity));

const franchisePayrollEntity = ab => ({
  n: (NICK.get(ab) ? teamLabel(ab) : ab),
  img: logoFor(ab),
  c: TEAM_COLOR[ab] || rampColor(ab),
  t: ab
});
add(buildRace({
  slug: "payroll-by-franchise", group: "Money",
  title: "Total salary paid, by franchise",
  subtitle: "Every dollar a franchise has paid its players, cumulative",
  unit: "", fmt: "money", kind: "team", tier: 1,
  note: "Salary data starts in 1991, so this is not an all-time figure.",
  tags: { category: ["salary", "franchise"] }
}, salaries.filter(x => x.TEAM && x.TEAM !== "TOT")
    .map(x => ({ step: x.YEAR, key: x.TEAM, value: num(x.SALARY) })),
   franchisePayrollEntity));

/* ---- awards ---- */

console.log("Awards…");
function awardRace(spec, match) {
  const rows = awards.filter(a => match(a.AWARD));
  return buildRace(spec, rows.map(a => ({ step: a.YEAR, key: a["PLAYER / COACH"], value: 1 })), playerEntity);
}
add(awardRace({
  slug: "allstar-selections", group: "Awards",
  title: "Most All-Star selections", subtitle: "Cumulative All-Star nods",
  unit: "selections", kind: "player", tier: 1, tags: { category: ["awards", "allstar"] }
}, a => a === "All-Star"));

add(awardRace({
  slug: "allnba-selections", group: "Awards",
  title: "Most All-NBA selections", subtitle: "First, Second and Third Team, cumulative",
  unit: "selections", kind: "player", tier: 1, tags: { category: ["awards", "allnba"] }
}, a => /^All-NBA (First|Second|Third) Team$/.test(a)));

add(awardRace({
  slug: "alldefense-selections", group: "Awards",
  title: "Most All-Defensive selections", subtitle: "First and Second Team, cumulative",
  unit: "selections", kind: "player", tier: 2, tags: { category: ["awards", "defense"] }
}, a => /^All-Defensive (First|Second) Team$/.test(a)));

add(awardRace({
  slug: "player-rings", group: "Awards",
  title: "Most championships won", subtitle: "Rings, cumulative by season",
  unit: "rings", kind: "player", tier: 1, tags: { category: ["awards", "titles"] }
}, a => a === "NBA Champion"));

add(awardRace({
  slug: "scoring-titles", group: "Awards",
  title: "Most scoring titles", subtitle: "Seasons led the league in scoring, cumulative",
  unit: "titles", kind: "player", tier: 2, tags: { category: ["awards", "leaders"] }
}, a => a === "Scoring Leader"));

/* ---------------- write ---------------- */

fs.mkdirSync(OUT_R, { recursive: true });
for (const r of races) {
  fs.writeFileSync(path.join(OUT_R, r.slug + ".json"), JSON.stringify(r));
}

// Card-level tags come off the race itself so the personalization engine can
// learn "this reader likes franchise races but skips country ones", and so a
// race card carries the players and teams it actually shows (review item).
const index = {
  built: new Date().toISOString().slice(0, 10),
  races: races.map(r => {
    const lastFrame = r.f[r.f.length - 1] || [];
    const leaders = lastFrame.slice(0, 5).map(([i]) => r.e[i].n);
    // Teams from the finishing order only. Taking them from every entity that
    // ever charted dragged in defunct 1940s abbreviations (WSC, CHS, PRO) that
    // no reader will ever have a preference about.
    const teams = [...new Set(lastFrame.slice(0, 8).map(([i]) => r.e[i].t).filter(Boolean))];
    return {
      slug: r.slug, group: r.group, title: r.title, subtitle: r.subtitle,
      unit: r.unit, fmt: r.fmt, kind: r.kind, tier: r.tier, note: r.note,
      steps: r.labels.length,
      span: r.labels[0] + "-" + r.labels[r.labels.length - 1],
      leader: leaders[0] || "",
      file: "data/races/r/" + r.slug + ".json",
      tags: {
        category: (r.tags.category || []).slice(),
        players: r.kind === "player" ? leaders : [],
        teams: r.kind === "team" || r.kind === "player" ? teams : []
      }
    };
  })
};
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));

// One feed card per race, in the same shape every other pool uses. Races used
// to be emitted by build_vault.mjs off the MP4 manifest; they are owned here
// now so the tags, the tab and the data file all come from one place.
//
// The tags matter: a race card used to ship with empty players[] and teams[],
// so liking a Curry race taught the engine nothing. Each card now carries the
// entities it actually puts on screen.
const ERA_BY_KIND = { player: "all-time", team: "all-time", country: "all-time", class: "all-time", gen: "all-time", school: "all-time" };
const cards = index.races.map((r, i) => ({
  id: "race-" + r.slug,
  type: "race",
  tab: ["races"],
  tags: {
    content_type: "race",
    players: r.tags.players,
    teams: r.tags.teams,
    era: ERA_BY_KIND[r.kind] || "all-time",
    category: (r.tags.category[0] || "bar-chart-race")
  },
  payload: {
    slug: r.slug, title: r.title, subtitle: r.subtitle, span: r.span,
    group: r.group, unit: r.unit, kind: r.kind, tier: r.tier,
    note: r.note, steps: r.steps, leader: r.leader, file: r.file
  }
}));
fs.writeFileSync(path.join(REPO, "data", "race-pool.json"),
  JSON.stringify({ built: index.built, count: cards.length, cards }, null, 1));

const totalBytes = races.reduce((a, r) => a + Buffer.byteLength(JSON.stringify(r)), 0);
console.log(`\n${races.length} races, ${(totalBytes / 1024).toFixed(0)}KB total (one file loaded at a time).`);

// Headshot coverage, reported every build so a regression in nba-headshots is
// visible rather than silent.
const playerRaces = races.filter(r => r.kind === "player");
let withFace = 0, totalEnt = 0;
for (const r of playerRaces) { for (const e of r.e) { totalEnt++; if (e.img) withFace++; } }
const pct = totalEnt ? Math.round(100 * withFace / totalEnt) : 0;
console.log(`Headshots: ${withFace}/${totalEnt} bar slots across player races (${pct}%). The rest show a bare bar.`);
/* Named, not silent. These are the tiles that only exist because the lookup
 * folds diacritics; before, each of them quietly became a remote URL. If this
 * ever reads 0 against a folder that holds accented filenames, the fold has
 * stopped working and nothing else would say so. */
if (accentHits) console.log(`  ${accentHits} baked from a filename whose accents the race data drops.`);

// What is actually left, so nobody chases the wrong fix. The gap is NOT that
// nba-headshots is missing files — it holds 1,785 face crops. It is that
// player-headshots.json, the only name -> file map in any repo, covers 1,756 of
// the 5,105 players in rsStats and skews recent. Kidd, Havlicek, Unseld, Mikan,
// Wilt and Bill Russell have no entry at all, so there is nothing to look up.
// Closing it means resolving NBA person ids for retired players from an outside
// source, not re-running a fetch.
const named = new Set();
for (const r of playerRaces) for (const e of r.e) named.add(e.n);
const noFace = [...named].filter(n => !FACES.urlFor(n));
if (noFace.length) {
  console.log(`  ${noFace.length} of ${named.size} charting players have no face available.`);
  console.log(`  e.g. ${noFace.slice(0, 8).join(", ")}`);
}
