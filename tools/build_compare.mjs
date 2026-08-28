#!/usr/bin/env node
/* NBA Doomscroll — Comparison card builder
 *
 * A port of nba-player-data's nba-comparison-video-generator into the feed, the
 * way tools/build_teammates.mjs ported the Teammates Score video.
 *
 * WHAT MAKES IT A DIFFERENT CARD FROM VS
 *
 * The VS card hands you a finished scoreline: "Wesley Matthews takes it 34-29",
 * four section totals, done. This one shows the scoreline being BUILT — every
 * metric that awards a point lands one at a time, the winner's half of the row
 * flashes, and the running totals climb. Same data, same arithmetic, opposite
 * experience: one is a verdict, the other is the argument.
 *
 * WHERE THE ROWS COME FROM
 *
 * Not from here. js/vs-score.js already decides which side wins every metric —
 * including the untracked-stat guard, the always-award sections and the
 * require-both ones — and tools/build_data.mjs verifies it against the real
 * comparison engine on 120 pairs every build. Re-deriving the rows in this file
 * would mean a second copy of those rules, and two copies drift. So score() got
 * an optional sink argument and this reads what it pushes. The consequence
 * worth stating: the number a card ends on is the number hoopsmatic.com/compare
 * would give you, because it is literally the same function call.
 *
 * WHO IS IN IT
 *
 * All-Stars whose careers reach 1984 or later, who have a real photograph, and
 * whom vs-values.json can score. 201 players, and therefore 20,100 possible
 * pairings — which is the point. The first build drew from all 573 scoreable
 * players and capped each at 10 appearances, and 420 cards off that base meant
 * a rotation full of Adonal Foyle and Tim Thomas. A card that asks "who wins?"
 * needs two names the reader has an opinion about.
 *
 * DISJOINT FROM THE VS POOL, ON PURPOSE
 *
 * Every pairing here is one data/vs-pool.json does not hold. The same two
 * careers turning up twice on one scroll — once as a static card, once as an
 * animated one — reads as a bug rather than as variety.
 *
 * ROWS ARE ARRAYS, NOT OBJECTS
 *
 * [cat, aValue, bValue, winner, counts] rather than a five-key object, and
 * [null, label] for a section header. At 72 rows a card and well over a
 * thousand cards, the repeated JSON keys were about a third of the payload for
 * no information. js/compare-player.js reads this shape directly.
 *
 * Reads data/vs-values.json and data/vs-pool.json from this repo, plus
 * nba-player-data for All-Star counts and career spans:
 *
 *   node tools/build_compare.mjs --local <nba-player-data>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const VsScore = require(path.join(REPO, "js", "vs-score.js"));

const OUT_DIR = path.join(REPO, "data", "compare");
const MAX_CARDS = 1500;
const MIN_ROWS = 24;          // fewer than this and the reveal is over too fast
const MIN_SCORE = 14;         // both sides need enough points for a real contest
const MAX_PER_PLAYER = 22;    // 201 players, so this is what bounds the pool
const TARGET_CROSS = 500;     // the rest are same-era arguments
const FROM_YEAR = 1984;       // the career has to reach the modern era
const MIN_ALLSTAR = 1;

const args = process.argv.slice(2);
if (args[0] !== "--local" || !args[1]) {
  console.error("usage: node tools/build_compare.mjs --local <nba-player-data>");
  process.exit(1);
}
const PD = args[1];

const values = JSON.parse(fs.readFileSync(path.join(REPO, "data", "vs-values.json"), "utf8"));
const vsPool = JSON.parse(fs.readFileSync(path.join(REPO, "data", "vs-pool.json"), "utf8"));

/* Pairings the VS pool already owns, so this one can avoid them. */
const taken = new Set();
for (const c of vsPool.cards) {
  const p = c.tags.players || [];
  if (p.length === 2) taken.add([p[0], p[1]].sort().join("|"));
}
console.log(`vs pool holds ${taken.size} pairings; this build will not reuse any of them`);

/* All-Star selections and career spans, from nba-player-data. awards.json is
 * the selection record; allStar.json is the weekend's dunk and three-point
 * contests, which is a different thing and not what "an All-Star" means. */
const readJson = f => JSON.parse(fs.readFileSync(path.join(PD, f), "utf8"));
const allStar = new Map();
for (const r of readJson("awards.json")) {
  if (r.AWARD !== "All-Star") continue;
  const n = r["PLAYER / COACH"];
  if (n) allStar.set(n, (allStar.get(n) || 0) + 1);
}
const lastYear = new Map();
for (const r of readJson("rsStats.json")) {
  const n = r.PLAYER, y = parseInt(String(r.YEAR || "").slice(0, 4), 10);
  if (!n || !y) continue;
  if (y > (lastYear.get(n) || 0)) lastYear.set(n, y);
}

const scoreable = Object.keys(values.players)
  .map(n => ({ name: n, ...values.players[n] }))
  .filter(p => Object.keys(p.v).length >= 20);
const players = scoreable.filter(p =>
  (allStar.get(p.name) || 0) >= MIN_ALLSTAR && (lastYear.get(p.name) || 0) >= FROM_YEAR);
