#!/usr/bin/env node
/* NBA Doomscroll — Teammates Score matchups
 *
 * Ports hh-teammates' "Teammates Score" head-to-head video into feed cards.
 *
 * The idea, which is that repo's and not mine: score the quality of the help a
 * player had, by counting the accolades his TEAMMATES won while playing beside
 * him. An MVP teammate is worth 10, a Finals MVP 10, All-NBA First Team 4, an
 * All-Star 1, and so on down to 0.125 for All-Rookie Second Team. Add it up
 * across a career and "who had it easier" stops being a bar argument and
 * becomes a number.
 *
 * WHY THIS IS BAKED RATHER THAN FETCHED
 *
 * hh-teammates/data/teammates.json is 5.4MB — every player, every season, every
 * decorated teammate. Handing that to a phone to render one card is absurd. So
 * the matchups are assembled here: one small file per matchup (~4-9KB) plus a
 * pool card, the same shape the bar chart races use, loaded only when a card
 * scrolls into view.
 *
 * WHICH MATCHUPS
 *
 * The pairs come from the VS pool this repo already ships, so the two players
 * are ones the feed already thinks are worth comparing — and a reader who sees
 * "Bird vs Magic" on a VS card can meet the same two again arguing about help.
 * Two filters on top: both players need eight seasons (a career-long claim
 * needs a career) and both need to be famous enough for the question to mean
 * anything, measured off nba-player-data's awards file. "James Johnson had
 * better teammates than George McCloud" is a true sentence nobody wants.
 *
 * THE ALIGNMENT
 *
 * Careers are walked by SEASON INDEX, not calendar year — season 1 against
 * season 1 — which is how the video does it and the only way a 1985 rookie and
 * a 2004 rookie can share a screen. When one career runs out the other keeps
 * going alone.
 *
 * Usage:
 *   node tools/build_teammates.mjs --local <hh-teammates/data> <nba-player-data> [bar-chart-race/assets/headshots]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decodePng, resize, crop, encodePng } from "./lib/png.mjs";
import { alphaBox } from "./lib/faces.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

const args = process.argv.slice(2);
if (args[0] !== "--local" || !args[1] || !args[2]) {
  console.error("usage: node tools/build_teammates.mjs --local <hh-teammates/data> <nba-player-data> [bcr/assets/headshots]");
  process.exit(1);
}
const TM_DIR = args[1], PD = args[2], BCR_FACES = args[3] || null;
const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));

/* Jorge: "mostly interested in NBA stars from 1984 onwards", and only players
 * who actually have a headshot. Those two rules do the selecting; the pairing
 * below then uses every combination they allow rather than borrowing the VS
 * pool's 140. */
const MAX_CARDS = 700;
const MIN_SEASONS = 8;
const MIN_FAME = 6;
const FROM_YEAR = 1984;         // career has to reach the modern era
const MAX_PER_PLAYER = 14;      // so one superstar does not eat the pool
const MIN_OVERLAP = 4;          // seasons shared, for an era-mate pairing
const OUT_DIR = path.join(REPO, "data", "teammates");
const FACE_DIR = path.join(OUT_DIR, "faces");
const DISC = 128;                  // square head tile, drawn as a circle
const MIN_SRC_BYTES = 15000;       // below this the source is a CDN silhouette

/* ---------------- inputs ---------------- */

const DB = readJson(path.join(TM_DIR, "teammates.json"));
const SCORES = DB.scores || {};
const PLAYERS = new Map(DB.players.map(p => [p.name, p]));
const LATEST_YEAR = DB.players.reduce(
  (mx, p) => (p.years && p.years.length ? Math.max(mx, p.years[p.years.length - 1]) : mx), 0);

/* Fame, only to keep the question meaningful. Deliberately crude: this decides
 * whether a matchup is worth showing, never what it says. */
const FAME_WEIGHT = {
  "Most Valuable Player": 6, "Finals MVP": 4,
  "All-NBA First Team": 2, "All-NBA Second Team": 2, "All-NBA Third Team": 2,
  "Defensive Player of the Year": 2, "All-Star": 1
};
const fame = new Map();
for (const row of readJson(path.join(PD, "awards.json"))) {
  const name = row["PLAYER / COACH"], w = FAME_WEIGHT[row.AWARD];
  if (!name || !w) continue;
  fame.set(name, (fame.get(name) || 0) + w);
}

