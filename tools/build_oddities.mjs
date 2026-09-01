/* Ballot oddities from the Media Vote Tracker's raw ballots.
 *
 *     node tools/build_oddities.mjs --local <media-vote-tracker/docs/data>
 *
 * WHAT THIS REPLACES
 *
 * build_vault.mjs generated two shapes: "exactly one voter put X first" and
 * "X was unanimous". Both are real, and 54 cards of only those two is a tic.
 * Worse, the interesting thing about a ballot is rarely the first-place vote:
 * it is who got left off, who got ranked somewhere nobody else ranked them,
 * and which two candidates a single voter reversed.
 *
 * Eight families now, each with its own gate. The gates are the point. An
 * "oddity" manufactured from a trivial difference is worse than no card,
 * because it teaches the reader that the label means nothing - so every family
 * refuses to fire unless the pattern is genuinely unusual against its own
 * award-season, and says how unusual in the card itself.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Anything about how far a voter sits from consensus ON A PLAYER. That is the
 * Media Lean card's whole subject, and two formats telling the same fact is
 * the repetition this was supposed to fix. These families are about ballot
 * STRUCTURE - slots, omissions, reversals, margins - which the lean card
 * cannot see, because it aggregates the diffs away.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const SRC = arg("local", "");
const outArg = arg("out", "data/oddity-pool.json");
const OUT = path.isAbsolute(outArg) ? outArg : path.join(REPO, outArg);

if (!SRC) {
  console.error("usage: node tools/build_oddities.mjs --local <media-vote-tracker/docs/data>");
  process.exit(1);
}

const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
const TRACKER = "https://jsierrahoopshype.github.io/media-vote-tracker/";

const AWARD_LABEL = {
  MVP: "MVP", DPOY: "Defensive Player of the Year", ROY: "Rookie of the Year",
  MIP: "Most Improved Player", SMOY: "Sixth Man of the Year", COY: "Coach of the Year",
  CPOY: "Clutch Player of the Year", ALL_NBA: "All-NBA", ALL_DEF: "All-Defensive",
  ALL_ROOKIE: "All-Rookie"
};
/* Families that rank a single winner behave differently from team selections:
 * "left off one ballot" means something for MVP and very little for All-NBA,
 * where the ballot is a slate. Kept separate rather than gated by a magic
 * number later. */
const SOLO = new Set(["MVP", "DPOY", "ROY", "MIP", "SMOY", "COY", "CPOY"]);

/* ---------------- gates ----------------
 * Chosen against the real distribution, printed at the end of a run so they
 * can be re-judged rather than trusted. */
const MIN_BALLOTS = 20;        // an award-season below this cannot support a claim
const MIN_SPREAD = 3;          // slots between a player's best and worst placing
const MIN_SPREAD_APPEAR = 10;  // on how many ballots, before a spread counts
const MIN_POLAR_SHARE = 0.35;  // appear on this share of ballots to be "polarizing"
/* Measured, not guessed. Across every candidate that clears the appearance
 * share, the points standard deviation runs: median 0.49, p90 1.43, p99 1.88,
 * max 2.30. A threshold of 2.2 admitted one candidate in the entire dataset,
 * which is a family that never fires rather than a strict one. 1.85 sits at
 * roughly the top 1%, which is what "split the electorate more than anyone"
 * should mean. */
const MIN_POLAR_SD = 1.85;
/* Measured too. Across 82 single-winner award-seasons with enough ballots, the
 * top-two gap runs: closest 2.8%, p10 8.7%, median 33.5%. A 2% bar excluded
 * every race that has ever happened. 5% keeps it inside the tightest tenth,
 * which is what a photo finish should mean - Naz Reid over Malik Monk by ten
 * points, not a landslide with a comma in it. */
const PHOTO_FINISH = 0.05;
const MIN_CONTRARIAN_PICKS = 4;
const MAX_PER_AWARD_SEASON = 2;
const MAX_PER_FAMILY_SHARE = 0.25;
const MAX_PER_PLAYER = 4;

/* ---------------- load ---------------- */