for (const p of players) p.as = allStar.get(p.name) || 0;
console.log(`comparison universe: ${players.length} All-Stars since ${FROM_YEAR} with a photograph ` +
  `(from ${scoreable.length} scoreable players), ` +
  `${(players.length * (players.length - 1) / 2).toLocaleString()} possible pairings`);

/* Deterministic PRNG, same shape as the other builders: weekly rebuilds shuffle
 * but a given input always produces the same pool. */
let seed = 20260827;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
function pickWeighted(items, weightFn) {
  const w = items.map(weightFn);
  const total = w.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < items.length; i++) { if ((r -= w[i]) <= 0) return items[i]; }
  return items[items.length - 1];
}

function slug(name) {
  return String(name).normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const eraYear = e => parseInt(String(e), 10) || 0;

/* ---------------- section order and labels ----------------
 *
 * comparisons.json order is the order the comparison tool itself uses, and the
 * reveal follows it: accolades first, because that is the argument people came
 * for, then the numbers, then the long tail. Sections are labelled here rather
 * than shouted in the source's ALL CAPS.
 */
const SECTION_LABEL = {
  "ACCOLADES": "Accolades",
  "NBA CAREER AVERAGES": "Career averages",
  "NBA CAREER TOTALS": "Career totals",
  "NBA SEASON PEAK": "Season peaks",
  "PLAYOFF SUCCESS": "Playoffs",
  "SALARIES": "Salaries",
  "DRAFT COMBINE": "Combine",
  "BEST VOTE RANKING": "Best vote finish",
  "BEST AWARDS RANKING": "Best award finish",
  "YEARS RECEIVING VOTES": "Years receiving votes",
  "SIGNATURE SHOES": "Signature shoes",
  "NBA 2K": "NBA 2K rating"
};

/* Every awarded metric is revealed — none are dropped. A card that showed the
 * best 26 rows would end on a scoreline that is not the real one, and the whole
 * value of sharing vs-score.js is that the number at the end is the number the
 * comparison tool gives. The pace absorbs it instead: the player divides a
 * fixed runtime by the row count, so a 31-row pairing and a 103-row pairing
 * both finish in about the same time. */
function buildRows(a, b) {
  const sink = [];
  const r = VsScore.score(values.metrics, values.players[a].v, values.players[b].v, sink);
  const rows = [];
  let lastSec = null;
  for (const s of sink) {
    if (s.sec !== lastSec) {
      rows.push([null, SECTION_LABEL[s.sec] || s.sec]);
      lastSec = s.sec;
    }
    rows.push([
      s.cat,
      s.a === null ? "–" : s.a,
      s.b === null ? "–" : s.b,
      s.winner === "player1" ? 0 : 1,
      s.counts ? 1 : 0
    ]);
  }
  return { rows, score: r };
}

/* ---------------- pool ---------------- */

fs.mkdirSync(OUT_DIR, { recursive: true });

const seen = new Set();
const perPlayer = new Map();
const cards = [];
let cross = 0, guard = 0;
let rejThin = 0, rejLopsided = 0, rejTaken = 0;

const count = n => perPlayer.get(n) || 0;

/* ROUND-ROBIN, NOT A WEIGHTED DRAW.
 *
 * Drawing pairs at random and rejecting the lopsided ones produced exactly the
 * wrong pool: LeBron and Jordan appeared twice each while Bradley Beal appeared
 * twenty-two times. The reason is that the competitiveness gate is a filter on
 * the DRAW, and the best players fail it against almost everybody — so the
 * marquee names, the whole reason to build the card, got rejected out of their
 * own pool while the middle of the distribution filled it.
 *
 * So every player gets a turn instead. Each pass hands one more matchup to each
 * player who has not hit the cap, and their opponent is chosen from players of
 * comparable standing — nearest All-Star count first — which is both what makes
 * a competitive card and what makes a card worth watching. Jordan meets Kareem
 * and LeBron; he does not meet Chris Kaman and get thrown away for it. */
const byAs = players.slice().sort((x, y) => y.as - x.as);
let pass = 0;

outer:
while (cards.length < MAX_CARDS && pass++ < MAX_PER_PLAYER * 2) {
  for (const a of byAs) {
    if (cards.length >= MAX_CARDS) break outer;
    if (count(a.name) >= MAX_PER_PLAYER) continue;
    const wantCross = cross < TARGET_CROSS && (pass % 3 === 0);

    /* Nearest in All-Star standing, then nearest in era for a same-era card or
     * furthest for a cross-era one, with a little jitter so successive rebuilds
     * are not the same bracket every time. */
    const candidates = players
      .filter(p => p !== a && count(p.name) < MAX_PER_PLAYER &&
        !seen.has([a.name, p.name].sort().join("|")) &&
        !taken.has([a.name, p.name].sort().join("|")) &&
        (wantCross
          ? Math.abs(eraYear(p.era) - eraYear(a.era)) >= 20
          : Math.abs(eraYear(p.era) - eraYear(a.era)) <= 10))
      .sort((x, y) =>
        (Math.abs(x.as - a.as) + rand() * 3) - (Math.abs(y.as - a.as) + rand() * 3));
    if (!candidates.length) continue;

    let made = false;
    for (const b of candidates.slice(0, 12)) {
      const key = [a.name, b.name].sort().join("|");
      seen.add(key);
      const { rows, score } = buildRows(a.name, b.name);
      const revealed = rows.filter(r => r[0] !== null).length;
      if (revealed < MIN_ROWS || Math.min(score.p1, score.p2) < MIN_SCORE) { rejThin++; continue; }
      /* A rout is not an argument, and it is worse here than on a static card
       * because you watch it happen for ten seconds. But the bar has to move
       * with who is playing. A flat gate left LeBron James in two cards out of
       * fifteen hundred: he beats everyone, including Jordan, so almost every
       * pairing he appears in reads as lopsided by the numbers. "LeBron beats
       * Kobe 60-30" is a card people want to watch anyway, and the reason is
       * the names. So the more decorated the pair, the more one-sided a result
       * is allowed to be. */
      const ratio = Math.min(score.p1, score.p2) / Math.max(score.p1, score.p2);
      const fameAllowance = Math.min(0.16, (a.as + b.as) / 220);
      if (ratio < (wantCross ? 0.45 : 0.55) - fameAllowance) { rejLopsided++; continue; }
      emit(a, b, rows, score, revealed, wantCross);
      if (wantCross) cross++;
      made = true;
      break;
    }
    if (!made) continue;
  }
}

function emit(a, b, rows, score, revealed, wantCross) {
  const file = `${slug(a.name)}-vs-${slug(b.name)}.json`;
  /* The outro. The video ends on a card naming each man's biggest wins rather
   * than just the scoreline, and VsScore already picks them — the same
   * `biggest_wins` the static VS card prints, by the same rule (largest
   * margin, at most two a side). Baking them here keeps the two cards saying
   * the same thing about the same pair. */
  const wins = {
    a: VsScore.topWins(score.wins.player1, "a"),
    b: VsScore.topWins(score.wins.player2, "b")
  };

  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify({
    a: { name: a.name, img: a.img },
    b: { name: b.name, img: b.img },
    final: { a: score.p1, b: score.p2 },
    wins,
    rows
  }));

  const lead = score.p1 >= score.p2 ? a.name : b.name;
  cards.push({
    id: `compare-${cards.length + 1}`,
    type: "compare",
    tab: ["vs"],
    tags: {
      content_type: "compare",
      players: [a.name, b.name],
      teams: [a.team, b.team].filter(Boolean),
      era: wantCross ? "all-time" : a.era,
      category: wantCross ? "cross-era" : "comparison"
    },
    payload: {
      a: { name: a.name, img: a.img, team: a.team, score: score.p1 },
      b: { name: b.name, img: b.img, team: b.team, score: score.p2 },
      headline: `${lead} takes it ${Math.max(score.p1, score.p2)}-${Math.min(score.p1, score.p2)}`,
      metrics: revealed,
      file: "data/compare/" + file,
      note: "Scored exactly the way hoopsmatic.com/compare scores it.",
      compare_url: "https://hoopsmatic.com/compare?p1=" + encodeURIComponent(a.name) +
                   "&p2=" + encodeURIComponent(b.name)
    }
  });

  perPlayer.set(a.name, count(a.name) + 1);
  perPlayer.set(b.name, count(b.name) + 1);
}

