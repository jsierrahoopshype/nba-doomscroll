#!/usr/bin/env node
/* NBA Doomscroll — data pool builder (step 3: VS + Quiz)
 *
 * Builds the real card pools from public jsierrahoopshype data:
 *   data/vs-pool.json      ~2,000 curated matchups, scored with the exact
 *                          comparison-tool logic (js/compare-core.js)
 *   data/vs-values.json    per-player metric values so the browser can score
 *                          a random matchup live without the 27MB dataset
 *   data/quiz-pool.json    guess-the-player entries (headshot players only)
 *   data/trivia-pool.json  "two players, one stat" cards with real values
 *   data/ballot-pool.json  ballot trivia from the media-vote-tracker export
 *
 * Sources, by mode:
 *   node tools/build_data.mjs --local <playerDataDir> <headshotsMetaDir> <mvtDataDir>
 *   node tools/build_data.mjs --pages     (fetch everything from GitHub Pages;
 *                                          used by the weekly Actions refresh)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const CompareCore = require(path.join(REPO, "js", "compare-core.js"));
const VsScore = require(path.join(REPO, "js", "vs-score.js"));
import * as Faces from "./lib/faces.mjs";
import * as Png from "./lib/png.mjs";

const PAGES_PLAYER_DATA = "https://jsierrahoopshype.github.io/nba-player-data/";
const PAGES_HEADSHOTS = "https://jsierrahoopshype.github.io/nba-headshots/";
const PAGES_MVT = "https://jsierrahoopshype.github.io/media-vote-tracker/";
const HEADSHOT_BASE = PAGES_HEADSHOTS + "players/headshots/face/";
const SILHOUETTE = PAGES_HEADSHOTS + "fallbacks/player_silhouette.svg";

/* deterministic PRNG so weekly rebuilds shuffle but runs are reproducible */
let seed = 20260810;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pickWeighted(items, weightFn) {
  const w = items.map(weightFn);
  const total = w.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) { if ((r -= w[i]) <= 0) return items[i]; }
  return items[items.length - 1];
}

/* ---------------- source loading ---------------- */