/* Names disagree across the two repos: teammates.json says "Nikola Jokic",
 * bar-chart-race ships "Nikola Jokić.png". Matching raw dropped every accented
 * player — Jokic, Doncic, Schroder, Porzingis, Sabonis — so the index is keyed
 * on the folded name. Files under 15KB are the NBA CDN's grey placeholder and
 * are not headshots at all; skipping them here is what makes "only players with
 * a headshot" true rather than approximately true. */
const fold = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const faceFile = new Map();
if (BCR_FACES) {
  for (const f of fs.readdirSync(BCR_FACES)) {
    if (!/\.png$/i.test(f)) continue;
    const full = path.join(BCR_FACES, f);
    try { if (fs.statSync(full).size < MIN_SRC_BYTES) continue; } catch (e) { continue; }
    const key = fold(f.replace(/\.png$/i, ""));
    if (!faceFile.has(key)) faceFile.set(key, full);
  }
}
const sourceFor = name => faceFile.get(fold(name)) || null;

/* ---------------- faces ----------------
 *
 * The scoreboard draws heads in circles, so these are square tiles rather than
 * the races' 1.4:1 landscape ones — and a square cut from a fixed fraction of
 * the source is not good enough. Every file here is 256x256 with the
 * background removed, but the subject sits differently in each: some are
 * framed tight on the head, some are half torso. Cropping the top 78% of all
 * of them gave a head that filled the circle for one player and floated in it
 * for the next, which reads as inconsistent sizing.
 *
 * So the visible pixels are measured (tools/lib/faces.mjs), and the square is
 * placed on the head: as wide as roughly two thirds of the subject's height,
 * centred on the subject horizontally, starting just below the top of the
 * crown. Square in, square out, resized once — the tile is never stretched on
 * either axis, and every head lands at the same size in its circle.
 */
const tileCache = new Map();
const HEAD_BAND = 0.34;   // the top third of a cut-out is the head
const HEAD_PAD = 1.7;     // square side, as a multiple of head width
const MIN_SIDE = 0.5;     // ...but never less than half the subject's height
const CROWN_LIFT = 0.08;  // a little air above the hair

function discFor(name) {
  if (tileCache.has(name)) return tileCache.get(name);
  let out = null;
  const src = sourceFor(name);
  try {
    if (src) {
      const img = decodePng(src);
      const full = img && alphaBox(src);
      if (img) {
        let side, x, y;
        if (full) {
          /* Centre on the HEAD, not on the subject. The cut-out is head and
           * shoulders, so its centre of mass is the chest — cropping a square
           * around that put Jerry West's face half outside the circle. The top
           * third of the subject is measured separately and the square is
           * placed on that, which lands every head at the same size. */
          const fy = full[1], fh = full[3];
          const headBox = alphaBox(src, fy, fy + fh * HEAD_BAND) || full;
          const hx = headBox[0] * img.w, hw = headBox[2] * img.w;
          side = Math.round(Math.min(img.w, img.h,
            Math.max(hw * HEAD_PAD, fh * img.h * MIN_SIDE)));
          x = Math.round(hx + hw / 2 - side / 2);
          y = Math.round(fy * img.h - side * CROWN_LIFT);
        } else {
          side = Math.min(img.w, Math.round(img.h * 0.78));
          x = Math.round((img.w - side) / 2);
          y = 0;
        }
        // Keep the square inside the image. Square in, square out, one resize:
        // the tile is never stretched on either axis.
        x = Math.max(0, Math.min(x, img.w - side));
        y = Math.max(0, Math.min(y, img.h - side));
        const buf = encodePng(resize(crop(img, x, y, side, side), DISC, DISC));
        if (buf) {
          const slug = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
          fs.mkdirSync(FACE_DIR, { recursive: true });
          fs.writeFileSync(path.join(FACE_DIR, slug + ".png"), buf);
          out = "data/teammates/faces/" + slug + ".png";
        }
      }
    }
  } catch (e) { /* unreadable source */ }
  tileCache.set(name, out);
  return out;
}

/* ---------------- the plan ---------------- */

