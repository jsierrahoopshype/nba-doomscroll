#!/usr/bin/env node
/* NBA Doomscroll — award vote races
 *
 * The last of the five video ports, and the cheapest of them, because it turned
 * out not to need a renderer at all.
 *
 * WHY THERE IS NO NEW PLAYER FOR THIS
 *
 * A media award count IS a bar chart race: candidates on the y axis, points on
 * the x axis, order changing as more of the count comes in. js/race-player.js
 * already draws exactly that, down to the face tiles and the team-coloured
 * bars. So these are written in the race file format, tagged into a new
 * "Award races" group, and the Races tab's group filter picks them up on its
 * own. No renderer, no card type, no change to app.js beyond one pool URL.
 *
 * WHAT THE FRAMES ARE
 *
 * One per ballot. media-vote-tracker's reporter files carry every voter's
 * actual picks and the points each pick is worth, so frame N is the standings
 * after N ballots have been counted. Frame 130 is the real result.
 *
 * THE ORDER IS ARBITRARY, AND THE CARD SAYS SO
 *
 * The export records who voted for whom, not when they filed. Ballots are
 * therefore counted in a seeded shuffle — the same order on every rebuild, but
 * not a real one. Labelling the frames "42/130" rather than naming the reporter
 * who just voted is deliberate: a real name attached to an invented position in
 * a sequence reads as a claim about when that person voted, and it would not be
 * true. The note on every card says the order is random.
 *
 *   node tools/build_ballot_races.mjs --local <media-vote-tracker/docs/data> \
 *     [bar-chart-race/assets/headshots]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { raceFaceTile } from "./lib/png.mjs";
import { buildBcrIndex } from "./lib/faces.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const RACE_DIR = path.join(REPO, "data", "races", "r");
const FACE_DIR = path.join(REPO, "data", "races", "faces");

const args = process.argv.slice(2);
if (args[0] !== "--local" || !args[1]) {
  console.error("usage: node tools/build_ballot_races.mjs --local <mvt/docs/data> [bcr/assets/headshots]");
  process.exit(1);
}
const MVT = args[1];
const BCR = args[2] || null;

const MIN_BALLOTS = 40;
const KEEP = 15;         // rows stored per frame; the player shows 10
const TILE_W = 112, TILE_H = 80;

const AWARD_LABEL = {
  MVP: "MVP", DPOY: "Defensive Player of the Year", ROY: "Rookie of the Year",
  SMOY: "Sixth Man of the Year", MIP: "Most Improved Player",
  COY: "Coach of the Year", CPOY: "Clutch Player of the Year",
  ALL_NBA: "All-NBA", ALL_DEF: "All-Defensive", ALL_ROOKIE: "All-Rookie"
};

const TEAM_COLOR = {
  ATL: "#e03a3e", BOS: "#007a33", BKN: "#1d1d1f", CHA: "#1d1160", CHI: "#ce1141",
  CLE: "#860038", DAL: "#00538c", DEN: "#0e2240", DET: "#1d42ba", GSW: "#1d428a",
  HOU: "#ce1141", IND: "#002d62", LAC: "#c8102e", LAL: "#552583", MEM: "#5d76a9",
  MIA: "#98002e", MIL: "#00471b", MIN: "#0c2340", NOP: "#0c2340", NYK: "#006bb6",
  OKC: "#007ac1", ORL: "#0077c0", PHI: "#006bb6", PHX: "#1d1160", POR: "#e03a3e",
  SAC: "#5a2d81", SAS: "#6b6b70", TOR: "#ce1141", UTA: "#002b5c", WAS: "#002b5c"
};

/* Deterministic everywhere: the shuffle, and therefore the whole race, is the
 * same on every rebuild. */
let seed = 20260827;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function rampColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
  return `hsl(${h % 360} 55% 45%)`;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const slugify = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ---------------- sources ---------------- */