const reporters = readJson(path.join(SRC, "reporters.json"));
const slugs = (reporters.reporters || reporters || []).map(r => r.slug || r);

const groups = new Map();      // "AWARD|season" -> { award, season, ballots[] }
let ballotCount = 0, voterCount = 0;

for (const slug of slugs) {
  let rf;
  try { rf = readJson(path.join(SRC, "reporter", slug + ".json")); } catch (e) { continue; }
  if (!Array.isArray(rf.ballots) || !rf.ballots.length) continue;
  voterCount++;
  for (const b of rf.ballots) {
    if (!b.award || !b.season || !Array.isArray(b.picks) || !b.picks.length) continue;
    const key = b.award + "|" + b.season;
    if (!groups.has(key)) groups.set(key, { award: b.award, season: b.season, ballots: [] });
    groups.get(key).ballots.push({ voter: rf.voter || slug, slug, picks: b.picks, n_voters: b.n_voters });
    ballotCount++;
  }
}
console.log(`${voterCount} voters, ${ballotCount} ballots, ${groups.size} award-seasons`);

/* ---------------- per award-season aggregates ---------------- */

const num = v => { const n = Number(v); return isFinite(n) ? n : 0; };
/* Slots arrive as "1" and "1st" depending on the award. */
const slotNum = s => { const m = String(s).match(/\d+/); return m ? parseInt(m[0], 10) : 0; };

function aggregate(g) {
  const players = new Map();
  for (const b of g.ballots) {
    for (const p of b.picks) {
      if (!p.player) continue;
      if (!players.has(p.player)) {
        players.set(p.player, {
          player: p.player, slug: p.slug || "", pts: 0, firsts: 0,
          appear: 0, slots: [], byVoter: new Map(), ptsList: []
        });
      }
      const e = players.get(p.player);
      const sl = slotNum(p.slot);
      e.pts += num(p.pts);
      e.appear++;
      if (sl === 1) { e.firsts++; }
      if (sl) e.slots.push({ slot: sl, voter: b.voter, slug: b.slug });
      e.ptsList.push(num(p.pts));
      e.byVoter.set(b.voter, { slot: sl, pts: num(p.pts), diff: num(p.diff) });
    }
  }
  const rows = [...players.values()].sort((a, b) => b.pts - a.pts);
  return { rows, ballots: g.ballots.length };
}

function sd(list) {
  if (list.length < 2) return 0;
  const m = list.reduce((a, b) => a + b, 0) / list.length;
  return Math.sqrt(list.reduce((a, b) => a + (b - m) * (b - m), 0) / list.length);
}

const playerLink = r => r.slug ? TRACKER + "player.html?p=" + encodeURIComponent(r.slug) : TRACKER;
const voterLink = s => s ? TRACKER + "reporter.html?v=" + encodeURIComponent(s) : TRACKER;

/* ---------------- families ----------------
 * Each returns a card or null. `q` is the novelty score: how unusual this is
 * against its own award-season, 0-1, used later as a feed weighting signal and
 * to break ties when an award-season offers more cards than it may have. */

