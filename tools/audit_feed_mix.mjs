#!/usr/bin/env node
/* What a first-time reader actually gets, measured against the real sampler.
 *
 *     node tools/audit_feed_mix.mjs
 *     node tools/audit_feed_mix.mjs --cards 1000 --live 50 --runs 20
 *     node tools/audit_feed_mix.mjs --live 0        (a failed Buzz load)
 *     node tools/audit_feed_mix.mjs --live 120      (a busy trade deadline)
 *
 * WHY THIS DRIVES THE REAL ENGINE
 *
 * An audit that models the sampler is an audit of the model. js/engine.js is an
 * IIFE over `window`, so it loads headless against a stub exactly as the card
 * renderers do in tools/test_*_markup.mjs, and this calls the SHIPPED
 * E.sampleMixed with the SHIPPED constants read out of js/app.js. When the
 * numbers below are wrong, the feed is wrong - not this file.
 *
 * WHAT IT HAS TO INVENT, AND WHY THAT IS HONEST
 *
 * Buzz, trades and transactions are fetched in the reader's browser and appear
 * in no committed pool. There is nothing to read. So live supply is a DIAL:
 * --live N puts N synthetic live cards in the pool, and the point is to see
 * what share of the feed is reachable at each supply level rather than to
 * assert one number. The synthetic cards carry no real content - only the
 * shape the sampler keys on (type, tags, story_key, published_at), because
 * that is all the sampler reads.
 *
 * Seeded throughout, so a run is reproducible and two runs of the same seed
 * are comparable. --runs averages over that many cold starts.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { classify, bucketOf, hasTrait, typeOf, categoryOf } from "./lib/editorial.mjs";
import { gaps, windowMax, adjacent, pct, mean } from "./lib/feed_stats.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf("--" + name);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  return v === undefined ? dflt : v;
};
const num = (name, dflt) => {
  const v = parseFloat(arg(name, String(dflt)));
  return isFinite(v) ? v : dflt;
};

const CARDS = num("cards", 1000);
const LIVE_SUPPLY = num("live", 50);
const RUNS = num("runs", 20);
const SEED0 = num("seed", 1);
const COLD = num("cold", 50);
/* A FIXED CLOCK. Live freshness is measured against it, so a report is
 * comparable to one taken on another day rather than only to itself. Override
 * with --now <epoch ms> to model a different point in a season. */
const NOW = num("now", Date.parse("2026-01-15T12:00:00Z"));
const VERBOSE = argv.indexOf("--sample") >= 0;
/* --legacy drives the pre-scheduler path: sampleMixed with the reserved buzz
 * share, which is what shipped before Stage 3. Same seeds, same pools, same
 * synthetic live supply, so the two runs are comparable card for card. */
const LEGACY = argv.indexOf("--legacy") >= 0;

/* Read out of js/schedule.js rather than restated, for the same reason the app
 * constants are: a cap this file disagrees with makes every report worthless. */
const MEDIA_CAP = (() => {
  const src = fs.readFileSync(path.join(REPO, "js", "schedule.js"), "utf8");
  const m = src.match(/maxMediaHeavyPer10:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 2;
})();

/* ---------------- the app's own constants ----------------
 *
 * READ OUT OF js/app.js rather than restated. A copy here would drift, and an
 * audit running different numbers from the app is worse than no audit. */
const appSrc = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");
const constOf = (name, dflt) => {
  const m = appSrc.match(new RegExp("var\\s+" + name + "\\s*=\\s*([0-9.*\\s]+);"));
  if (!m) return dflt;
  try { return Function('"use strict";return (' + m[1] + ")")(); } catch (e) { return dflt; }
};
const BATCH = constOf("BATCH", 8);
/* --buzz-share overrides the app's value WITHOUT touching js/app.js, so the
 * question "what would the feed look like if the reserved live block were
 * bigger?" can be answered before anything is changed. The header says when it
 * is overridden, because a report with a value the app does not have is a
 * proposal and not a measurement. */
const BUZZ_SHARE_APP = constOf("BUZZ_SHARE", 0.4);
const BUZZ_SHARE = num("buzz-share", BUZZ_SHARE_APP);
const BUZZ_OVERRIDDEN = BUZZ_SHARE !== BUZZ_SHARE_APP;
const BUZZ_FRESH_MS = constOf("BUZZ_FRESH_MS", 48 * 3600 * 1000);
/* The "who has more" difficulty ceiling, used by usableCard below. Default 1.6
 * matches js/app.js; if that declaration is ever renamed this falls back rather
 * than silently counting the blowouts back in, and the fallback is the same
 * number for that reason. */
const TRIVIA_MAX_RATIO = constOf("TRIVIA_MAX_RATIO", 1.6);
const DIVERSITY_WINDOW = constOf("DIVERSITY_WINDOW", 12);
/* MIXED_CAPS is an object literal, so it is parsed rather than eval'd. */
const MIXED_CAPS = (() => {
  const m = appSrc.match(/var\s+MIXED_CAPS\s*=\s*\{([^}]*)\}/);
  const out = {};
  if (m) for (const part of m[1].split(",")) {
    const kv = part.split(":").map(s => s.trim());
    if (kv.length === 2 && kv[0]) out[kv[0]] = parseInt(kv[1], 10);
  }
  return Object.keys(out).length ? out : { race: 1, mates: 1, compare: 1, lean: 1, vs: 1 };
})();