const args = process.argv.slice(2);
const mode = args[0] || "--pages";

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} -> ${r.status}`);
  return r.json();
}

async function loadSources() {
  const files = ["awards", "allStar", "awardVotes", "nba2k", "poSeries", "poStats",
    "rsStats", "salaries", "sneakers", "comparisons", "bio"];
  const db = {};
  if (mode === "--local") {
    const [pd, hs, mvt, bcr] = args.slice(1);
    db.bcrFaces = bcr || null;
    for (const f of files) db[f] = JSON.parse(fs.readFileSync(path.join(pd, f + ".json"), "utf8"));
    db.combine = JSON.parse(fs.readFileSync(path.join(pd, "combine-v3.json"), "utf8"));
    db.headMap = JSON.parse(fs.readFileSync(path.join(pd, "player-headshots.json"), "utf8"));
    db.headMeta = JSON.parse(fs.readFileSync(path.join(hs, "players.json"), "utf8"));
    db.mvtMeta = JSON.parse(fs.readFileSync(path.join(mvt, "meta.json"), "utf8"));
    db.mvtReporters = JSON.parse(fs.readFileSync(path.join(mvt, "reporters.json"), "utf8"));
    db.mvtReporterFile = slug => JSON.parse(fs.readFileSync(path.join(mvt, "reporter", slug + ".json"), "utf8"));
  } else {
    for (const f of files) db[f] = await fetchJson(PAGES_PLAYER_DATA + f + ".json");
    db.combine = await fetchJson(PAGES_PLAYER_DATA + "combine-v3.json");
    db.headMap = await fetchJson(PAGES_PLAYER_DATA + "player-headshots.json");
    db.headMeta = await fetchJson(PAGES_HEADSHOTS + "players/metadata/players.json");
    db.mvtMeta = await fetchJson(PAGES_MVT + "data/meta.json");
    db.mvtReporters = await fetchJson(PAGES_MVT + "data/reporters.json");
    db.mvtReporterFile = slug => fetchJson(PAGES_MVT + "data/reporter/" + slug + ".json");
  }
  return db;
}

/* ---------------- faces ----------------
 *
 * WHY THE POOLS USED TO SHIP SILHOUETTES
 *
 * The universe's `img` came from nba-headshots' players.json, which describes
 * 572 faces. The pools between them need 1,084 players, and nothing stopped a
 * card being built from two of the other 512 — so 1,885 of 2,000 VS cards and
 * 294 of 300 trivia cards carried at least one grey outline.
 *
 * Two halves to the fix, in the order Jorge put them: expand the source, then
 * scrap what it still cannot cover.
 *
 * EXPAND. bar-chart-race ships 6,769 name-keyed PNGs, 3,462 of which are real
 * photographs rather than the CDN's grey placeholder. On these pools it is a
 * strict superset of nba-headshots — every one of the 572 that a pool needs is
 * in there too, plus 306 more — so it replaces it outright rather than joining
 * it. tools/lib/faces.mjs does the name matching and documents the traps.
 *
 * Those files are 256x256 background-removed cut-outs, not face crops: the head
 * is about 46% of the width and sits differently in every one. Dropped into a
 * 3.2rem disc they read as a tiny head floating in a circle. So a square tile is
 * baked per player, framed on the measured head the way the Teammates scoreboard
 * frames its own, at 96px — the largest a card draws one is 3.2rem, about 51
 * CSS px, so this still has pixels in hand on a 2x screen at a third of the
 * bytes 256px would cost.
 *
 * SCRAP. `hasHead` then gates pool membership, and vs-values with it, so the
 * live random matchup cannot put on screen what the pool no longer can. A card
 * needing a player with no photograph is not built at all, and the build fails
 * outright if a silhouette makes it into a VS or trivia card. 1,231 of the
 * 3,463 players in the universe have a photograph, and the pools use 1,078 of
 * them — deeper than the 572 the old source could reach.
 *
 * WHY A MANIFEST
 *
 * Only --local can bake, because it needs the 277MB source repo. The weekly
 * Action runs --pages and commits what it builds, so without a record of which
 * players have a tile it would cheerfully rebuild the pools unrestricted and
 * undo this every Monday. data/faces/index.json is that record: written by the
 * local bake, committed alongside the tiles, and read by BOTH modes. --pages
 * therefore keeps the restriction without ever seeing a PNG.
 */

const FACE_DIR = path.join(REPO, "data", "faces");
const FACE_INDEX = path.join(FACE_DIR, "index.json");
const FACE_PX = 96;                        // .face.lg is 3.2rem ≈ 51px CSS
const FACE_URL = "data/faces/";

function faceSlug(name) {
  return String(name).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/* Which names have a photograph, and what its tile would be called. Cheap —
 * it reads the directory listing, never a PNG — so the pools can be gated on
 * it before anything is encoded. --pages has no source directory and reads the
 * committed manifest instead.
 *
 * @returns {{ faces:object|null, source:object|null }} faces maps name -> tile
 */
function resolveFaces(db, names) {
  if (!db.bcrFaces) {
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(FACE_INDEX, "utf8")); } catch (e) { /* none */ }
    if (manifest && manifest.faces) {
      console.log(`faces: reusing the committed manifest, ${Object.keys(manifest.faces).length} players ` +
        `(no bar-chart-race directory given, so nothing is re-baked)`);
      return { faces: manifest.faces, source: null };
    }
    console.log("faces: NO manifest and no source directory — pools will NOT be " +
      "restricted to players with a photo, and silhouettes will come back. " +
      "Run --local with the bar-chart-race headshots path to bake them.");
    return { faces: null, source: null };
  }

  const idx = Faces.buildBcrIndex(db.bcrFaces, db.headMap);
  const faces = {};
  const source = {};
  const takenBy = new Map();
  for (const name of names) {
    const src = idx.fileFor(name);
    if (!src) continue;
    let slug = faceSlug(name);
    /* Two different players must never share a tile filename. */
    if (takenBy.has(slug) && takenBy.get(slug) !== name) {
      let n = 2;
      while (takenBy.has(slug + "-" + n)) n++;
      slug = slug + "-" + n;
    }
    takenBy.set(slug, name);
    faces[name] = slug + ".png";
    source[name] = src;
  }
  console.log(`faces: ${Object.keys(faces).length} of ${names.length} players have a photograph ` +
    `(${idx.stats.suffixGuarded} lookups refused as father/son suffix mismatches)`);
  return { faces, source };
}

/* Encodes a tile for every player in the universe with a photograph, not only
 * the ones the finished pools happen to name.
 *
 * Baking just the pool players was 1.4MB smaller and wrong: trade cards are
 * built from whatever readers traded, which is current players, and the pools
 * are built on career notability, which is not. So Michael Porter Jr. drew a
 * silhouette on a trade card while sitting in the source repo with a photo.
 * Anyone the universe does not hold at all — a rookie 20 games into a career —
 * still falls back to the remote nba-headshots map in js/trades.js, and to
 * initials after that.
 *
 * The manifest it writes is the other half of the job: --pages cannot see the
 * source repo, so without a committed record of who has a tile the weekly
 * Action would rebuild the pools unrestricted and undo this every Monday. */
function bakeFaces(resolved, used) {
  if (!resolved.source) return;
  fs.mkdirSync(FACE_DIR, { recursive: true });
  const faces = {};
  let baked = 0, reused = 0, failed = 0, bytes = 0;

  for (const name of used) {
    const tile = resolved.faces[name];
    if (!tile) continue;
    const outFile = path.join(FACE_DIR, tile);
    if (fs.existsSync(outFile)) { reused++; }
    else {
      const png = Faces.headTile(resolved.source[name], FACE_PX, Png);
      if (!png) { failed++; continue; }
      fs.writeFileSync(outFile, png);
      baked++;
    }
    bytes += fs.statSync(outFile).size;
    faces[name] = tile;
  }

  /* Tiles for players no longer in any pool are left on disk: deleting files is
   * not this builder's job, and a stale tile costs bytes rather than
   * correctness. The manifest is what the site is gated on. */
  fs.writeFileSync(FACE_INDEX, JSON.stringify({
    generated: new Date().toISOString().slice(0, 10),
    px: FACE_PX,
    source: "bar-chart-race/assets/headshots",
    faces
  }));
  console.log(`faces: ${Object.keys(faces).length} tiles in play, ${(bytes / 1048576).toFixed(1)} MB ` +
    `(${baked} newly baked, ${reused} already on disk, ${failed} failed to decode)`);
}

/* ---------------- player universe ---------------- */

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function buildUniverse(db, faces) {
  const agg = new Map(); // name -> aggregates
  for (const row of db.rsStats) {
    const n = row.PLAYER;
    if (!n) continue;
    let a = agg.get(n);
    if (!a) { a = { name: n, gp: 0, pts: 0, min: 0, reb: 0, ast: 0, stl: 0, blk: 0, tp: 0, first: 9999, last: 0, lastTeam: "" }; agg.set(n, a); }
    a.gp += num(row.GP); a.pts += num(row.PTS); a.min += num(row.MIN);
    a.reb += num(row.REB); a.ast += num(row.AST); a.stl += num(row.STL);
    a.blk += num(row.BLK); a.tp += num(row["3P"]);
    const y = parseInt(row.YEAR, 10);
    if (y) { if (y < a.first) a.first = y; if (y >= a.last) { a.last = y; if (row.TEAM && row.TEAM !== "TOT") a.lastTeam = row.TEAM; } }
  }
  const allStarCount = new Map();
  for (const row of db.awards) {
    if (row.AWARD === "All-Star") {
      const n = row["PLAYER / COACH"];
      allStarCount.set(n, (allStarCount.get(n) || 0) + 1);
    }
  }
  const posByName = new Map(db.bio.map(b => [b.PLAYER, (b.POS || "").trim()]));

  // AUTHORITATIVE headshot map: nba-headshots players.json metadata only.
  // player-headshots.json in nba-player-data lists 1,756 names but only ~572
  // face PNGs actually exist, so trusting it produces cards whose image 404s
  // into the generic silhouette (and an unanswerable Guess the Player).
  // Exact full_name matches ONLY. The name map also collides across
  // generations — it points "Larry Nance" (the father, 1981-94) at Larry
  // Nance Jr.'s face — which would put the wrong player on a Guess the
  // Player card, so it is not used as a fallback.
  const fileByName = new Map();
  for (const p of (db.headMeta.players || [])) {
    if (p.headshot && p.headshot.face && p.headshot.filename) {
      fileByName.set(p.full_name, p.headshot.filename);
    }
  }

  const players = [];
  for (const a of agg.values()) {
    const mid = Math.round((a.first + a.last) / 2);
    const era = `${mid - (mid % 10)}s`;
    const pos = posByName.get(a.name) || "";
    const posGroup = pos[0] === "G" ? "G" : pos[0] === "C" ? "C" : pos[0] === "F" ? "F" : "?";
    const allStar = allStarCount.get(a.name) || 0;
    const headFile = fileByName.get(a.name) || null;
    /* A baked tile wins: it is the wider source AND the better framing. The
     * nba-headshots URL stays as the fallback for a run with no manifest, so
     * a builder without the faces still produces the pools it always did. */
    const tile = faces && faces[a.name];
    players.push({
      name: a.name, era, pos: posGroup, gp: a.gp, pts: a.pts, min: a.min,
      reb: a.reb, ast: a.ast, stl: a.stl, blk: a.blk, tp: a.tp,
      first: a.first, last: a.last, team: a.lastTeam,
      allStar,
      img: tile ? FACE_URL + tile : (headFile ? HEADSHOT_BASE + headFile : SILHOUETTE),
      hasHead: faces ? !!tile : !!headFile,
      notability: allStar * 12 + a.pts / 1000 + a.gp / 200
    });
  }
  return players.filter(p => p.gp >= 50);
}

/* ---------------- vs pool ---------------- */

/* Section labels, headline-metric list and the biggest-wins picker now live
 * in js/vs-score.js so the builder and the browser share one implementation. */

function vsCard(u1, u2, r, idx, kind) {
  return {
    id: `vs-${idx}`,
    type: "vs",
    tab: ["vs"],
    tags: {
      content_type: "vs",
      players: [u1.name, u2.name],
      teams: [u1.team, u2.team].filter(Boolean),
      era: kind === "cross" ? "all-time" : u1.era,
      category: kind === "cross" ? "cross-era" : "comparison"
    },
    payload: VsScore.payload(u1.name, u2.name, u1, u2, r)
  };
}

function buildVsPool(universe, values) {
  const byName = new Map(universe.map(p => [p.name, p]));
  /* hasHead is a hard gate, not a preference: a VS card is two faces and a
   * scoreline, and a card with a grey outline on one side is not the card. */
  const notable = Object.keys(values.players)
    .map(n => byName.get(n))
    .filter(p => p && p.hasHead && Object.keys(values.players[p.name].v).length >= 20);
  console.log(`vs pool universe: ${notable.length} scoreable players with a photo`);

  const scoreOf = (a, b) => VsScore.score(values.metrics, values.players[a.name].v, values.players[b.name].v);

  const seen = new Set();
  const cards = [];
  let idx = 0;
  const TARGET_SAME = 1000, TARGET_CROSS = 1000;
  let same = 0, cross = 0, guard = 0, rejected = 0;

  while (cards.length < TARGET_SAME + TARGET_CROSS && guard++ < 400000) {
    const wantCross = cross < TARGET_CROSS && (same >= TARGET_SAME || guard % 2 === 0);
    const a = pickWeighted(notable, p => p.notability);
    let candidates;
    if (!wantCross) {
      candidates = notable.filter(p => p !== a && p.era === a.era && p.pos === a.pos && p.pos !== "?");
      if (candidates.length < 3) candidates = notable.filter(p => p !== a && p.era === a.era);
    } else {
      candidates = notable.filter(p => p !== a && Math.abs(p.first - a.first) >= 20);
    }
    if (!candidates.length) continue;
    // Favour opponents of similar caliber — pairing purely by notability made
    // 43% of the pool blowouts, and a 60-15 rout is a boring card.
    const b = pickWeighted(candidates, p => p.notability / (1 + Math.abs(p.notability - a.notability)));
    const key = [a.name, b.name].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);

    const r = scoreOf(a, b);
    if (r.p1 + r.p2 < 20) continue; // data too thin for a good card
    // Competitiveness gate: same-era pairs should be real arguments, cross-era
    // chaos pairs get a looser bar since the mismatch is the joke.
    const ratio = Math.max(r.p1, r.p2) ? Math.min(r.p1, r.p2) / Math.max(r.p1, r.p2) : 0;
    if (ratio < (wantCross ? 0.4 : 0.55)) { rejected++; continue; }

    cards.push(vsCard(a, b, r, ++idx, wantCross ? "cross" : "same"));
    if (wantCross) cross++; else same++;
  }
  console.log(`vs pool: ${cards.length} cards (${same} same-era, ${cross} cross-era), ${rejected} rejected as lopsided`);
  return cards;
}

/* Fail the build if the fast scorer ever drifts from the real comparison
 * engine — the cards must match what hoopsmatic.com/compare would say. */
function verifyScorer(universe, values, sampleSize = 120) {
  const names = Object.keys(values.players);
  let checked = 0;
  const mismatches = [];
  for (let i = 0; i < sampleSize * 4 && checked < sampleSize; i++) {
    const a = names[Math.floor(rand() * names.length)];
    const b = names[Math.floor(rand() * names.length)];
    if (a === b) continue;
    checked++;
    const fast = VsScore.score(values.metrics, values.players[a].v, values.players[b].v);
    const real = CompareCore.compare(a, b);
    if (fast.p1 !== real.player1Score || fast.p2 !== real.player2Score) {
      mismatches.push(`${a} vs ${b}: fast ${fast.p1}-${fast.p2}, engine ${real.player1Score}-${real.player2Score}`);
    }
  }
  if (mismatches.length) {
    console.error(`SCORER MISMATCH on ${mismatches.length}/${checked} pairs:`);
    mismatches.slice(0, 5).forEach(m => console.error("  " + m));
    process.exit(1);
  }
  console.log(`scorer parity verified on ${checked} random pairs`);
}

/* ---------------- vs values (live random matchup) ---------------- */

function buildVsValues(db, universe) {
  // metric list in comparisons.json order, with section context
  const metrics = [];
  let section = null;
  for (const row of db.comparisons) {
    const cat = row["Comparison points"], win = row["Who wins?"], src = row["Wheres the data?"];
    if (!win && !src) { section = cat; continue; }
    if (!section || !cat) continue;
    metrics.push({ sec: section, cat, win, src });
  }
  const players = {};
  /* Photographed players only, for the same reason the pool is gated: the
   * browser draws a live random matchup from this file, and an ungated file
   * would put a silhouette on screen by a route the pool no longer can.
   * Taking 900 from the photographed players keeps the live matchup as deep
   * as it was. */
  const top = universe.filter(p => p.notability >= 6 && p.hasHead)
    .sort((a, b) => b.notability - a.notability).slice(0, 900);
  for (const p of top) {
    const vals = {};
    metrics.forEach((m, i) => {
      const v = CompareCore.getPlayerStat(p.name, m.cat, m.src);
      if (v !== null && v !== undefined) vals[i] = v;
    });
    // n = notability, so the browser's random matchup can favour players
    // people have actually heard of instead of drawing two role players.
    players[p.name] = { v: vals, img: p.img, team: p.team, era: p.era, n: Math.round(p.notability) };
  }
  return { generated: new Date().toISOString().slice(0, 10), metrics, players };
}

/* ---------------- quiz pool ---------------- */

function buildQuizPool(universe) {
  const withHead = universe.filter(p => p.hasHead && p.gp >= 100);
  function tier(p) {
    if (p.allStar >= 2 || p.pts >= 15000) return "easy";
    if (p.allStar >= 1 || p.pts >= 7000 || p.min >= 14000) return "medium";
    return "hard";
  }
  const byTier = { easy: [], medium: [], hard: [] };
  withHead.forEach(p => byTier[tier(p)].push(p));
  console.log(`quiz pool: ${withHead.length} players (easy ${byTier.easy.length} / medium ${byTier.medium.length} / hard ${byTier.hard.length})`);
  const cards = withHead.map((p, i) => {
    const t = tier(p);
    // distractors: same position first, same tier, never the player
    const sameTier = byTier[t].filter(x => x !== p);
    const samePos = sameTier.filter(x => x.pos === p.pos && x.pos !== "?");
    const dpool = samePos.length >= 3 ? samePos : sameTier;
    const distractors = [];
    const used = new Set([p.name]);
    let guard = 0;
    while (distractors.length < 3 && guard++ < 200) {
      const d = dpool[Math.floor(rand() * dpool.length)];
      if (!used.has(d.name)) { used.add(d.name); distractors.push(d.name); }
    }
    const options = [...distractors, p.name];
    // deterministic shuffle
    for (let j = options.length - 1; j > 0; j--) {
      const k = Math.floor(rand() * (j + 1)); [options[j], options[k]] = [options[k], options[j]];
    }
    return {
      id: `quiz-${i + 1}`,
      type: "quiz",
      tab: ["quiz"],
      tags: { content_type: "quiz", players: [p.name], teams: p.team ? [p.team] : [], era: p.era, category: "guess-the-player" },
      payload: {
        img: p.img, options, answer: p.name, difficulty: t,
        hints: quizHints(p),
        // kept so an older cached card still renders something
        hint: p.team ? `Last seen on ${p.team}` : `${p.first}-${p.last}`
      }
    };
  });
  return cards;
}

const POS_WORD = { G: "guard", F: "forward", C: "center" };

/* Three hints, vague to specific, revealed one at a time in the card. A single
 * hint was either useless or gave the answer away; the staircase lets someone
 * take the shot early and still have a route if they miss. */
function quizHints(p) {
  const n = v => Number(v || 0).toLocaleString("en-US");
  const pos = POS_WORD[p.pos] || "player";
  const career = p.first === p.last ? `played one season, in ${p.first}` : `played from ${p.first} to ${p.last}`;
  const two = p.allStar >= 1
    ? `${p.allStar}-time All-Star. ${n(p.pts)} career points.`
    : `${n(p.pts)} career points in ${n(p.gp)} games, and never an All-Star.`;
  const parts = p.name.split(" ");
  const inits = parts.length > 1 ? parts[0][0] + "." + parts[parts.length - 1][0] + "." : parts[0][0] + ".";
  const three = (p.team ? `Last played for ${p.team}. ` : "") + `Initials ${inits}`;
  return [`A ${pos} who ${career}.`, two, three];
}

/* ---------------- trivia pool ---------------- */

/* [key, label, minBothPlayers, minCareerStartYear]
 * The minimums keep out questions that are technically true but junk —
 * "who has more 3PM, Karl Malone (85) or Ben Simmons (5)" — and the start
 * years keep out stats the league did not track for that player's whole
 * career (steals/blocks from 1973-74, the 3-point line from 1979-80). */
const TRIVIA_STATS = [
  ["pts", "points", 4000, 0],
  ["reb", "rebounds", 2000, 0],
  ["ast", "assists", 1500, 0],
  ["stl", "steals", 600, 1974],
  ["blk", "blocks", 400, 1974],
  ["tp", "3-pointers made", 500, 1980],
  ["gp", "games", 400, 0]
];

function buildTriviaPool(universe) {
  /* Same gate as VS: the two options ARE two faces, so a silhouette is not a
   * blemish here, it is half the question missing. Taking 260 from the
   * photographed players rather than from everyone keeps the pool the same
   * size without letting a grey outline back in. */
  const pool = universe.filter(p => p.notability >= 10 && p.hasHead)
    .sort((a, b) => b.notability - a.notability).slice(0, 260);
  const cards = [];
  const seen = new Set();
  let guard = 0;
  while (cards.length < 300 && guard++ < 20000) {
    const a = pool[Math.floor(rand() * pool.length)];
    const b = pool[Math.floor(rand() * pool.length)];
    if (a === b) continue;
    const [key, label, minVal, minYear] = TRIVIA_STATS[Math.floor(rand() * TRIVIA_STATS.length)];
    const pairKey = [a.name, b.name].sort().join("|") + key;
    if (seen.has(pairKey)) continue;
    const va = a[key], vb = b[key];
    if (!va || !vb) continue;
    if (va < minVal || vb < minVal) continue;          // both must be real volume scorers of this stat
    if (minYear && (a.first < minYear || b.first < minYear)) continue;  // untracked-era guard
    const ratio = Math.max(va, vb) / Math.min(va, vb);
    if (ratio < 1.08 || ratio > 4) continue; // too close to be fair, or a blowout nobody misses
    seen.add(pairKey);
    cards.push({
      id: `trivia-${cards.length + 1}`,
      type: "trivia",
      // Quiz, not VS. VS is "here are two careers, read the comparison";
      // trivia is "pick one and find out if you were right". The second thing
      // is what the Quiz tab is for.
      tab: ["quiz"],
      tags: { content_type: "trivia", players: [a.name, b.name], teams: [a.team, b.team].filter(Boolean), era: a.era === b.era ? a.era : "all-time", category: "trivia" },
      payload: {
        stat: label, question: `Who has more career ${label}?`,
        a: { name: a.name, img: a.img, value: va },
        b: { name: b.name, img: b.img, value: vb },
        answer: va >= vb ? "a" : "b"
      }
    });
  }
  return cards;
}

/* ---------------- ballot pool ---------------- */

const AWARD_LABEL = {
  MVP: "MVP", DPOY: "Defensive Player of the Year", ROY: "Rookie of the Year",
  SMOY: "Sixth Man", MIP: "Most Improved", COY: "Coach of the Year",
  CPOY: "Clutch Player", ALL_NBA: "All-NBA", ALL_DEF: "All-Defensive", ALL_ROOKIE: "All-Rookie"
};

/* Season strings are "2022-23". Both ends are needed to ask whether a player
 * was even in the league that year. */
function seasonYears(season) {
  const start = parseInt(String(season).slice(0, 4), 10);
  return { start, end: start + 1 };
}

async function buildBallotPool(db, universe) {
  // Candidates for the "who got no votes at all" format. The bar is an
  // All-Star career, not a long one: filtering on notability alone let a
  // 15-year journeyman be the answer to "who drew no MVP votes", which gives
  // the question away on sight for the wrong reason. Requiring real All-Star
  // pedigree makes the shut-out actually surprising.
  const notable = universe.filter(p => p.allStar >= 2 && p.notability >= 25);
  // Aggregate every reporter's ballots into award+season standings
  const slugs = (db.mvtReporters.reporters || db.mvtReporters || []).map(r => r.slug || r);
  const standings = new Map(); // award|season -> Map(player -> {pts, firsts})
  let loaded = 0;
  for (const slug of slugs) {
    let rf;
    try { rf = await db.mvtReporterFile(slug); } catch (e) { continue; }
    loaded++;
    for (const b of rf.ballots || []) {
      const key = b.award + "|" + b.season;
      if (!standings.has(key)) standings.set(key, new Map());
      const m = standings.get(key);
      for (const pick of b.picks || []) {
        if (!m.has(pick.player)) m.set(pick.player, { pts: 0, firsts: 0 });
        const e = m.get(pick.player);
        e.pts += num(pick.pts);
        if (String(pick.slot) === "1") e.firsts++;
      }
    }
  }
  console.log(`ballot aggregates: ${loaded} reporters, ${standings.size} award-seasons`);

  const cards = [];
  const SOLO_AWARDS = ["MVP", "DPOY", "ROY", "SMOY", "MIP", "CPOY"];
  for (const [key, m] of standings) {
    const [award, season] = key.split("|");
    if (!SOLO_AWARDS.includes(award)) continue;
    const rows = [...m.entries()].map(([player, e]) => ({ player, ...e })).sort((a, b) => b.pts - a.pts);
    if (rows.length < 4) continue;

    const label = AWARD_LABEL[award];
    // award_key / subjects let the browser drop a Quiz question that asks about
    // the same award-season-player a Vault oddity card already states outright.
    const meta = subjects => ({
      content_type: "ballot", players: subjects, teams: [],
      era: seasonEra(season), category: "ballot-trivia"
    });
    const add = (subjects, payload) => cards.push({
      id: `ballot-${cards.length + 1}`, type: "ballot", tab: ["quiz"],
      tags: meta(subjects),
      payload: { season, award_key: award, subjects, ...payload }
    });

    // T1: who finished higher in the voting (winner vs a lower finisher)
    const hi = rows[0];
    const lo = rows[Math.min(rows.length - 1, 2 + Math.floor(rand() * 3))];
    if (hi && lo && hi.player !== lo.player) {
      const pair = rand() < 0.5 ? [hi, lo] : [lo, hi];
      add([hi.player, lo.player], {
        question: `Who finished higher in the ${season} ${label} voting?`,
        options: [pair[0].player, pair[1].player],
        answer_idx: pair[0].pts >= pair[1].pts ? 0 : 1,
        detail: `${hi.player} led with ${hi.pts} points; ${lo.player} had ${lo.pts}.`
      });
    }

    // T2: the podium. Replaces "how many first-place votes did X get in 2019",
    // which was arithmetic nobody carries around — you either looked it up or
    // you guessed. Where a player finished is something a fan actually argues
    // about.
    if (rows.length >= 5) {
      const truth = rows[1];
      const field = rows.slice(2, 7).filter(r => r.player !== truth.player);
      if (field.length >= 3) {
        const picks = [truth];
        const used = new Set([truth.player]);
        let g2 = 0;
        while (picks.length < 4 && g2++ < 60) {
          const c = field[Math.floor(rand() * field.length)];
          if (!used.has(c.player)) { used.add(c.player); picks.push(c); }
        }
        if (picks.length === 4) {
          for (let j = picks.length - 1; j > 0; j--) {
            const k = Math.floor(rand() * (j + 1)); [picks[j], picks[k]] = [picks[k], picks[j]];
          }
          add([truth.player], {
            question: `${hi.player} won ${label} in ${season}. Who finished second?`,
            options: picks.map(r => r.player),
            answer_idx: picks.findIndex(r => r.player === truth.player),
            detail: `${truth.player} was runner-up with ${truth.pts} points, behind ${hi.player}'s ${hi.pts}.`
          });
        }
      }
    }

    // T3: the one who drew nothing. Three players who got votes plus one who
    // was in the league, was good enough to be worth naming, and got shut out.
    //
    // MVP and DPOY only. Every award-eligible player in the league is in the
    // running for those two, so a shut-out is a real finding. On the gated
    // awards the question answers itself: "which of these drew no Rookie of
    // the Year votes in 2016-17" with DeMarcus Cousins in the options is not
    // trivia, it is a reminder that he was in his seventh season. Sixth Man
    // has the same problem with any starter.
    if (rows.length >= 4 && (award === "MVP" || award === "DPOY")) {
      const { start, end } = seasonYears(season);
      const voted = new Set(rows.map(r => r.player));
      // Present for the whole season and past their first two years — a rookie
      // drawing no MVP votes is not a fact worth asking about.
      const shutOut = notable.filter(p =>
        p.first + 2 <= start && p.last >= end && !voted.has(p.name));
      if (shutOut.length) {
        const zero = shutOut[Math.floor(rand() * shutOut.length)];
        const got = [];
        const used = new Set();
        let g3 = 0;
        while (got.length < 3 && g3++ < 60) {
          const c = rows[Math.floor(rand() * Math.min(rows.length, 8))];
          if (!used.has(c.player)) { used.add(c.player); got.push(c.player); }
        }
        if (got.length === 3) {
          const options = got.concat(zero.name);
          for (let j = options.length - 1; j > 0; j--) {
            const k = Math.floor(rand() * (j + 1)); [options[j], options[k]] = [options[k], options[j]];
          }
          add([zero.name], {
            question: `Which of these drew no ${label} votes at all in ${season}?`,
            options, answer_idx: options.indexOf(zero.name),
            detail: `${zero.name} was not on a single tracked ${label} ballot that season. ` +
                    `The other three all received votes.`
          });
        }
      }
    }
  }
  // deterministic shuffle, cap
  for (let j = cards.length - 1; j > 0; j--) {
    const k = Math.floor(rand() * (j + 1)); [cards[j], cards[k]] = [cards[k], cards[j]];
  }
  return cards.slice(0, 160).map((c, i) => ({ ...c, id: `ballot-${i + 1}` }));
}