const AWARD_LABEL = {
  "Most Valuable Player": "MVP",
  "Defensive Player of the Year": "DPOY",
  "All-NBA First Team": "All-NBA 1st", "All-NBA Second Team": "All-NBA 2nd",
  "All-NBA Third Team": "All-NBA 3rd",
  "All-Defensive First Team": "All-Def 1st", "All-Defensive Second Team": "All-Def 2nd",
  "All-Rookie First Team": "All-Rookie 1st", "All-Rookie Second Team": "All-Rookie 2nd",
  "Sixth Man of the Year": "6MOY", "Most Improved Player": "MIP",
  "Rookie of the Year": "ROY", "All-Star MVP": "ASG MVP", "All-Star": "All-Star",
  "Finals MVP": "Finals MVP"
};
const shortAward = a => AWARD_LABEL[a] || a;

/* Per-accolade points, from the data where it carries them. A teammate's MVP
 * supersedes his own All-NBA that year and the superseded line scores 0 — that
 * rule lives in the source data as `sp`, and copying it rather than recomputing
 * it is what keeps these numbers identical to the video's. */
function matePoints(mate) {
  let total = 0;
  const awards = [];
  for (let i = 0; i < mate.a.length; i++) {
    const p = (mate.sp && mate.sp[i] != null) ? mate.sp[i] : (SCORES[mate.a[i]] || 0);
    total += p;
    if (p > 0) awards.push(shortAward(mate.a[i]));
  }
  return { total: Math.round(total * 1000) / 1000, awards: awards };
}

// A player can appear twice in one calendar year after a trade; both entries'
// teammates count, or a mid-season move silently drops half his help.
function byYear(p) {
  const m = new Map();
  for (const d of (p.detail || [])) {
    if (!m.has(d.y)) m.set(d.y, []);
    m.get(d.y).push(d);
  }
  return m;
}

function seasonOf(p, byY, n) {
  const year = n <= p.years.length ? p.years[n - 1] : null;
  if (year == null) return null;
  const entries = byY.get(year) || [];
  const mates = [];
  let pts = 0, team = null;
  for (const e of entries) {
    team = team || e.t;
    for (const mate of (e.mates || [])) {
      const mp = matePoints(mate);
      if (!mp.awards.length) continue;
      pts += mp.total;
      mates.push({ n: mate.n, a: mp.awards, p: mp.total });
    }
  }
  mates.sort((x, y) => y.p - x.p);
  return {
    y: year,
    t: team,
    pts: Math.round(pts * 1000) / 1000,
    mates: mates.slice(0, 4)          // four is all the card has room for
  };
}

function buildPlan(a, b) {
  const byA = byYear(a), byB = byYear(b);
  const n = Math.max(a.years.length, b.years.length);
  const steps = [];
  let ca = 0, cb = 0;
  for (let i = 1; i <= n; i++) {
    const sa = seasonOf(a, byA, i), sb = seasonOf(b, byB, i);
    ca += sa ? sa.pts : 0;
    cb += sb ? sb.pts : 0;
    steps.push({
      n: i, a: sa, b: sb,
      ca: Math.round(ca * 1000) / 1000,
      cb: Math.round(cb * 1000) / 1000
    });
  }
  return steps;
}

const slugOf = s => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
const eraOf = year => year >= 2020 ? "2020s" : year >= 2010 ? "2010s" : year >= 2000 ? "2000s"
  : year >= 1990 ? "1990s" : year >= 1980 ? "1980s" : year >= 1970 ? "1970s" : "1960s";

/* ---------------- selection ----------------
 *
 * Every player who clears the bar is paired with every other one, then the
 * list is ordered by how much the matchup is worth showing and cut to
 * MAX_CARDS. "Worth showing" is two things: how famous the pair is, and
 * whether they shared a league. Two men who played the same years arguing
 * about help is a better card than a 1986 forward against a 2019 guard, so
 * overlap is worth more than fame — but the cross-era pairs stay in the pool
 * underneath, because Jordan against LeBron is the argument people actually
 * have.
 */

const candidates = DB.players.filter(p => {
  if (!p.years || !p.years.length) return false;
  if (p.seasons < MIN_SEASONS) return false;
  if (p.years[p.years.length - 1] < FROM_YEAR) return false;   // modern era
  if ((fame.get(p.name) || 0) < MIN_FAME) return false;        // a star
  return !!discFor(p.name);                                    // and a face
});
candidates.sort((a, b) => (fame.get(b.name) || 0) - (fame.get(a.name) || 0));

function overlap(a, b) {
  const lo = Math.max(a.years[0], b.years[0]);
  const hi = Math.min(a.years[a.years.length - 1], b.years[b.years.length - 1]);
  return Math.max(0, hi - lo + 1);
}