/* ---------------- the real engine, headless ----------------
 *
 * SEEDED BY SHADOWING, NOT BY ASKING. js/engine.js calls Math.random in five
 * places and has no seed hook, so an audit that seeds only its own PRNG is not
 * reproducible: the sampler - the thing being measured - still draws from the
 * real one. Two runs of the same seed then disagree and a before/after
 * comparison means nothing, which tools/test_audit_feed_mix.mjs asserts
 * against.
 *
 * `new Function` gives the engine its globals as parameters, so Math and Date
 * are passed in shadowed: Math inherits the real Math and overrides `random`,
 * and Date is a Proxy that answers `now()` with a fixed clock while
 * constructing and parsing exactly as Date does. The engine is unmodified. */

function loadEngine(seed, fixedNow) {
  const rnd = mulberry32(seed);
  const SeededMath = Object.create(Math);
  SeededMath.random = rnd;
  /* A Proxy keeps `new Date(x)` and Date.parse working - only `now` moves. */
  const FrozenDate = new Proxy(Date, {
    get(target, prop, recv) {
      if (prop === "now") return () => fixedNow;
      return Reflect.get(target, prop, recv);
    }
  });
  const store = {};
  const win = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    matchMedia: () => ({ matches: false, addEventListener: () => {}, addListener: () => {} }),
    navigator: { userAgent: "audit" },
    location: { href: "http://audit.local/", search: "" },
    setTimeout: (f) => f && 0,
    requestIdleCallback: null
  };
  const doc = { createElement: () => ({}), addEventListener: () => {} };
  const load = (file) => new Function(
    "window", "localStorage", "navigator", "document", "Math", "Date",
    fs.readFileSync(path.join(REPO, "js", file), "utf8"))(
    win, win.localStorage, win.navigator, doc, SeededMath, FrozenDate);

  /* The shipped scheduler, loaded the same way and in the same order
   * index.html loads it: editorial first, because schedule.js reads it at
   * definition time. */
  load("editorial.js");
  load("engine.js");
  load("schedule.js");
  return { E: win.DoomEngine, S: win.DoomSchedule, rnd: rnd };
}

/* ---------------- the archive ---------------- */

/* --skip drops pool files by substring, which is how the §13 coverage bug is
 * measured rather than described: the five pools For You never asked for on a
 * cold load are skipped, and the difference between that run and a full one is
 * exactly what a first-time reader was missing. */
const SKIP = String(arg("skip", "")).split(",").map(s => s.trim()).filter(Boolean);

/* --boot: THE FIRST SECOND, WHICH NOTHING HERE USED TO MEASURE.
 *
 * Every other mode of this audit hands the sampler all nineteen pools, and a
 * reader never has that. At boot only EAGER_POOLS have arrived, live is still
 * in flight, and the first two batches - sixteen cards, the whole first screen
 * and a bit - are drawn from whatever that subset holds. That blind spot is how
 * the app shipped a feed opening on fourteen sample trades, and then, once
 * those were correctly refused, one opening on eighteen consecutive trivia
 * cards. Both times the full-archive audit reported zero violations, because
 * both times the full archive was fine.
 *
 * So this mode restricts the pool to the eager set, read out of js/app.js, and
 * drops the dummy cards - which is what For You does. Run it after touching
 * EAGER_POOLS, the cold plan, or the fallback:
 *
 *     node tools/audit_feed_mix.mjs --boot --cards 16 --live 0
 */