function seasonEra(season) {
  const y = parseInt(season, 10);
  return isNaN(y) ? "2010s" : `${y - (y % 10)}s`;
}

/* ---------------- main ---------------- */

const db = await loadSources();
CompareCore.init({
  awards: db.awards, allStar: db.allStar, awardVotes: db.awardVotes, combine: db.combine,
  nba2k: db.nba2k, poSeries: db.poSeries, poStats: db.poStats, rsStats: db.rsStats,
  salaries: db.salaries, sneakers: db.sneakers, comparisons: db.comparisons
});

/* Two passes over the universe: the first only to learn who is in it, so the
 * face bake can be asked for exactly those names rather than all 6,769. */
const roster = buildUniverse(db, null).map(p => p.name);
const resolved = resolveFaces(db, roster);

const universe = buildUniverse(db, resolved.faces);
console.log(`universe: ${universe.length} players (50+ games), ` +
  `${universe.filter(p => p.hasHead).length} with a photograph`);

const out = (name, obj) => {
  const p = path.join(REPO, "data", name);
  fs.writeFileSync(p, JSON.stringify(obj));
  console.log(`wrote ${name}: ${(fs.statSync(p).size / 1024).toFixed(0)} KB`);
};

// values first: the pool scorer reads them, and the parity check needs both
const vsValues = buildVsValues(db, universe);
out("vs-values.json", vsValues);
verifyScorer(universe, vsValues);

const vsPool = buildVsPool(universe, vsValues);
out("vs-pool.json", { generated: new Date().toISOString().slice(0, 10), cards: vsPool });

const quizPool = buildQuizPool(universe);
out("quiz-pool.json", { generated: new Date().toISOString().slice(0, 10), cards: quizPool });
const triviaPool = buildTriviaPool(universe);
out("trivia-pool.json", { generated: new Date().toISOString().slice(0, 10), cards: triviaPool });

const ballot = await buildBallotPool(db, universe);
out("ballot-pool.json", { generated: new Date().toISOString().slice(0, 10), cards: ballot });

bakeFaces(resolved, resolved.faces ? Object.keys(resolved.faces) : []);

/* The one thing that must never be true again. */
const silhouettes = [...vsPool, ...triviaPool].filter(c =>
  JSON.stringify(c.payload).includes("player_silhouette"));
if (silhouettes.length) {
  console.error(`FAILED: ${silhouettes.length} cards still carry a silhouette, ` +
    `e.g. ${silhouettes[0].id}`);
  process.exit(1);
}
console.log(`no silhouettes in ${vsPool.length + triviaPool.length} VS and trivia cards`);

console.log("done");
