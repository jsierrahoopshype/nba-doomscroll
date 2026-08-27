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
 * DISJOINT FROM THE VS POOL, ON PURPOSE
 *
 * Every pairing here is one data/vs-pool.json does not hold. The same two
 * careers turning up twice on one scroll — once as a static card, once as an
 * animated one — reads as a bug rather than as variety, and with 573 scoreable
 * players there is no reason to allow it.
 *
 * Reads data/vs-values.json and data/vs-pool.json, both already built by
 * tools/build_data.mjs. No external repo, no network:
 *
 *   node tools/build_compare.mjs
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
const MAX_CARDS = 420;
const MIN_ROWS = 24;          // fewer than this and the reveal is over too fast
const MIN_SCORE = 14;         // both sides need enough points for a real contest
const MAX_PER_PLAYER = 10;
const TARGET_CROSS = 140;     // the rest are same-era arguments

const values = JSON.parse(fs.readFileSync(path.join(REPO, "data", "vs-values.json"), "utf8"));
const vsPool = JSON.parse(fs.readFileSync(path.join(REPO, "data", "vs-pool.json"), "utf8"));

/* Pairings the VS pool already owns, so this one can avoid them. */
const taken = new Set();
for (const c of vsPool.cards) {
  const p = c.tags.players || [];
  if (p.length === 2) taken.add([p[0], p[1]].sort().join("|"));
}
console.log(`vs pool holds ${taken.size} pairings; this build will not reuse any of them`);

const players = Object.keys(values.players)
  .map(n => ({ name: n, ...values.players[n] }))
  .filter(p => Object.keys(p.v).length >= 20);
console.log(`comparison universe: ${players.length} scoreable players with a photo`);

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
      rows.push({ t: "h", label: SECTION_LABEL[s.sec] || s.sec });
      lastSec = s.sec;
    }
    rows.push({
      t: "r",
      cat: s.cat,
      a: s.a === null ? "–" : s.a,
      b: s.b === null ? "–" : s.b,
      w: s.winner === "player1" ? "a" : "b",
      c: s.counts ? 1 : 0
    });
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

while (cards.length < MAX_CARDS && guard++ < 200000) {
  const wantCross = cross < TARGET_CROSS;
  const pool = players.filter(p => count(p.name) < MAX_PER_PLAYER);
  if (pool.length < 2) break;

  const a = pickWeighted(pool, p => p.n);
  const candidates = wantCross
    ? pool.filter(p => p !== a && Math.abs(eraYear(p.era) - eraYear(a.era)) >= 20)
    : pool.filter(p => p !== a && p.era === a.era);
  if (!candidates.length) continue;
  const b = pickWeighted(candidates, p => p.n / (1 + Math.abs(p.n - a.n)));

  const key = [a.name, b.name].sort().join("|");
  if (seen.has(key)) continue;
  if (taken.has(key)) { rejTaken++; seen.add(key); continue; }
  seen.add(key);

  const { rows, score } = buildRows(a.name, b.name);
  const revealed = rows.filter(r => r.t === "r").length;
  if (revealed < MIN_ROWS) { rejThin++; continue; }
  if (Math.min(score.p1, score.p2) < MIN_SCORE) { rejThin++; continue; }
  /* Same competitiveness bar the VS pool uses: a 60-15 rout is not an argument,
   * and it is worse here because you watch it happen for ten seconds. */
  const ratio = Math.min(score.p1, score.p2) / Math.max(score.p1, score.p2);
  if (ratio < (wantCross ? 0.45 : 0.6)) { rejLopsided++; continue; }

  const file = `${slug(a.name)}-vs-${slug(b.name)}.json`;
  fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify({
    a: { name: a.name, img: a.img },
    b: { name: b.name, img: b.img },
    final: { a: score.p1, b: score.p2 },
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
  if (wantCross) cross++;
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
  const counted = f.rows.filter(r => r.t === "r" && r.c);
  const a = counted.filter(r => r.w === "a").length;
  const b = counted.filter(r => r.w === "b").length;
  if (a !== f.final.a || b !== f.final.b) {
    if (bad < 3) console.error(`  ${c.id}: rows total ${a}-${b} but final says ${f.final.a}-${f.final.b}`);
    bad++;
  }
}
if (bad) { console.error(`FAILED: ${bad} cards would end on a score their own rows do not add up to`); process.exit(1); }
console.log(`every card's rows add up to its final score (${cards.length} checked)`);