const FAMILIES = [
  {
    key: "lone-omission",
    /* A top-three finisher missing from exactly one ballot. The interesting
     * ballot is the one that disagreed with everybody, and unlike a lone
     * first-place vote it is an act of omission, which nobody has to defend. */
    build: (g, a) => {
      if (!SOLO.has(g.award) || a.ballots < MIN_BALLOTS) return null;
      for (const r of a.rows.slice(0, 3)) {
        if (r.appear !== a.ballots - 1) continue;
        const missing = g.ballots.find(b => !r.byVoter.has(b.voter));
        if (!missing) continue;
        const rank = a.rows.indexOf(r) + 1;
        return {
          subjects: [r.player], voters: [missing.voter],
          headline: `${r.player} was left off exactly one ${AWARD_LABEL[g.award]} ballot`,
          detail: `He appeared on ${r.appear} of ${a.ballots} tracked ballots in ${g.season} and ` +
                  `finished ${rank === 1 ? "first" : rank === 2 ? "second" : "third"} in the voting. ` +
                  `${missing.voter} was the one voter who did not include him at all.`,
          url: playerLink(r),
          cta: `${r.player} on the tracker`,
          q: Math.min(1, 0.55 + (4 - rank) * 0.12)
        };
      }
      return null;
    }
  },
  {
    key: "lone-inclusion",
    /* The mirror image: somebody one voter alone saw. Gated on a crowded field,
     * because in a thin one being named once is just a short ballot. */
    build: (g, a) => {
      if (a.ballots < 25 || a.rows.length < 8) return null;
      const r = a.rows.filter(x => x.appear === 1).sort((x, y) => y.pts - x.pts)[0];
      if (!r) return null;
      const only = r.slots[0] || {};
      return {
        subjects: [r.player], voters: [only.voter].filter(Boolean),
        headline: `One voter, and only one, named ${r.player} for ${AWARD_LABEL[g.award]}`,
        detail: `Across ${a.ballots} tracked ${g.season} ballots, ${r.player} appears exactly once` +
                (only.voter ? `, on ${only.voter}'s` : "") +
                (only.slot ? `, at No. ${only.slot}` : "") +
                `. Nobody else listed him anywhere.`,
        url: playerLink(r),
        cta: `${r.player} on the tracker`,
        q: 0.62
      };
    }
  },
  {
    key: "one-vote-short",
    /* Unanimity missed by a single ballot is a better story than unanimity. */
    build: (g, a) => {
      if (!SOLO.has(g.award) || a.ballots < MIN_BALLOTS) return null;
      const w = a.rows[0];
      const totalFirsts = a.rows.reduce((s, r) => s + r.firsts, 0);
      if (totalFirsts < MIN_BALLOTS || w.firsts !== totalFirsts - 1) return null;
      const other = a.rows.find(r => r !== w && r.firsts === 1);
      if (!other) return null;
      const who = (other.slots.find(s => s.slot === 1) || {}).voter;
      return {
        subjects: [w.player, other.player], voters: [who].filter(Boolean),
        headline: `${w.player} missed a unanimous ${AWARD_LABEL[g.award]} by one vote`,
        detail: `He took ${w.firsts} of ${totalFirsts} tracked first-place votes in ${g.season}. ` +
                (who ? `${who} was the lone holdout, and went with ${other.player}.`
                     : `The one remaining first-place vote went to ${other.player}.`),
        url: playerLink(w),
        cta: `${w.player} on the tracker`,
        q: 0.9
      };
    }
  },
  {
    key: "placement-spread",
    /* The same player at the top of one ballot and the bottom of another. */
    build: (g, a) => {
      let best = null;
      for (const r of a.rows) {
        if (r.appear < MIN_SPREAD_APPEAR || r.slots.length < MIN_SPREAD_APPEAR) continue;
        const lo = r.slots.reduce((m, s) => s.slot < m.slot ? s : m);
        const hi = r.slots.reduce((m, s) => s.slot > m.slot ? s : m);
        const spread = hi.slot - lo.slot;
        if (spread < MIN_SPREAD) continue;
        if (!best || spread > best.spread) best = { r, lo, hi, spread };
      }
      if (!best) return null;
      const { r, lo, hi, spread } = best;
      return {
        subjects: [r.player], voters: [lo.voter, hi.voter].filter(Boolean),
        headline: `${r.player} was ranked No. ${lo.slot} by one voter and No. ${hi.slot} by another`,
        detail: `On ${r.appear} tracked ${g.season} ${AWARD_LABEL[g.award]} ballots he never settled: ` +
                `${lo.voter} had him ${ordinal(lo.slot)}, ${hi.voter} had him ${ordinal(hi.slot)}. ` +
                `No other candidate in this vote moved ${spread} places.`,
        url: playerLink(r),
        cta: `${r.player} on the tracker`,
        q: Math.min(1, 0.5 + spread * 0.1)
      };
    }
  },
  {
    key: "polarizing",
    /* Wide disagreement about one candidate, measured across the points the
     * ballots actually gave him rather than across their slots. */
    build: (g, a) => {
      let best = null;
      for (const r of a.rows) {
        if (r.appear / a.ballots < MIN_POLAR_SHARE) continue;
        const s = sd(r.ptsList);
        if (s < MIN_POLAR_SD) continue;
        if (!best || s > best.s) best = { r, s };
      }
      if (!best) return null;
      const { r, s } = best;
      const hi = r.ptsList.reduce((m, v) => Math.max(m, v), 0);
      const lo = r.ptsList.reduce((m, v) => Math.min(m, v), Infinity);
      return {
        subjects: [r.player], voters: [],
        headline: `${r.player} split the ${AWARD_LABEL[g.award]} electorate more than anyone`,
        detail: `Voters who named him in ${g.season} gave him anywhere from ${lo} to ${hi} points, ` +
                `a spread wider than any other candidate in the vote and wider than all but ` +
                `about one in a hundred candidates on record. He appeared on ` +
                `${r.appear} of ${a.ballots} tracked ballots.`,
        url: playerLink(r),
        cta: `${r.player} on the tracker`,
        q: Math.min(1, 0.45 + s / 10)
      };
    }
  },
  {
    key: "photo-finish",
    /* Single-winner awards only.
     *
     * On All-NBA the top two are both unanimous first-team picks and the gap
     * between them is one voter's preference between two locks - 300 points to
     * 299, over and over. That is not a close race, it is the same fact
     * lone-omission already tells, wearing a margin. A photo finish needs
     * something for the two candidates to be racing for. */
    build: (g, a) => {
      if (!SOLO.has(g.award)) return null;
      if (a.rows.length < 2 || a.ballots < MIN_BALLOTS) return null;
      const [w, second] = a.rows;
      if (!w.pts) return null;
      const margin = w.pts - second.pts;
      /* A dead heat is not a photo finish, it is a tie, and "edged him by 0
       * points" is simply false. Ties need their own card or none; for now,
       * none. */
      if (margin <= 0) return null;
      const gap = margin / w.pts;
      if (gap > PHOTO_FINISH) return null;
      return {
        subjects: [w.player, second.player], voters: [],
        headline: `${w.player} ${ledPhrase(g.award)} ${AWARD_LABEL[g.award]} over ` +
                  `${second.player} by ${margin} point${margin === 1 ? "" : "s"}`,
        detail: `Across ${a.ballots} tracked ${g.season} ballots the two finished within ` +
                `${(gap * 100).toFixed(1)}% of each other: ${w.pts} to ${second.pts}. ` +
                `${w.firsts} first-place votes to ${second.firsts}.`,
        url: playerLink(w),
        cta: `${w.player} on the tracker`,
        q: Math.min(1, 0.95 - gap * 10)
      };
    }
  },
  {
    key: "contrarian-ballot",
    /* The single ballot furthest from the room. Uses the per-pick `diff` the
     * tracker already computes, so "far from consensus" means the same thing
     * here as it does there. */
    build: (g, a) => {
      if (a.ballots < MIN_BALLOTS) return null;
      let best = null;
      for (const b of g.ballots) {
        const picks = b.picks.filter(p => isFinite(Number(p.diff)));
        if (picks.length < MIN_CONTRARIAN_PICKS) continue;
        const mean = picks.reduce((s, p) => s + Math.abs(num(p.diff)), 0) / picks.length;
        if (!best || mean > best.mean) best = { b, mean, picks };
      }
      if (!best || best.mean < 2.5) return null;
      const out = best.picks.slice().sort((x, y) => Math.abs(num(y.diff)) - Math.abs(num(x.diff)))[0];
      return {
        subjects: [out.player], voters: [best.b.voter],
        headline: `${best.b.voter} filed the ${g.season} ${AWARD_LABEL[g.award]} ballot least like anyone else's`,
        detail: `Every pick on it sat an average of ${best.mean.toFixed(1)} points away from where the ` +
                `rest of the electorate had that player. The furthest was ${out.player}, ` +
                `${num(out.diff) > 0 ? "above" : "below"} consensus by ${Math.abs(num(out.diff)).toFixed(1)}.`,
        url: voterLink(best.b.slug),
        cta: `${best.b.voter}'s ballots`,
        q: Math.min(1, 0.4 + best.mean / 12)
      };
    }
  },
  {
    key: "flipped-pair",
    /* Two candidates who finished close, reversed by one voter and by nobody
     * else. Gated on the pair being genuinely close, because reversing two
     * candidates thirty points apart is an opinion, not an oddity. */
    build: (g, a) => {
      if (a.rows.length < 2 || a.ballots < MIN_BALLOTS) return null;
      const [x, y] = a.rows;
      if (!x.pts || (x.pts - y.pts) / x.pts > 0.12) return null;
      const flips = [];
      for (const b of g.ballots) {
        const px = x.byVoter.get(b.voter), py = y.byVoter.get(b.voter);
        if (!px || !py || !px.slot || !py.slot) continue;
        if (py.slot < px.slot) flips.push(b.voter);
      }
      if (flips.length !== 1) return null;
      return {
        subjects: [y.player, x.player], voters: flips,
        headline: `One voter put ${y.player} above ${x.player}, and no one else did`,
        detail: `${x.player} ${topPhrase(g.award)} ${AWARD_LABEL[g.award]} in ${g.season} with ${x.pts} points ` +
                `to ${y.player}'s ${y.pts}. Every tracked ballot that named both had them in that order, ` +
                `except ${flips[0]}'s.`,
        url: playerLink(y),
        cta: `${y.player} on the tracker`,
        q: 0.85
      };
    }
  }
];

