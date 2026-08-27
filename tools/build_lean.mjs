#!/usr/bin/env node
/* NBA Doomscroll — media lean cards
 *
 * WHAT THIS IS FOR
 *
 * Jorge: "Here I'm mostly interested in which media members/outlets favor each
 * player. That's the main thing of this feature."
 *
 * A port of the HoopsHype media-vote video into a feed card, and this file
 * feeds it. Three acts, the same three the video runs and in its order:
 *
 *   1. "His biggest media boosters and snubbers, vs the panel"   — by voter
 *   2. "The outlets that boosted and snubbed him, vs the panel"  — by outlet
 *   3. "How each region's media rated him, vs US media"          — by region
 *
 * Each act is a diverging bar chart around a zero axis: boosters growing right
 * in green, snubbers growing left in red. js/lean-player.js draws it.
 *
 * WHERE THE NUMBERS COME FROM
 *
 * media-vote-tracker computes the voter numbers. Each player file carries a
 * `board`: every voter who has had a ballot in a contest that player was
 * eligible for, with `diff` — their average points on him minus the field's —
 * over `n` ballots. Nothing here recomputes that. Acts 2 and 3 aggregate those
 * voter rows into outlets and regions, weighted by ballots.
 *
 * REGIONS ARE DERIVED, BECAUSE THE EXPORT HAS NO REGION FIELD
 *
 * It records a country per voter, as a full name. The map below turns those
 * into the video's five buckets, with the US held out as the baseline the
 * others are measured against — which is what "vs US media" means: a region's
 * weighted mean diff minus the US weighted mean.
 *
 * THE SAMPLE-SIZE PROBLEM, WHICH IS THE WHOLE PROBLEM
 *
 * A voter with two ballots on a player can show a huge diff by accident, and
 * printing "X is the biggest Jokic fan in the media" off two ballots would be
 * wrong in a way that is hard to walk back — it is a claim about a named
 * person's judgement. So voters need MIN_VOTER_BALLOTS ballots on that player
 * before they can appear, outlets need two reporters and MIN_OUTLET_BALLOTS
 * ballots between them, and a region needs MIN_REGION_BALLOTS. Aggregates are
 * weighted by ballots, not averaged flat, so a nine-ballot writer does not
 * outweigh a hundred-ballot desk at the same masthead.
 *
 * Oceania is the case that makes the floor worth having: one Australian voter
 * in the whole electorate, so "Oceania" would be one person's opinion wearing a
 * continent's name.
 *
 *   node tools/build_lean.mjs --local <media-vote-tracker/docs/data>
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

const args = process.argv.slice(2);
if (args[0] !== "--local" || !args[1]) {
  console.error("usage: node tools/build_lean.mjs --local <mvt/docs/data>");
  process.exit(1);
}
const MVT = args[1];

/* Five ballots is the floor for naming a person, and it is a floor rather than
 * a target: at four the pool grows to 178 players but a single ballot starts
 * moving someone's average enough to matter, and the card would be printing
 * "biggest Jokic fan in the media" off a rounding error attached to a real
 * byline. Every row shows its ballot count so the reader can discount it. */
const MIN_VOTER_BALLOTS = 5;
const MIN_OUTLET_BALLOTS = 15;
const MIN_OUTLET_REPORTERS = 2;
const MIN_REGION_BALLOTS = 12;
const MIN_REGION_VOTERS = 2;
const MIN_BOARD = 15;           // players nobody has voted on often enough
const MIN_DIFF = 2.0;           // and leans too small to be worth printing
const SHOW = 6;                 // rows a side; the video shows 6-8 at 1080px

/* Country names as the export writes them, to the video's five buckets. The US
 * is not here: it is the baseline act 3 measures everyone else against. */
const REGION = {
  Canada: "Canada",
  Mexico: "Americas", Brazil: "Americas", Argentina: "Americas",
  Chile: "Americas", Colombia: "Americas", Venezuela: "Americas",
  "Dominican Republic": "Americas", "Puerto Rico": "Americas", Uruguay: "Americas",
  France: "Europe", Italy: "Europe", Spain: "Europe", Greece: "Europe",
  Germany: "Europe", Portugal: "Europe", Serbia: "Europe", Croatia: "Europe",
  Slovenia: "Europe", Lithuania: "Europe", Turkey: "Europe", "United Kingdom": "Europe",
  Netherlands: "Europe", Belgium: "Europe", Switzerland: "Europe", Poland: "Europe",
  China: "Asia", Japan: "Asia", Philippines: "Asia", Israel: "Asia",
  "South Korea": "Asia", India: "Asia", Taiwan: "Asia", Lebanon: "Asia",
  Australia: "Oceania", "New Zealand": "Oceania"
};

/* Flag for the little country marker beside each voter, as the video has it.
 * An emoji rather than an image file: 17 countries appear across the whole
 * electorate and shipping 17 PNGs to draw at 14px would be silly. */