const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
const players = readJson(path.join(MVT, "players.json"));
const teamOf = new Map();
for (const p of (players.players || players)) {
  if (p.player && p.team) teamOf.set(p.player, p.team);
}

/* Every ballot, grouped by the contest it belongs to. */
const contests = new Map();
const repDir = path.join(MVT, "reporter");
let files = 0;
for (const f of fs.readdirSync(repDir)) {
  if (!f.endsWith(".json")) continue;
  files++;
  const r = readJson(path.join(repDir, f));
  for (const b of (r.ballots || [])) {
    if (!b.season || !b.award || !Array.isArray(b.picks) || !b.picks.length) continue;
    const key = b.season + "|" + b.award;
    if (!contests.has(key)) contests.set(key, []);
    contests.get(key).push(b.picks);
  }
}
console.log(`read ${files} reporter files, ${contests.size} season-and-award contests`);

/* ---------------- face tiles ----------------
 *
 * The same landscape tiles the other races use, in the same directory, baked
 * only for candidates that do not already have one. Matching goes through
 * lib/faces.mjs rather than a raw filename lookup, which is what lets
 * "Nikola Jokic" find "Nikola Jokić.png" and refuses to hand Larry Nance his
 * son's photograph. */
const idx = BCR ? buildBcrIndex(BCR, null) : { fileFor: () => null };
const tileCache = new Map();
let baked = 0, reused = 0;

function faceFor(name) {
  if (tileCache.has(name)) return tileCache.get(name);
  const slug = slugify(name);
  const rel = "data/races/faces/" + slug + ".png";
  let out = null;
  if (fs.existsSync(path.join(FACE_DIR, slug + ".png"))) { out = rel; reused++; }
  else {
    const src = idx.fileFor(name);
    if (src) {
      const buf = raceFaceTile(src, TILE_W, TILE_H);
      if (buf) {
        fs.mkdirSync(FACE_DIR, { recursive: true });
        fs.writeFileSync(path.join(FACE_DIR, slug + ".png"), buf);
        out = rel;
        baked++;
      }
    }
  }
  tileCache.set(name, out);
  return out;
}

/* ---------------- races ---------------- */

fs.mkdirSync(RACE_DIR, { recursive: true });
const cards = [];
let skipped = 0;