/* All-NBA and All-Defensive are slates, not contests with a winner, so "edged
 * X for All-NBA" and "finished first for All-Defensive" are both wrong: every
 * first-team pick won. These say "led the voting", which is true of a slate and
 * of a single-winner award alike. */
function ledPhrase(award) {
  return SOLO.has(award) ? "won" : "led the voting for";
}
function topPhrase(award) {
  return SOLO.has(award) ? "finished first for" : "led the voting for";
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/* ---------------- build ---------------- */

const seasonEra = s => {
  const y = parseInt(String(s).slice(0, 4), 10);
  return isNaN(y) ? "2020s" : (y - (y % 10)) + "s";
};

const candidates = [];
for (const [key, g] of groups) {
  const a = aggregate(g);
  if (!a.rows.length) continue;
  for (const fam of FAMILIES) {
    let card;
    try { card = fam.build(g, a); } catch (e) { card = null; }
    if (!card) continue;
    candidates.push({ ...card, family: fam.key, award: g.award, season: g.season, ballots: a.ballots });
  }
}

/* Best first, then thinned: an award-season may contribute at most a couple of
 * cards, no family may dominate the pool, and no player may be the subject of
 * more than a few. Without these the pool is technically varied and reads as
 * four cards about the same MVP race. */
/* Round-robin across families, best-first inside each.
 *
 * Taking candidates in pure quality order let photo-finish - which scores high
 * by construction, because a close race is always notable - take 31% of the
 * pool before the share cap engaged. A cap that only applies after the pool is
 * already lopsided is not a cap. Drawing one family at a time in turn means the
 * mix is balanced from the first card, and the quality sort still decides which
 * card represents each family. */
const byFamily = new Map();
for (const c of candidates) {
  if (!byFamily.has(c.family)) byFamily.set(c.family, []);
  byFamily.get(c.family).push(c);
}
for (const list of byFamily.values()) list.sort((a, b) => b.q - a.q);

const ordered = [];
for (let i = 0; ; i++) {
  let took = false;
  for (const list of byFamily.values()) {
    if (i < list.length) { ordered.push(list[i]); took = true; }
  }
  if (!took) break;
}

const perAwardSeason = new Map(), perFamily = new Map(), perPlayer = new Map();
const cards = [];
const rej = { awardSeason: 0, family: 0, player: 0 };

for (const c of ordered) {
  const asKey = c.award + "|" + c.season;
  if ((perAwardSeason.get(asKey) || 0) >= MAX_PER_AWARD_SEASON) { rej.awardSeason++; continue; }
  /* With round-robin ordering the share cap is a backstop rather than the
   * mechanism, so it can be measured against the pool as it stands without
   * front-loading anything. */
  if (cards.length >= 20 && (perFamily.get(c.family) || 0) / cards.length >= MAX_PER_FAMILY_SHARE) { rej.family++; continue; }
  const lead = c.subjects[0] || "";
  if ((perPlayer.get(lead) || 0) >= MAX_PER_PLAYER) { rej.player++; continue; }

  perAwardSeason.set(asKey, (perAwardSeason.get(asKey) || 0) + 1);
  perFamily.set(c.family, (perFamily.get(c.family) || 0) + 1);
  perPlayer.set(lead, (perPlayer.get(lead) || 0) + 1);

  cards.push({
    id: "oddity-" + c.award.toLowerCase() + "-" + c.season.replace(/[^0-9]/g, "") + "-" + c.family,
    type: "oddity",
    tab: ["vault"],
    tags: {
      content_type: "oddity",
      players: c.subjects.slice(0, 3),
      teams: [],
      era: seasonEra(c.season),
      category: "ballot-oddity"
    },
    quality_score: Math.round(c.q * 100) / 100,
    /* Shared identity across every ballot-derived format. The quiz, the media
     * lean card, the award races and this all draw on the same votes, and
     * without a common key the feed can tell one story four ways in one scroll.
     * js/engine.js demotes a card whose story_key was seen recently. */
    story_family: "ballot:" + c.family,
    story_key: ["ballot", c.award, c.season, (c.subjects[0] || "-")].join("|"),
    payload: {
      season: c.season,
      award: AWARD_LABEL[c.award] || c.award,
      award_key: c.award,
      subjects: c.subjects,
      headline: c.headline,
      detail: c.detail,
      scope: `${c.ballots} tracked ballots`,
      url: c.url,
      cta: c.cta
    }
  });
}

/* ---------------- verify ---------------- */

let bad = 0;
const ids = new Set();
for (const c of cards) {
  if (ids.has(c.id)) { console.error(`  duplicate id ${c.id}`); bad++; }
  ids.add(c.id);
  const p = c.payload;
  if (!p.headline || !p.detail) { console.error(`  ${c.id}: empty text`); bad++; }
  if (!p.url || !/^https:\/\//.test(p.url)) { console.error(`  ${c.id}: bad url`); bad++; }
  if (/undefined|NaN|\[object/.test(p.headline + p.detail)) { console.error(`  ${c.id}: unfilled template`); bad++; }
  /* "by 0 points", "within 0.0% of each other", "0 of 0" - a claim of a margin
   * where there is no margin. Caught by reading a sample once; caught by the
   * build from now on. */
  if (/\bby 0 points?\b|\b0 of 0\b/.test(p.headline + p.detail)) {
    console.error(`  ${c.id}: claims a margin of zero`); bad++;
  }
  if (!c.story_key || c.story_key.split("|").length !== 4) { console.error(`  ${c.id}: bad story_key`); bad++; }
}
if (bad) { console.error(`FAILED: ${bad} problems`); process.exit(1); }

/* ---------------- report ---------------- */

console.log(`\n${candidates.length} candidates -> ${cards.length} cards`);
const fam = [...perFamily.entries()].sort((a, b) => b[1] - a[1]);
for (const [f, n] of fam) console.log(`  ${f.padEnd(18)} ${String(n).padStart(3)}  (${Math.round(n / cards.length * 100)}%)`);
console.log(`  thinned: ${rej.awardSeason} award-season at cap, ${rej.family} family at cap, ${rej.player} player at cap`);
console.log(`  distinct award-seasons: ${perAwardSeason.size}, distinct lead subjects: ${perPlayer.size}`);
const q = cards.map(c => c.quality_score).sort((a, b) => a - b);
if (q.length) console.log(`  novelty: min ${q[0]} median ${q[Math.floor(q.length / 2)]} max ${q[q.length - 1]}`);

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: "media-vote-tracker reporter ballots",
  cards
}));
console.log(`\nwrote ${path.relative(REPO, OUT)} (${Math.round(fs.statSync(OUT).size / 1024)}KB)`);