const FLAG = {
  US: "🇺🇸", Canada: "🇨🇦", Mexico: "🇲🇽", Brazil: "🇧🇷", Argentina: "🇦🇷",
  Chile: "🇨🇱", Colombia: "🇨🇴", Venezuela: "🇻🇪", Uruguay: "🇺🇾",
  "Dominican Republic": "🇩🇴", "Puerto Rico": "🇵🇷",
  France: "🇫🇷", Italy: "🇮🇹", Spain: "🇪🇸", Greece: "🇬🇷", Germany: "🇩🇪",
  Portugal: "🇵🇹", Serbia: "🇷🇸", Croatia: "🇭🇷", Slovenia: "🇸🇮",
  Lithuania: "🇱🇹", Turkey: "🇹🇷", "United Kingdom": "🇬🇧", Netherlands: "🇳🇱",
  Belgium: "🇧🇪", Switzerland: "🇨🇭", Poland: "🇵🇱",
  China: "🇨🇳", Japan: "🇯🇵", Philippines: "🇵🇭", Israel: "🇮🇱",
  "South Korea": "🇰🇷", India: "🇮🇳", Taiwan: "🇹🇼", Lebanon: "🇱🇧",
  Australia: "🇦🇺", "New Zealand": "🇳🇿"
};

const PLAYER_URL = "https://jsierrahoopshype.github.io/media-vote-tracker/player.html?p=";

const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
const faces = (() => {
  try { return readJson(path.join(REPO, "data", "faces", "index.json")).faces || {}; }
  catch (e) { return {}; }
})();

const round1 = v => Math.round(v * 10) / 10;

const OUT_DIR = path.join(REPO, "data", "lean");
fs.mkdirSync(OUT_DIR, { recursive: true });

const dir = path.join(MVT, "player");
const cards = [];
let seen = 0, thin = 0, flat = 0, noFace = 0;

for (const f of fs.readdirSync(dir).sort()) {
  if (!f.endsWith(".json")) continue;
  seen++;
  const p = readJson(path.join(dir, f));
  const full = (p.board || []).filter(b => b.voter);
  const board = full.filter(b => b.n >= MIN_VOTER_BALLOTS);
  if (board.length < MIN_BOARD) { thin++; continue; }

  /* board arrives sorted by diff, but sort here anyway rather than trust it:
   * the filter above removes rows and a later export could change its order. */
  const ranked = board.slice().sort((a, b) => b.diff - a.diff || a.voter.localeCompare(b.voter));
  const hi = ranked.filter(b => round1(b.diff) > 0).slice(0, SHOW);
  const lo = ranked.filter(b => round1(b.diff) < 0).slice(-SHOW).reverse();
  if (!hi.length || !lo.length) { thin++; continue; }
  if (hi[0].diff < MIN_DIFF || lo[0].diff > -MIN_DIFF) { flat++; continue; }

  /* Weighted aggregation for outlets and regions, over the FULL board rather
   * than the ballot-filtered one.
   *
   * That distinction is not a detail, and it was worth reverse-engineering from
   * the published video rather than guessing. Aggregating the filtered board
   * put L'Equipe at -3.2 on Jaylen Brown; the video says -2.3, which is what
   * the unfiltered board gives, because the desk has a second voter under five
   * ballots. Every outlet figure in that video reproduces exactly this way —
   * Arizona Republic -1.9, NBA.com -1.2, Yahoo! Sports -2.7 — and San Antonio
   * Express-News, a single voter at -5.1, is absent from it, which is what
   * fixes the reporter floor at two.
   *
   * The floors then do different jobs at different levels: a named individual
   * needs enough ballots of their own to be worth naming, while a desk needs
   * enough people to be a desk rather than one person in a masthead. */
  function group(keyFn, minBallots, minVoters) {
    const m = new Map();
    for (const b of full) {
      const k = keyFn(b);
      if (!k) continue;
      const g = m.get(k) || { key: k, n: 0, sum: 0, voters: new Set() };
      g.n += b.n; g.sum += b.diff * b.n; g.voters.add(b.voter);
      m.set(k, g);
    }
    return [...m.values()]
      .filter(g => g.n >= minBallots && g.voters.size >= minVoters)
      .map(g => ({ key: g.key, diff: g.sum / g.n, n: g.n, voters: g.voters.size }));
  }

  /* Round BEFORE splitting sides, not after. A desk sitting at +0.04 is a
   * booster by the raw number and a bar labelled "+0" on screen, which is not
   * a fact about anything. Rounding first drops it from both sides instead. */
  const split = (list) => {
    const s = list
      .map(x => ({ label: x.key, diff: round1(x.diff), n: x.n, voters: x.voters }))
      .sort((a, b) => b.diff - a.diff || a.label.localeCompare(b.label));
    return {
      hi: s.filter(x => x.diff > 0).slice(0, SHOW),
      lo: s.filter(x => x.diff < 0).slice(-SHOW).reverse()
    };
  };

  const outlets = split(group(b => b.outlet, MIN_OUTLET_BALLOTS, MIN_OUTLET_REPORTERS));

  /* Act 3 is measured against US media rather than against the whole panel,
   * because the panel IS mostly US media: 333 of the 384 voters. A region's
   * gap to the field would mostly be its gap to the US anyway, and saying so
   * outright is the more honest framing — which is what the video does. */
  const usRows = full.filter(b => b.country === "US");
  const usMean = usRows.length
    ? usRows.reduce((t, b) => t + b.diff * b.n, 0) / usRows.reduce((t, b) => t + b.n, 0)
    : 0;
  const regionRaw = group(b => (b.country && b.country !== "US" ? REGION[b.country] : null),
    MIN_REGION_BALLOTS, MIN_REGION_VOTERS)
    .map(g => ({ ...g, diff: g.diff - usMean }));
  const regions = split(regionRaw);

  const tile = faces[p.player];
  if (!tile) noFace++;

  const vrow = b => ({
    label: b.voter, sub: b.outlet || "", flag: FLAG[b.country] || "",
    diff: b.diff, n: b.n
  });

  const acts = [
    { title: "His biggest media boosters and snubbers, vs the panel",
      hi: hi.map(vrow), lo: lo.map(vrow) },
    { title: "The outlets that boosted and snubbed him, vs the panel",
      hi: outlets.hi, lo: outlets.lo },
    { title: "How each region's media rated him, vs US media",
      hi: regions.hi, lo: regions.lo, big: true }
  ].filter(a => a.hi.length || a.lo.length);

  /* One file per card, fetched only when the card scrolls into view — the same
   * shape the races, Teammates and Comparison cards use, so app.js's existing
   * lazy loader drives it with no new plumbing. */
  fs.writeFileSync(path.join(OUT_DIR, p.slug + ".json"), JSON.stringify({
    player: p.player,
    img: tile ? "data/faces/" + tile : null,
    team: p.team || null,
    acts
  }));

  cards.push({
    id: "lean-" + p.slug,
    type: "lean",
    tab: ["vault"],
    tags: {
      content_type: "lean",
      players: [p.player],
      teams: p.team ? [p.team] : [],
      era: "all-time",
      category: "media-lean"
    },
    payload: {
      player: p.player,
      img: tile ? "data/faces/" + tile : null,
      team: p.team || null,
      file: "data/lean/" + p.slug + ".json",
      acts_n: acts.length,
      voters: board.length,
      lead: hi[0].voter,
      lead_diff: hi[0].diff,
      note: `Points above or below what the rest of the voters gave him, ` +
            `averaged over every ballot. ${board.length} voters with ` +
            `${MIN_VOTER_BALLOTS}+ ballots on him.`,
      url: PLAYER_URL + p.slug
    }
  });
}