const BOOT = process.argv.includes("--boot");
const EAGER = [...(/var EAGER_POOLS = \[([\s\S]*?)\];/
  .exec(fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8")) || [, ""])[1]
  .matchAll(/"data\/([^"]+)"/g)].map(m => m[1]);

const pools = fs.readdirSync(path.join(REPO, "data"))
  .filter(f => BOOT ? EAGER.indexOf(f) >= 0 : /-pool\.json$/.test(f))
  .filter(f => !SKIP.some(s => f.indexOf(s) >= 0))
  .sort();
const archive = [];
for (const f of pools) {
  const j = JSON.parse(fs.readFileSync(path.join(REPO, "data", f), "utf8"));
  const cards = Array.isArray(j) ? j : (j.cards || []);
  for (const c of cards) {
    /* THE SAMPLE CARDS ARE NOT IN FOR YOU, so an audit that counts them is
     * measuring a feed nobody is served. Only reachable in --boot mode, which
     * is the only mode that loads dummy-cards.json at all. */
    if (c && c.dummy) continue;
    archive.push(c);
  }
}

/* usableCard, mirrored from js/app.js. The gates that stop a malformed card
 * being drawn; an audit that ignores them would count cards the feed refuses. */
function usableCard(c) {
  if (c && c.type === "ballot" && ((c.payload && c.payload.options) || []).length < 4) return false;
  if (c && c.type === "careermap") {
    const o = (c.payload && c.payload.options) || [];
    const i = c.payload && c.payload.answer_idx;
    if (o.length !== 4) return false;
    if (!(typeof i === "number" && i >= 0 && i < o.length)) return false;
  }
  if (c && c.type === "dreamteam") {
    const sq = (c.payload && c.payload.squads) || [];
    const di = c.payload && c.payload.answer_idx;
    if (sq.length !== 2) return false;
    if (!sq.every(x => x && (x.players || []).length === 5)) return false;
    if (!(di === 0 || di === 1)) return false;
  }
  /* The "who has more" difficulty gate. The shipped trivia pool was built with
   * a 4x ceiling and 133 of its 300 cards are blowouts the feed now refuses, so
   * an audit without this counts 300 trivia cards where a reader gets 167 - and
   * reports a trivia share nobody is actually served. Ceiling read out of
   * js/app.js rather than repeated, because the two drifting apart is exactly
   * what tools/test_trivia_difficulty.mjs exists to catch. */
  if (c && c.type === "trivia") {
    const p = c.payload;
    const va = p && p.a && p.a.value, vb = p && p.b && p.b.value;
    if (typeof va === "number" && typeof vb === "number") {
      const lo = Math.min(va, vb);
      if (!lo) return false;
      if (Math.max(va, vb) / lo > TRIVIA_MAX_RATIO) return false;
    }
  }
  return true;
}

/* ---------------- synthetic live supply ----------------
 *
 * Shape only. The sampler reads type, tags and published_at; it never reads a
 * headline. Sources and players are spread so the source-diversity statistics
 * below measure the SAMPLER's clustering rather than an artefact of every
 * synthetic card sharing one source. */
const SOURCES = ["bsky:shams", "bsky:woj", "reddit", "youtube", "bsky:haynes",
                 "bsky:charania", "bsky:stein", "bsky:amick"];
const PLAYERS = ["LeBron James", "Stephen Curry", "Nikola Jokic", "Luka Doncic",
                 "Jayson Tatum", "Anthony Edwards", "Victor Wembanyama",
                 "Shai Gilgeous-Alexander", "Giannis Antetokounmpo", "Joel Embiid",
                 "Tyrese Haliburton", "Devin Booker"];
const TEAMS = ["LAL", "BOS", "DEN", "OKC", "MIN", "NYK", "PHI", "MIL", "DAL", "GSW"];

function liveSupply(n, rnd) {
  const out = [];
  const now = NOW;
  for (let i = 0; i < n; i++) {
    /* Three live types in roughly the proportion the tabs suggest: mostly
     * Buzz, some trades, a few trade digests. */
    const r = rnd();
    const type = r < 0.72 ? "buzz" : (r < 0.93 ? "trade" : "tradedigest");
    const src = SOURCES[Math.floor(rnd() * SOURCES.length)];
    const pl = PLAYERS[Math.floor(rnd() * PLAYERS.length)];
    const tm = TEAMS[Math.floor(rnd() * TEAMS.length)];
    out.push({
      id: type + "-synth-" + i,
      type,
      tab: [type === "buzz" ? "buzz" : "trades", "foryou"],
      tags: { content_type: type, players: [pl], teams: [tm], category: "" },
      story_key: type + "|" + pl + "|" + i,
      story_family: null,
      quality_score: 0.7,
      payload: {
        /* Inside BUZZ_FRESH_MS, or buzzShare() counts it as stale and shrinks
         * the reserved block - which would measure a quiet week rather than the
         * supply level asked for. */
        published_at: new Date(now - Math.floor(rnd() * BUZZ_FRESH_MS * 0.8)).toISOString(),
        source: src, outlet: src, text: "synthetic"
      }
    });
  }
  return out;
}

/* A small seeded PRNG, so a run is reproducible without pulling in a dep. */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- one cold-start session ----------------
 *
 * Mirrors loadMore(): batches of BATCH, drawn with sampleMixed, MIXED_CAPS, a
 * reserved buzz share and the last-twelve avoid set. */
function runSession(E, S, pool, wanted, rnd) {
  const rendered = {};
  const feed = [];
  const since = S ? S.newCounters() : null;

  function buzzShare(p) {
    /* A fresh profile sits exactly on BUZZ_SHARE, which is what a cold start
     * is. The learned-weight arms of the real function are deliberately not
     * exercised here: this audit is the first-visit case. */
    const cutoff = NOW - BUZZ_FRESH_MS;
    let fresh = 0;
    for (const c of p) {
      if (((c.tags && c.tags.content_type) || c.type) !== "buzz") continue;
      if (rendered[c.id]) continue;
      const t = c.payload && c.payload.published_at ? Date.parse(c.payload.published_at) : NaN;
      if (!isNaN(t) && t >= cutoff) fresh++;
    }
    return Math.max(0, Math.min(BUZZ_SHARE, fresh / BATCH));
  }

  function avoid() {
    const out = { stories: {}, players: {}, families: {} };
    for (let i = Math.max(0, feed.length - DIVERSITY_WINDOW); i < feed.length; i++) {
      const c = feed[i];
      if (c.story_key) out.stories[c.story_key] = 1;
      if (c.story_family) out.families[c.story_family] = 1;
      for (const p of ((c.tags && c.tags.players) || [])) out.players[p] = 1;
    }
    return out;
  }

  let guard = 0;
  while (feed.length < wanted && guard++ < wanted * 4) {
    const avail = pool.filter(c => !rendered[c.id]);
    if (!avail.length) break;
    /* THE SHIPPED FOR YOU PATH. js/app.js sends For You through
     * DoomSchedule.build and every other tab through sampleMixed; --legacy
     * measures the old path, which is how the before/after comparison is made
     * against the same seeds rather than against a remembered number. */
    const batch = (S && !LEGACY)
      ? S.build({
          pool: avail, size: BATCH, position: feed.length,
          tail: feed.slice(Math.max(0, feed.length - DIVERSITY_WINDOW)),
          since, avoid: avoid(),
          sample: (list, n, opts) => E.sample(list, n, opts),
          rng: rnd
        }).cards
      : E.sampleMixed(avail, BATCH, {
          cap: MIXED_CAPS,
          share: { buzz: buzzShare(avail) },
          avoid: avoid()
        });
    if (!batch || !batch.length) break;
    for (const c of batch) {
      if (feed.length >= wanted) break;
      rendered[c.id] = 1;
      feed.push(c);
      /* Counted as served, exactly as js/app.js counts it in the render loop. */
      if (S && since) S.countCard(since, c);
    }
  }
  return feed;
}

/* Statistics live in tools/lib/feed_stats.mjs, unit-tested against
 * hand-checked fixtures by tools/test_feed_stats.mjs. */

/* ---------------- run ---------------- */

const usable = archive.filter(usableCard);

console.log(`FEED MIX AUDIT`);
console.log(`  archive:      ${archive.length} cards, ${usable.length} usable, ${pools.length} pools` +
  (SKIP.length ? `   (skipping ${SKIP.join(", ")})` : ""));
console.log(`  live supply:  ${LIVE_SUPPLY} synthetic cards (buzz/trade/digest; none exist in the repo)`);
console.log(`  sampler:      ${LEGACY ? "the pre-Stage-3 E.sampleMixed path (--legacy)" : "the shipped DoomSchedule + E.sample"}`);
console.log(`  constants:    BATCH=${BATCH} BUZZ_SHARE=${BUZZ_SHARE} ` +
  `DIVERSITY_WINDOW=${DIVERSITY_WINDOW} caps=${JSON.stringify(MIXED_CAPS)}` +
  (BUZZ_OVERRIDDEN ? `\n  OVERRIDE:     BUZZ_SHARE forced to ${BUZZ_SHARE}; js/app.js says ${BUZZ_SHARE_APP}. This is a proposal, not a measurement.` : ""));
console.log(`  ${RUNS} seeded cold starts of ${CARDS} cards each`);
console.log(`  cold-start window: first ${COLD} cards, which is what §1 targets`);
console.log(`  clock:        ${new Date(NOW).toISOString()} (fixed, so reports compare)`);
console.log(`  seeds:        ${SEED0}, engine Math.random shadowed per run`);
if (BOOT) {
  console.log(`  BOOT MODE:    only the ${EAGER.length} eager pools, dummies excluded - the first`);
  console.log(`                second of a cold load, before the lazy pools and live land.`);
}
if (!LIVE_SUPPLY) {
  console.log(`  NOTE:         --live 0, so the §1 SHARE targets are not judged: with no live`);
  console.log(`                cards every share is measured against a denominator missing two`);
  console.log(`                thirds of the feed. The caps, the throttles and the boot checks`);
  console.log(`                below still are.`);
}
console.log("");

const feeds = [];
for (let r = 0; r < RUNS; r++) {
  const s = SEED0 + r * 7919;
  const rnd = mulberry32(s);
  /* A fresh engine per run, seeded, so run r is reproducible on its own. */
  const { E, S } = loadEngine(s, NOW);
  const pool = usable.concat(liveSupply(LIVE_SUPPLY, rnd));
  feeds.push(runSession(E, LEGACY ? null : S, pool, CARDS, rnd));
}


/* One pass over a set of feeds. Called twice - once over whole sessions, once
 * over the first COLD cards of each - because §1's targets are about what a
 * first-time reader sees, and a 1,000-card average buries that completely. */
function summarize(list) {
  const agg = {
    buckets: {}, types: {}, sources: {},
    live: 0, playable: 0, gtp: 0, history: 0, comparison: 0, awards: 0, money: 0,
    mediaHeavy: 0, autoplay: 0, total: 0,
    gapAwards: [], gapMoney: [], gapGtp: [], gapPlayable: [], gapMedia: [],
    firstPlayable: [], firstLive: [],
    win10media: 0, win10mediaAll: 0, win4autoplay: 0, win12awards: 0,
    adjSource: 0, adjBucket: 0, adjAwards: 0, adjMedia: 0,
    repeatPlayer: 0, repeatTeam: 0,
    runs: list.length,
    /* per-run counts, so a share can be reported with its spread rather than
     * as one average that might hide a run with no live cards at all. */
    livePerRun: [], awardsPerRun: [], moneyPerRun: []
  };

  for (const feed of list) {
    agg.total += feed.length;
    let live = 0, awards = 0, money = 0;
    for (const c of feed) {
      const b = bucketOf(c);
      agg.buckets[b] = (agg.buckets[b] || 0) + 1;
      const t = typeOf(c);
      agg.types[t] = (agg.types[t] || 0) + 1;
      if (b === "live") {
        agg.live++; live++;
        const s = (c.payload && (c.payload.source || c.payload.outlet)) || "(none)";
        agg.sources[s] = (agg.sources[s] || 0) + 1;
      }
      if (hasTrait(c, "playable")) agg.playable++;
      if (hasTrait(c, "guess_the_player")) agg.gtp++;
      if (b === "history_record") agg.history++;
      if (b === "comparison") agg.comparison++;
      if (b === "awards_voting") { agg.awards++; awards++; }
      if (b === "money_cap_static") { agg.money++; money++; }
      if (hasTrait(c, "media_heavy")) agg.mediaHeavy++;
      if (hasTrait(c, "autoplay")) agg.autoplay++;
    }
    agg.livePerRun.push(live);
    agg.awardsPerRun.push(awards);
    agg.moneyPerRun.push(money);

    const g = (p) => { const x = gaps(feed, p); return x.mean; };
    const push = (arr, v) => { if (v != null) arr.push(v); };
    push(agg.gapAwards, g(c => bucketOf(c) === "awards_voting"));
    push(agg.gapMoney, g(c => bucketOf(c) === "money_cap_static"));
    push(agg.gapGtp, g(c => hasTrait(c, "guess_the_player")));
    push(agg.gapPlayable, g(c => hasTrait(c, "playable")));
    push(agg.gapMedia, g(c => hasTrait(c, "media_heavy")));
    push(agg.firstPlayable, gaps(feed, c => hasTrait(c, "playable")).first);
    push(agg.firstLive, gaps(feed, c => bucketOf(c) === "live").first);

    /* TWO media counts, because the scheduler caps one of them and not the
     * other. Archive media - races, comparisons, teammates, media-lean - is
     * what §16's cap governs. A Buzz card is media-heavy too, and counting it
     * would make the cap unsatisfiable against a 65-70% live target, so it is
     * reported separately rather than folded in silently. */
    agg.win10media = Math.max(agg.win10media,
      windowMax(feed, c => hasTrait(c, "media_heavy") && bucketOf(c) !== "live", 10));
    agg.win10mediaAll = Math.max(agg.win10mediaAll || 0,
      windowMax(feed, c => hasTrait(c, "media_heavy"), 10));
    agg.win4autoplay = Math.max(agg.win4autoplay, windowMax(feed, c => hasTrait(c, "autoplay"), 4));
    agg.win12awards = Math.max(agg.win12awards, windowMax(feed, c => bucketOf(c) === "awards_voting", 12));

    agg.adjSource += adjacent(feed, c => bucketOf(c) === "live"
      ? ((c.payload && (c.payload.source || c.payload.outlet)) || null) : null);
    agg.adjBucket += adjacent(feed, c => bucketOf(c));
    agg.adjAwards += adjacent(feed, c => bucketOf(c) === "awards_voting" ? "aw" : null);
    agg.adjMedia += adjacent(feed, c => (hasTrait(c, "media_heavy") && bucketOf(c) !== "live") ? "mh" : null);

    /* Repeat frequency inside a 5-card window, which is the §18 requirement. */
    for (let i = 0; i < feed.length; i++) {
      const pl = ((feed[i].tags && feed[i].tags.players) || [])[0];
      const tm = ((feed[i].tags && feed[i].tags.teams) || [])[0];
      for (let j = Math.max(0, i - 5); j < i; j++) {
        const p2 = ((feed[j].tags && feed[j].tags.players) || [])[0];
        if (pl && p2 && pl === p2) { agg.repeatPlayer++; break; }
      }
      for (let j = Math.max(0, i - 5); j < i; j++) {
        const t2 = ((feed[j].tags && feed[j].tags.teams) || [])[0];
        if (tm && t2 && tm === t2) { agg.repeatTeam++; break; }
      }
    }
  }
  return agg;
}

const full = summarize(feeds);
const cold = summarize(feeds.map(f => f.slice(0, COLD)));

function shares(agg, title) {
  const T = agg.total;
  const line = (label, n, target) =>
    console.log(`  ${label.padEnd(34)}${pct(n, T).toFixed(1).padStart(6)}%   ${target || ""}`);
  console.log(`${title}                       actual   target`);
  line("current NBA (live)", agg.live, "65-70%");
  line("playable", agg.playable, "10-15%");
  line("  of which Guess the Player", agg.gtp, "");
  line("history / records", agg.history, "8-12%");
  line("comparisons / races / data", agg.comparison, "5-8%");
  line("awards / voting", agg.awards, "very limited");
  line("static salary / cap", agg.money, "~1.5%");
}

console.log(`COLD START, FIRST ${COLD} CARDS (the brief's actual target)`);
shares(cold, "");
{
  const per = n => (n / cold.runs).toFixed(1);
  console.log(`  per ${COLD}-card cold start, averaged over ${cold.runs} runs:`);
  console.log(`    live cards                      ${per(cold.live).padStart(6)}   want ~33`);
  console.log(`    awards / voting cards           ${per(cold.awards).padStart(6)}   want 1-2`);
  console.log(`    static salary / cap cards       ${per(cold.money).padStart(6)}   want 0-1`);
  const fl = mean(cold.firstLive), fp = mean(cold.firstPlayable);
  console.log(`    first live card at index        ${(fl == null ? "never" : fl.toFixed(1)).padStart(6)}   want 0-1`);
  console.log(`    first playable card at index   ${(fp == null ? "never" : fp.toFixed(1)).padStart(7)}   want 6-8`);
  console.log(`    worst awards in a 12-card window${String(cold.win12awards).padStart(5)}   max 1`);
  console.log(`    worst archive media in 10 cards${String(cold.win10media).padStart(6)}   max ${MEDIA_CAP}`);
  console.log(`      (all media incl. live)       ${String(cold.win10mediaAll).padStart(6)}   not capped`);
}

console.log("\nWHOLE SESSION (" + CARDS + " cards)");
shares(full, "SHARE OF FEED          ");

const T = full.total;
const gapLine = (label, arr, target) => {
  const m = mean(arr);
  console.log(`  ${label.padEnd(34)}${(m == null ? "never" : ("1 per " + m.toFixed(1))).padStart(12)}   ${target || ""}`);
};

console.log("\nHOW OFTEN                                  actual   target");
gapLine("awards / voting", full.gapAwards, "1 per 25-40");
gapLine("static salary / cap", full.gapMoney, "1 per 60-75");
gapLine("Guess the Player", full.gapGtp, "1 per 20-30");
gapLine("any playable", full.gapPlayable, "1 per 7-10");
gapLine("media-heavy", full.gapMedia, "");

console.log("\nCAPS AND CLUSTERING (worst across runs)");
console.log(`  archive media in any 10-card window ${String(full.win10media).padStart(6)}   max ${MEDIA_CAP}`);
console.log(`  all media incl. live, per 10        ${String(full.win10mediaAll).padStart(6)}   not capped`);
console.log(`  autoplay in any 4-card window       ${String(full.win4autoplay).padStart(6)}   max 1`);
console.log(`  awards in any 12-card window        ${String(full.win12awards).padStart(6)}   max 1`);
console.log(`  adjacent awards cards (per run)     ${(full.adjAwards / RUNS).toFixed(1).padStart(6)}   0`);
console.log(`  adjacent media-heavy (per run)      ${(full.adjMedia / RUNS).toFixed(1).padStart(6)}   0`);
console.log(`  adjacent same-source live (per run) ${(full.adjSource / RUNS).toFixed(1).padStart(6)}   0`);
console.log(`  adjacent same-bucket (per run)      ${(full.adjBucket / RUNS).toFixed(1).padStart(6)}`);
console.log(`  same player within 5 cards (%)      ${pct(full.repeatPlayer, T).toFixed(1).padStart(6)}%`);
console.log(`  same team within 5 cards (%)        ${pct(full.repeatTeam, T).toFixed(1).padStart(6)}%`);

console.log("\nEDITORIAL BUCKETS (whole session)");
for (const b of Object.keys(full.buckets).sort((a, b2) => full.buckets[b2] - full.buckets[a])) {
  console.log(`  ${b.padEnd(20)}${String(full.buckets[b]).padStart(7)}  ${pct(full.buckets[b], T).toFixed(1)}%`);
}

console.log("\nCARD TYPES (whole session)");
for (const t of Object.keys(full.types).sort((a, b) => full.types[b] - full.types[a])) {
  console.log(`  ${t.padEnd(14)}${String(full.types[t]).padStart(7)}  ${pct(full.types[t], T).toFixed(1)}%`);
}

if (Object.keys(full.sources).length) {
  console.log("\nLIVE SOURCES");
  for (const s of Object.keys(full.sources).sort((a, b) => full.sources[b] - full.sources[a])) {
    console.log(`  ${s.padEnd(18)}${String(full.sources[s]).padStart(7)}  ${pct(full.sources[s], full.live).toFixed(1)}% of live`);
  }
}

/* ---------------- violations ----------------
 *
 * Split deliberately. The §1 mix targets are cold-start targets and are judged
 * on the first COLD cards; the §5/§6 frequency targets and the §16 caps are
 * whole-feed properties and are judged over the full session. Judging the mix
 * over 1,000 cards would report a failure the brief never asked about, and
 * judging the caps over 50 would miss most of the clustering. */

const bad = [];
const cp = n => pct(n, cold.total);

/* THE SHARE TARGETS ASSUME LIVE SUPPLY, so with none they are not failures.
 *
 * §1's percentages are shares of a feed that is two thirds current NBA. Run
 * with --live 0 and the live share is 0% by arithmetic, and the other three are
 * measured against a denominator missing two thirds of its cards, so every one
 * of them reports out of band. Four violations, none of which says anything
 * about the scheduler.
 *
 * That matters because "VIOLATIONS: 0" is the pass signal for every other mode.
 * A mode that always reports four is a number people learn to ignore, and an
 * ignored check is worse than an absent one - it is the fifth violation, the
 * real one, that gets ignored with it. So the share checks are skipped when
 * there is no live supply to measure them against, and the header says so.
 *
 * The CAPS and the frequency checks below are not skipped. Clustering, adjacent
 * media, awards-per-window and the throttles are all properties of the archive
 * mix and are just as meaningful without live. */
const LIVE_SHARES_MEANINGFUL = LIVE_SUPPLY > 0;
if (LIVE_SHARES_MEANINGFUL) {
  if (cp(cold.live) < 65) bad.push(`COLD: current NBA is ${cp(cold.live).toFixed(1)}% of the first ${COLD}, target 65-70%`);
  if (cp(cold.playable) < 10 || cp(cold.playable) > 15) bad.push(`COLD: playable is ${cp(cold.playable).toFixed(1)}%, target 10-15%`);
  if (cp(cold.history) < 8 || cp(cold.history) > 12) bad.push(`COLD: history is ${cp(cold.history).toFixed(1)}%, target 8-12%`);
  /* BOTH ENDS. This checked only the ceiling, which passed a run serving 4.0%
   * comparisons against a 5-8% band - a scheduler that had quietly stopped
   * serving a family reads as a success if only the upper bound is tested. */
  if (cp(cold.comparison) > 8 || cp(cold.comparison) < 5) {
    bad.push(`COLD: comparisons are ${cp(cold.comparison).toFixed(1)}%, target 5-8%`);
  }
}

/* WHAT --boot IS ACTUALLY JUDGED ON. The share bands do not apply with no live,
 * but the thing the boot window exists to catch does: one bucket taking over
 * the first screen. Half the first screen being quiz cards is what Jorge saw
 * twice, and it passed every check this file had. */
if (BOOT) {
  const share = b => pct(cold[b], cold.total);
  if (share("playable") > 30) {
    bad.push(`BOOT: playable is ${share("playable").toFixed(1)}% of the first screen, max 30% before live arrives`);
  }
  if (cold.history === 0) bad.push(`BOOT: no history cards at all in the eager set`);
  if (cold.comparison === 0) bad.push(`BOOT: no comparison cards at all in the eager set`);
}
if (cold.awards / cold.runs > 2) bad.push(`COLD: ${(cold.awards / cold.runs).toFixed(1)} awards cards per ${COLD}, want 1-2`);
if (cold.money / cold.runs > 1) bad.push(`COLD: ${(cold.money / cold.runs).toFixed(1)} static salary cards per ${COLD}, want 0-1`);
if (cold.win12awards > 1) bad.push(`COLD: ${cold.win12awards} awards in a 12-card window, max 1`);
if (cold.win10media > MEDIA_CAP) {
  bad.push(`COLD: ${cold.win10media} archive media in a 10-card window, max ${MEDIA_CAP}`);
}
{
  const m = mean(full.gapAwards);
  if (m != null && m < 25) bad.push(`FULL: awards every ${m.toFixed(1)} cards, target 25-40`);
  /* The brief said 1 per 100 and that measured 0.0% in the first fifty, which
   * read as the family having been removed. Jorge asked for 1.5%, which is one
   * per 67, so the target here moved with the decision rather than flagging it
   * as a violation for ever. */
  const mm = mean(full.gapMoney);
  if (mm != null && (mm < 55 || mm > 85)) {
    bad.push(`FULL: static salary every ${mm.toFixed(1)} cards, target 60-75`);
  }
  const mg = mean(full.gapGtp);
  if (mg != null && mg < 20) bad.push(`FULL: Guess the Player every ${mg.toFixed(1)} cards, target 20-30`);
}
/* The cap is read out of js/schedule.js, not restated. It moved once - three
 * follows from animations being placed four apart - and a hardcoded 2 here
 * would have reported a violation the scheduler was designed to allow. */
if (full.win10media > MEDIA_CAP) {
  bad.push(`FULL: ${full.win10media} archive media in a 10-card window, max ${MEDIA_CAP}`);
}
if (full.win4autoplay > 1) bad.push(`FULL: ${full.win4autoplay} autoplay in a 4-card window, max 1`);
if (full.win12awards > 1) bad.push(`FULL: ${full.win12awards} awards cards in a 12-card window, max 1`);
if (full.adjAwards > 0) bad.push(`FULL: ${(full.adjAwards / RUNS).toFixed(1)} adjacent awards cards per run, max 0`);
if (full.adjMedia > 0) bad.push(`FULL: ${(full.adjMedia / RUNS).toFixed(1)} adjacent media-heavy cards per run, max 0`);

console.log(`\nVIOLATIONS: ${bad.length}`);
for (const b of bad) console.log("  - " + b);
/* A mix target that live supply makes arithmetically impossible is not a
 * scheduler failure, and reporting it as one would train everybody to ignore
 * the list. Said out loud instead. */
if (LIVE_SUPPLY < Math.ceil(0.65 * COLD) && bad.length) {
  console.log(`\n  NOTE: only ${LIVE_SUPPLY} live cards exist, and ${Math.ceil(0.65 * COLD)} are`);
  console.log(`  needed for a ${COLD}-card window to be 65% current. The share violations above`);
  console.log(`  are that shortage, not the scheduler. What to check on a degraded run is that`);
  console.log(`  awards and passive salary stay rationed - before Stage 3 a failed Buzz load`);
  console.log(`  turned the first fifty cards into 19.2% awards voting.`);
}

/* The ceiling, stated rather than implied. With LIVE_SUPPLY live cards in the
 * pool, no scheduler can make the first COLD cards more than this share live,
 * because there is nothing else to serve. */
{
  const ceiling = Math.min(100, pct(Math.min(LIVE_SUPPLY, COLD), COLD));
  console.log(`\nCEILING: with ${LIVE_SUPPLY} live cards available, the first ${COLD} cards can be`);
  console.log(`at most ${ceiling.toFixed(0)}% live. The 65-70% target needs ${Math.ceil(0.65 * COLD)} live cards at cold start.`);
}

if (VERBOSE && feeds[0]) {
  console.log("\nFIRST 50 CARDS OF ONE SESSION (seed " + SEED0 + ")");
  feeds[0].slice(0, 50).forEach((c, i) => {
    const tr = classify(c).traits.filter(t => t !== "database_generated");
    console.log(`  ${String(i + 1).padStart(3)}. ${bucketOf(c).padEnd(17)}${typeOf(c).padEnd(12)}` +
      `${categoryOf(c).padEnd(20)}${tr.join(",")}`);
  });
}

console.log("\nLive supply is a dial, not a measurement: buzz and trades exist only in");
console.log("the reader's browser. Re-run with --live 0 / 20 / 50 / 120 to see what");
console.log("share of the feed is reachable at each level of real supply.");