const pairs = [];
for (let i = 0; i < candidates.length; i++) {
  for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i], b = candidates[j];
    const ov = overlap(a, b);
    const fa = fame.get(a.name) || 0, fb = fame.get(b.name) || 0;
    // The weaker half of a pair decides how interesting it is: a superstar
    // against a role player is a foregone conclusion whatever the star's fame.
    const worth = Math.min(fa, fb) + (ov >= MIN_OVERLAP ? 25 : 0) + Math.min(ov, 12);
    pairs.push({ a, b, ov, worth });
  }
}
pairs.sort((x, y) => y.worth - x.worth || x.a.name.localeCompare(y.a.name));

const used = new Map();
const chosen = [];
for (const pr of pairs) {
  if (chosen.length >= MAX_CARDS) break;
  const ua = used.get(pr.a.name) || 0, ub = used.get(pr.b.name) || 0;
  if (ua >= MAX_PER_PLAYER || ub >= MAX_PER_PLAYER) continue;
  used.set(pr.a.name, ua + 1);
  used.set(pr.b.name, ub + 1);
  chosen.push({ a: pr.a, b: pr.b, category: pr.ov >= MIN_OVERLAP ? "era" : "cross-era" });
}

console.log(`candidates: ${candidates.length} stars since ${FROM_YEAR} with 8+ seasons and a headshot ` +
  `(${pairs.length} possible pairings)`);

/* ---------------- write ---------------- */

fs.mkdirSync(OUT_DIR, { recursive: true });
const cards = [];
let bytes = 0;

for (const m of chosen) {
  const a = m.a, b = m.b;
  const steps = buildPlan(a, b);
  const slug = slugOf(a.name) + "-vs-" + slugOf(b.name);
  const file = "data/teammates/" + slug + ".json";
  const body = {
    a: { name: a.name, score: a.score, seasons: a.seasons, rings: a.rings,
         first: a.years[0], last: a.years[a.years.length - 1], img: discFor(a.name) },
    b: { name: b.name, score: b.score, seasons: b.seasons, rings: b.rings,
         first: b.years[0], last: b.years[b.years.length - 1], img: discFor(b.name) },
    steps: steps
  };
  const json = JSON.stringify(body);
  fs.writeFileSync(path.join(REPO, file), json);
  bytes += json.length;

  // One decimal on the card. The step data keeps full precision so the
  // animation lands exactly on the printed total.
  const show = v => Math.round(v * 10) / 10;
  const lead = a.score >= b.score ? a : b;
  const trail = lead === a ? b : a;
  const gap = Math.round((lead.score - trail.score) * 10) / 10;
  cards.push({
    id: "mates-" + slug,
    type: "mates",
    tab: ["vs"],
    tags: {
      content_type: "mates",
      players: [a.name, b.name],
      teams: [],
      era: eraOf(Math.max(a.years[0], b.years[0])),
      category: "teammates-" + m.category
    },
    payload: {
      file: file,
      headline: "Who had the better help?",
      a: { name: a.name, img: body.a.img, score: show(a.score), per: show(a.perSeason),
           seasons: a.seasons, rings: a.rings, span: body.a.first + "–" + body.a.last },
      b: { name: b.name, img: body.b.img, score: show(b.score), per: show(b.perSeason),
           seasons: b.seasons, rings: b.rings, span: body.b.first + "–" + body.b.last },
      lead: lead.name,
      gap: gap,
      note: "Teammate accolades, weighted: MVP 10, Finals MVP 10, All-NBA 1st 4, " +
            "All-Star 1, down to 0.125. From HoopsMatic's Teammates Score."
    }
  });
}

fs.writeFileSync(path.join(REPO, "data", "teammates-pool.json"),
  JSON.stringify({ generated: new Date().toISOString().slice(0, 10), cards: cards }));

const faceCount = [...tileCache.values()].filter(Boolean).length;
console.log(`teammates: ${cards.length} matchups, ${Math.round(bytes / 1024)}KB of step files, ` +
  `${faceCount}/${tileCache.size} faces baked`);
const eraPairs = chosen.filter(c => c.category === "era").length;
console.log(`  ${eraPairs} share a league, ${chosen.length - eraPairs} cross-era; ` +
  `${used.size} players appear, at most ${MAX_PER_PLAYER} matchups each`);