fs.writeFileSync(path.join(REPO, "data", "lean-pool.json"), JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  cards
}));

console.log(`media lean: ${cards.length} players from ${seen} files ` +
  `(${thin} too few qualified voters, ${flat} no lean worth printing, ${noFace} with no face tile)`);

/* Every check here is about not libelling anybody by arithmetic. */
let bad = 0;
for (const c of cards) {
  const p = c.payload;
  const f = JSON.parse(fs.readFileSync(path.join(REPO, p.file), "utf8"));
  for (const a of f.acts) {
    for (const r of a.hi) if (r.diff <= 0) { console.error(`  ${c.id}: "${r.label}" in the boosted side at ${r.diff}`); bad++; }
    for (const r of a.lo) if (r.diff >= 0) { console.error(`  ${c.id}: "${r.label}" in the snubbed side at ${r.diff}`); bad++; }
  }
  for (const r of f.acts[0].hi.concat(f.acts[0].lo)) {
    if (r.n < MIN_VOTER_BALLOTS) { console.error(`  ${c.id}: ${r.label} shown on ${r.n} ballots`); bad++; }
  }
  for (const a of f.acts.slice(1)) {
    for (const r of a.hi.concat(a.lo)) {
      const floor = a.big ? MIN_REGION_VOTERS : MIN_OUTLET_REPORTERS;
      if (!r.voters || r.voters < floor) { console.error(`  ${c.id}: "${r.label}" aggregates ${r.voters} voters`); bad++; }
    }
  }
}
if (bad) { console.error(`FAILED: ${bad} rows below the sample-size floor or on the wrong side`); process.exit(1); }
console.log(`sides are consistent, every named voter has ${MIN_VOTER_BALLOTS}+ ballots, ` +
  `every outlet ${MIN_OUTLET_BALLOTS}+ and every region ${MIN_REGION_VOTERS}+ voters ` +
  `(${cards.length} cards checked)`);

const sample = cards.find(c => c.payload.player === "Jaylen Brown") || cards[0];
console.log(`\ne.g. ${sample.payload.player}:`);
for (const a of JSON.parse(fs.readFileSync(path.join(REPO, sample.payload.file), "utf8")).acts) {
  console.log("  " + a.title);
  a.hi.slice(0, 3).forEach(r => console.log(`     +${r.diff}  ${r.label}${r.sub ? " (" + r.sub + ")" : ""}`));
  a.lo.slice(0, 3).forEach(r => console.log(`     ${r.diff}  ${r.label}${r.sub ? " (" + r.sub + ")" : ""}`));
}
const acts = {};
cards.forEach(c => { acts[c.payload.acts_n] = (acts[c.payload.acts_n] || 0) + 1; });
console.log("\ncards by act count:", JSON.stringify(acts));