for (const [key, ballots] of [...contests.entries()].sort()) {
  const [season, award] = key.split("|");
  if (ballots.length < MIN_BALLOTS) { skipped++; continue; }

  const order = shuffle(ballots);
  const totals = new Map();
  const labels = [];
  const frames = [];
  const usedKeys = new Set();

  order.forEach((picks, i) => {
    for (const p of picks) {
      if (!p.player) continue;
      totals.set(p.player, (totals.get(p.player) || 0) + (Number(p.pts) || 0));
    }
    /* Frames are cheap but not free, and a 130-ballot race redrawn 130 times is
     * more steps than a ten-second card can show. Every ballot still counts —
     * they are just recorded every other one once a contest runs long. */
    const stride = order.length > 80 ? 2 : 1;
    if (i % stride !== 0 && i !== order.length - 1) return;

    /* Ties broken by name, not by whichever ballot happened to arrive first:
     * All-Rookie in particular ends with several players on identical totals,
     * and without this the order of the top row changes between rebuilds. */
    const rows = [...totals.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, KEEP);
    rows.forEach(([n]) => usedKeys.add(n));
    labels.push((i + 1) + "/" + order.length);
    frames.push(rows);
  });

  if (labels.length < 6) { skipped++; continue; }

  const keys = [...usedKeys];
  const at = new Map(keys.map((k, i) => [k, i]));
  const entities = keys.map(n => {
    const t = teamOf.get(n) || null;
    return { n: n, img: faceFor(n), c: (t && TEAM_COLOR[t]) || rampColor(n), t: t };
  });

  const slug = `ballot-${award.toLowerCase().replace(/_/g, "")}-${season}`;
  const final = frames[frames.length - 1];
  const leader = final.length ? final[0][0] : "";
  const label = AWARD_LABEL[award] || award;

  fs.writeFileSync(path.join(RACE_DIR, slug + ".json"), JSON.stringify({
    slug,
    group: "Award races",
    /* Drawn by RacePlayer, but not a bar race: one count climbing to a result
     * the reader may already know does not want 65 seconds. js/pacing.js reads
     * this and gives it the ~30s ballot profile instead. RacePlayer also infers
     * it from the group, so files built before this field existed still pace
     * correctly - this makes the intent explicit rather than inferred. */
    pace: "ballot",
    title: `${season} ${label}`,
    subtitle: `${order.length} media ballots, counted one at a time`,
    unit: "pts",
    fmt: "int",
    kind: "player",
    tier: 2,
    note: "Ballots are counted in a random order: the export records who voted " +
          "for whom, not when they filed. The final standing is the real one.",
    tags: { category: ["ballot", award.toLowerCase()] },
    labels,
    e: entities,
    f: frames.map(rows => rows.map(([k, v]) => [at.get(k), v]))
  }));

  cards.push({
    id: "race-" + slug,
    type: "race",
    tab: ["races"],
    tags: {
      content_type: "race",
      players: final.slice(0, 5).map(([n]) => n),
      teams: [...new Set(final.slice(0, 8).map(([n]) => teamOf.get(n)).filter(Boolean))],
      era: season,
      category: "ballot"
    },
    payload: {
      slug,
      title: `${season} ${label}`,
      subtitle: `${order.length} media ballots, counted one at a time`,
      span: season,
      group: "Award races",
      unit: "pts",
      kind: "player",
      tier: 2,
      note: "Ballots counted in a random order — the export records who voted for " +
            "whom, not when. The final standing is the real one.",
      steps: labels.length,
      leader,
      file: "data/races/r/" + slug + ".json"
    }
  });
}

fs.writeFileSync(path.join(REPO, "data", "ballotrace-pool.json"), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  cards
}));

console.log(`award races: ${cards.length} written (${skipped} contests skipped as too small)`);
console.log(`  face tiles: ${baked} newly baked, ${reused} already in data/races/faces`);

/* The whole promise of the card is that the last frame is the real result.
 * Recompute it straight from the ballots and check. */
let bad = 0;
for (const c of cards) {
  const [season, award] = [c.payload.span, c.payload.slug.split("-")[1]];
  const key = [...contests.keys()].find(k =>
    k.startsWith(season + "|") && k.split("|")[1].toLowerCase().replace(/_/g, "") === award);
  const truth = new Map();
  for (const picks of contests.get(key)) {
    for (const p of picks) truth.set(p.player, (truth.get(p.player) || 0) + (Number(p.pts) || 0));
  }
  /* Compare the winning TOTAL and require the race's leader to be one of the
   * players who actually holds it. All-Rookie routinely ends with two or three
   * players on the same number — Porzingis and Towns both finished 2015-16 on
   * 260 — so demanding one particular name would fail on a tie rather than on
   * a mistake. */
  const best = Math.max(...truth.values());
  const holders = [...truth.entries()].filter(([, v]) => v === best).map(([n]) => n);
  const race = JSON.parse(fs.readFileSync(path.join(REPO, c.payload.file), "utf8"));
  const last = race.f[race.f.length - 1];
  const winner = race.e[last[0][0]].n;
  if (last[0][1] !== best || holders.indexOf(winner) < 0) {
    if (bad < 3) console.error(`  ${c.payload.slug}: ends on ${winner} ${last[0][1]}, ` +
      `ballots say ${holders.join(" / ")} ${best}`);
    bad++;
  }
}
if (bad) { console.error(`FAILED: ${bad} races do not end on the real result`); process.exit(1); }
console.log(`every race ends on the result its ballots actually produce (${cards.length} checked)`);