const out = path.join(REPO, "data", "compare-pool.json");
fs.writeFileSync(out, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  cards
}));

const bytes = fs.readdirSync(OUT_DIR)
  .reduce((t, f) => t + fs.statSync(path.join(OUT_DIR, f)).size, 0);
const rowsTotal = cards.reduce((t, c) => t + c.payload.metrics, 0);

console.log(`comparison: ${cards.length} matchups (${cards.length - cross} same-era, ${cross} cross-era)`);
console.log(`  ${Math.round(rowsTotal / cards.length)} metrics per card on average, ` +
  `${(bytes / 1024).toFixed(0)}KB of row files, ${perPlayer.size} players appear`);
console.log(`  rejected: ${rejTaken} already in the VS pool, ${rejThin} too thin, ${rejLopsided} lopsided`);

/* The promise this card makes is that its final score is the comparison tool's
 * score. Check it rather than trust it. */
let bad = 0;
for (const c of cards) {
  const f = JSON.parse(fs.readFileSync(path.join(REPO, c.payload.file), "utf8"));
  const counted = f.rows.filter(r => r[0] !== null && r[4]);
  const a = counted.filter(r => r[3] === 0).length;
  const b = counted.filter(r => r[3] === 1).length;
  if (a !== f.final.a || b !== f.final.b) {
    if (bad < 3) console.error(`  ${c.id}: rows total ${a}-${b} but final says ${f.final.a}-${f.final.b}`);
    bad++;
  }
}
if (bad) { console.error(`FAILED: ${bad} cards would end on a score their own rows do not add up to`); process.exit(1); }
console.log(`every card's rows add up to its final score (${cards.length} checked)`);
