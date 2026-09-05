/* The Top 25 rank cards now say where a player was sent and who came back.
 * That detail is counted client-side over the newest slice of the trade log,
 * NOT over the week the share line above it describes, so two things have to
 * hold or the card lies:
 *
 *   1. the counting is right (destinations, return pieces, no double counts)
 *   2. it appears ONLY where the sample supports it
 *
 *     node tools/test_rank_detail.mjs
 *
 * The deals below are invented. That is the point: a made-up log can be built
 * to sit either side of RANK_DETAIL_MIN on purpose, and can contain the exact
 * shapes that broke earlier tallies - a three-team deal, a re-saved duplicate,
 * a draft pick coming back the other way.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = p => fs.readFileSync(path.join(REPO, p), "utf8");

/* js/trades.js is a browser IIFE. Same trick the other suites use: the
 * closing line is rewritten to hand the private functions to the test, so
 * production code carries no test hooks. */
const win = { setTimeout, fetch: undefined, localStorage: null, document: undefined };

function runIIFE(src, extra = "") {
  const body = src.replace(/\}\)\(window\);\s*$/, extra + "\n})(window);");
  new Function("window", "console", body)(win, console);
}

runIIFE(read("js/trades.js"),
  "root.DoomTrades.__test = { rankTally: rankTally, enrichRankCards: enrichRankCards," +
  " RANK_DETAIL_MIN: RANK_DETAIL_MIN, moversRankCards: moversRankCards," +
  " chooseRankCards: chooseRankCards, TOP_N_WEEKLY: TOP_N_WEEKLY };");

const T = win.DoomTrades.__test;
const MIN = T.RANK_DETAIL_MIN;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   " + detail : ""));
  if (!ok) failures++;
}

/* A deal is a list of legs sharing a timestamp. Cities, not abbreviations:
 * that is what the log stores and what abbrev() converts. */
const leg = (player, from, to) => ({ player: player, from_team: from, to_team: to });

/* n deals sending a player from one team to another, with a counterpart. */
function repeat(n, make) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(make(i));
  return out;
}

/* ---------------- 1. destinations and return pieces ---------------- */

console.log("\ncounting");

{
  // Star goes to Boston 8 times and to Miami 3 times. Boston deals send back
  // Guard; Miami deals send back Wing.
  const deals = [].concat(
    repeat(8, () => [leg("Star", "Phoenix", "Boston"), leg("Guard", "Boston", "Phoenix")]),
    repeat(3, () => [leg("Star", "Phoenix", "Miami"), leg("Wing", "Miami", "Phoenix")])
  );
  const t = T.rankTally(deals);
  const e = t["Star"];
  check("every deal counted", e && e.builds === 11, e ? "builds=" + e.builds : "no entry");
  check("destinations ranked by frequency",
    e && e.to.BOS === 8 && e.to.MIA === 3,
    e ? "BOS=" + e.to.BOS + " MIA=" + e.to.MIA : "");
  check("return pieces are the players coming the other way",
    e && e.back.Guard === 8 && e.back.Wing === 3,
    e ? "Guard=" + e.back.Guard + " Wing=" + e.back.Wing : "");
}

{
  // The same deal saved four times while someone tweaks it is ONE build.
  const one = [leg("Star", "Phoenix", "Boston"), leg("Guard", "Boston", "Phoenix")];
  const dup = [leg("Star", "Phoenix", "Boston"), leg("Star", "Phoenix", "Boston"),
               leg("Guard", "Boston", "Phoenix")];
  const t = T.rankTally([one, dup]);
  check("a repeated leg inside one deal counts once",
    t["Star"].builds === 2, "builds=" + t["Star"].builds);
}

{
  // Three-team deal: Star goes Phoenix -> Boston, Guard goes Boston -> Phoenix
  // (a real counterpart), Big goes Miami -> Boston (NOT a counterpart for
  // Star: he is not coming back to Phoenix).
  const deals = [[
    leg("Star", "Phoenix", "Boston"),
    leg("Guard", "Boston", "Phoenix"),
    leg("Big", "Miami", "Boston")
  ]];
  const e = T.rankTally(deals)["Star"];
  check("a third team's incoming player is not a return piece",
    e.back.Guard === 1 && e.back.Big === undefined,
    "back=" + JSON.stringify(e.back));
}

{
  // Picks are not who a reader wanted, on either side of the deal.
  const deals = [[
    leg("Star", "Phoenix", "Boston"),
    leg("2027 #14 pick", "Boston", "Phoenix")
  ]];
  const t = T.rankTally(deals);
  check("a pick coming back is not a return piece",
    Object.keys(t["Star"].back).length === 0, JSON.stringify(t["Star"].back));
  check("a pick is never a tallied player", t["2027 #14 pick"] === undefined);
}

{
  // A team name the log spells in a way TEAM_BY_CITY does not know must drop
  // the leg rather than tally a null destination.
  const deals = [[leg("Star", "Phoenix", "Sao Paulo"), leg("Guard", "Sao Paulo", "Phoenix")]];
  const t = T.rankTally(deals);
  check("an unknown city is skipped, not tallied as null",
    t["Star"] === undefined && t["Guard"] === undefined,
    JSON.stringify(Object.keys(t)));
}

/* ---------------- 2. the sample gate ---------------- */

console.log("\nwho gets detail");

function rankCard(player) {
  return { type: "traderank", payload: { player: player, rank: 2, count: 278, total: 8587 } };
}

{
  const deals = [].concat(
    repeat(MIN, () => [leg("Loud", "Phoenix", "Boston"), leg("Guard", "Boston", "Phoenix")]),
    repeat(MIN - 1, () => [leg("Quiet", "Denver", "Miami"), leg("Wing", "Miami", "Denver")])
  );
  const cards = [rankCard("Loud"), rankCard("Quiet"), rankCard("Absent")];
  T.enrichRankCards(cards, deals);

  check("at the threshold, detail is attached",
    !!cards[0].payload.dests && cards[0].payload.dests[0].team === "BOS",
    JSON.stringify(cards[0].payload.dests));
  check("one build below it, nothing is attached",
    cards[1].payload.dests === undefined && cards[1].payload.back === undefined);
  check("a player absent from the slice is left alone",
    cards[2].payload.dests === undefined);
  check("the note names the window the numbers came from",
    /from his \d+ builds in the newest \d+ trades/.test(cards[0].payload.detail_note || ""),
    JSON.stringify(cards[0].payload.detail_note));
  check("the share line is never overwritten",
    cards[0].payload.count === 278 && cards[0].payload.total === 8587);
}

{
  // Cards of other types share the digest list and must not be touched.
  const other = { type: "tradedigest", payload: { player: "Loud" } };
  const deals = repeat(MIN + 5, () => [leg("Loud", "Phoenix", "Boston"),
                                       leg("Guard", "Boston", "Phoenix")]);
  T.enrichRankCards([other], deals);
  check("a non-rank card is untouched", other.payload.dests === undefined);
}

{
  // No log at all: the rank cards must survive exactly as the digest built
  // them, because the digest is the half that still works.
  const cards = [rankCard("Loud")];
  T.enrichRankCards(cards, []);
  check("an empty log leaves the cards intact",
    cards[0].payload.player === "Loud" && cards[0].payload.dests === undefined);
  T.enrichRankCards(cards, null);
  check("a missing log does not throw", true);
}

/* ---------------- 3. only three of each ---------------- */

console.log("\nbounds");

{
  const cities = ["Boston", "Miami", "Denver", "Chicago", "Toronto"];
  const deals = [];
  cities.forEach(function (city, i) {
    for (let k = 0; k <= i + 2; k++) {
      deals.push([leg("Star", "Phoenix", city), leg("Back" + i, city, "Phoenix")]);
    }
  });
  const cards = [rankCard("Star")];
  T.enrichRankCards(cards, deals);
  check("at most three destinations", cards[0].payload.dests.length === 3,
    "got " + cards[0].payload.dests.length);
  check("at most three return pieces", cards[0].payload.back.length === 3,
    "got " + cards[0].payload.back.length);
  check("and they are the most frequent ones",
    cards[0].payload.dests[0].team === "TOR" && cards[0].payload.dests[1].team === "CHI",
    JSON.stringify(cards[0].payload.dests.map(d => d.team)));
}

/* ---------------- 4. the Worker's numbers ----------------
 *
 * /api/trade-log/movers answers the same question over the full week instead
 * of over a sample. Two things have to hold: its numbers win when it answers,
 * and its absence changes nothing at all.
 *
 * The shape below is the live one, trimmed:
 *   { player, trades, moves, share, from:[], to:[{name,n,pct}], with:[...] }
 */

console.log("\nthe worker's numbers");

const movers = {
  "Loud": {
    player: "Loud", trades: 204, share: 2.5,
    to:   [{ name: "Boston", n: 91, pct: 44.6 }, { name: "Miami", n: 66, pct: 32.4 }],
    with: [{ name: "Guard", n: 52, pct: 25.5 }]
  }
};

{
  // Loud also clears the sample gate, so this is a real contest between the
  // two sources and not a walkover.
  const deals = repeat(MIN + 4, () => [leg("Loud", "Phoenix", "Denver"),
                                       leg("Wing", "Denver", "Phoenix")]);
  const cards = [rankCard("Loud")];
  T.enrichRankCards(cards, deals, movers);
  const p = cards[0].payload;

  check("the worker's destinations win over the sample's",
    p.dests[0].team === "BOS" && p.dests[1].team === "MIA",
    JSON.stringify(p.dests.map(d => d.team)));
  check("percentages come from the worker",
    p.dests[0].pct === 44.6 && p.back[0].pct === 25.5,
    JSON.stringify([p.dests[0].pct, p.back[0].pct]));
  check("counts are not shown as the value",
    p.dests[0].n === undefined, JSON.stringify(p.dests[0]));
  check("return pieces come from the worker too",
    p.back.length === 1 && p.back[0].name === "Guard",
    JSON.stringify(p.back));
  check("the sample caveat is dropped, because it is not a sample",
    p.detail_note === "" && p.detail_full === true,
    JSON.stringify([p.detail_note, p.detail_full]));
  check("each destination links to that trade in the machine",
    /loop=1/.test(p.dests[0].url) && /to=Boston/.test(p.dests[0].url),
    p.dests[0].url);
  check("each return piece links to that swap",
    /player=Loud%2CGuard/.test(p.back[0].url), p.back[0].url);
  check("the share line is still never overwritten",
    p.count === 278 && p.total === 8587);
}

{
  // A player the worker did not rank still gets the sampled detail, caveat
  // and all. The two sources coexist on the same list of cards.
  const deals = repeat(MIN, () => [leg("Quiet", "Denver", "Miami"),
                                   leg("Wing", "Miami", "Denver")]);
  const cards = [rankCard("Quiet")];
  T.enrichRankCards(cards, deals, movers);
  const p = cards[0].payload;
  check("a player missing from the worker falls back to the sample",
    p.dests && p.dests[0].team === "MIA", JSON.stringify(p.dests));
  check("and keeps the caveat that the sample needs",
    /from his \d+ builds in the newest \d+ trades/.test(p.detail_note || "") &&
    p.detail_full === undefined,
    JSON.stringify(p.detail_note));
  check("the sampled path also carries a percentage of his own builds",
    p.dests[0].pct === 100 && p.back[0].pct === 100,
    JSON.stringify([p.dests[0].pct, p.back[0].pct]));
}

{
  // An entry with nothing in it must not shadow a sample that does have
  // something. Empty is not an answer.
  const hollow = { "Loud": { player: "Loud", to: [], with: [] } };
  const deals = repeat(MIN, () => [leg("Loud", "Phoenix", "Boston"),
                                   leg("Guard", "Boston", "Phoenix")]);
  const cards = [rankCard("Loud")];
  T.enrichRankCards(cards, deals, hollow);
  check("an empty worker entry falls through to the sample",
    cards[0].payload.dests[0].team === "BOS" && cards[0].payload.detail_note !== "",
    JSON.stringify(cards[0].payload.dests));
}

{
  // The endpoint being down is the ordinary case, not an error case.
  const deals = repeat(MIN, () => [leg("Loud", "Phoenix", "Boston"),
                                   leg("Guard", "Boston", "Phoenix")]);
  const a = [rankCard("Loud")], b = [rankCard("Loud")];
  T.enrichRankCards(a, deals, null);
  T.enrichRankCards(b, deals);
  check("a null worker response behaves exactly as before it existed",
    JSON.stringify(a[0].payload) === JSON.stringify(b[0].payload));
}

{
  // Worker up, log down. This is the pairing that broke the trades tab once
  // already, and the rank cards should still say something.
  const cards = [rankCard("Loud")];
  T.enrichRankCards(cards, [], movers);
  check("the worker alone is enough, with no log at all",
    cards[0].payload.dests[0].team === "BOS", JSON.stringify(cards[0].payload.dests));
}

{
  // A city the abbreviation table does not know must still render as itself
  // rather than as the string "null".
  const odd = { "Loud": { player: "Loud", to: [{ name: "Sao Paulo", n: 3, pct: 10 }], with: [] } };
  const cards = [rankCard("Loud")];
  T.enrichRankCards(cards, [], odd);
  check("an unknown city falls back to its own name",
    cards[0].payload.dests[0].team === "Sao Paulo",
    JSON.stringify(cards[0].payload.dests));
}

/* ---------------- 5. where the Top 25 comes from ----------------
 *
 * The rank cards used to be built from the digest's `topPlayers`. They are
 * built from movers now, and the digest is the fallback. The switch has to
 * hold in both directions: movers wins when it answers, and its absence
 * leaves the old path running untouched.
 */

console.log("\nbuilding the top 25");

/* A movers response of `n` players, most-traded first. */
function moversList(n) {
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({
      player: "P" + i,
      trades: 300 - i,
      share: Math.round((30 - i) * 10) / 100,
      from: [{ name: "Phoenix", n: 300 - i, pct: 99 }],
      to:   [{ name: "Boston", n: 90, pct: 30 }, { name: "Miami", n: 60, pct: 20 }],
      with: [{ name: "Counter" + i, n: 50, pct: 17 }]
    });
  }
  return { by: Object.fromEntries(list.map(p => [p.player, p])), list: list, days: 7, totalTrades: 8218 };
}

const weeklyDigestCard = name => ({
  type: "tradedigest",
  payload: { player: name, period: "the last 7 days", rank: 1 }
});
const dailyDigestCard = () => ({
  type: "tradedigest",
  payload: { player: "Someone", period: "the last 24 hours", rank: 1 }
});

{
  const mv = moversList(25);
  const cards = T.moversRankCards(mv, null);
  check("all twenty-five become cards when nobody is skipped",
    cards.length === 25, "got " + cards.length);
  check("ranked in the order the worker returned them",
    cards[0].payload.rank === 1 && cards[0].payload.player === "P0" &&
    cards[24].payload.rank === 25, JSON.stringify([cards[0].payload.player, cards[24].payload.rank]));
  check("each card carries the full breakdown, so it renders the wide layout",
    cards[0].payload.detail_full === true &&
    cards[0].payload.dests.length === 2 && cards[0].payload.back.length === 1);
  check("destinations carry a logo and an abbreviation for the bar rows",
    cards[0].payload.dests[0].abbr === "BOS" && /\/bos\.svg$/.test(cards[0].payload.dests[0].logo),
    cards[0].payload.dests[0].logo);
  check("the period is the window the worker was asked for",
    cards[0].payload.period === "the last 7 days", cards[0].payload.period);
  check("rank one scores highest and rank 25 lowest, both above zero",
    cards[0].quality_score > cards[24].quality_score && cards[24].quality_score > 0,
    JSON.stringify([cards[0].quality_score, cards[24].quality_score]));
  check("each player gets his own story key, so 25 of these do not clump",
    new Set(cards.map(c => c.story_key)).size === 25);
  check("the counterpart is tagged too, so entity filtering finds him",
    cards[0].tags.players.indexOf("Counter0") >= 0, JSON.stringify(cards[0].tags.players));
}

{
  // The digest's hero already has a better card. He must not get a second one.
  const cards = T.moversRankCards(moversList(25), "P0");
  check("the digest's number one is skipped, not duplicated",
    cards.length === 24 && cards.every(c => c.payload.player !== "P0"),
    "got " + cards.length);
  check("and the ranks of everyone else are unchanged",
    cards[0].payload.rank === 2 && cards[0].payload.player === "P1",
    JSON.stringify([cards[0].payload.player, cards[0].payload.rank]));
}

{
  // A player the worker ranked but knows nothing else about is not a card:
  // rank alone was the old card's whole point, and it is not worth one now.
  const mv = moversList(3);
  mv.list[1].to = []; mv.list[1]["with"] = [];
  const cards = T.moversRankCards(mv, null);
  check("a player with no destinations and no counterparts is dropped",
    cards.length === 2 && cards.every(c => c.payload.player !== "P1"),
    JSON.stringify(cards.map(c => c.payload.player)));
}

{
  // Never more than TOP_N_WEEKLY, whatever the endpoint sends.
  const cards = T.moversRankCards(moversList(60), null);
  check("the list is capped at the top 25", cards.length === T.TOP_N_WEEKLY,
    "got " + cards.length);
}

console.log("\nchoosing between the two sources");

{
  const dcs = [dailyDigestCard(), weeklyDigestCard("P0"),
               rankCard("Old1"), rankCard("Old2"), rankCard("Old3")];
  const out = T.chooseRankCards(dcs, moversList(25), []);
  const ranks = out.filter(c => c.type === "traderank");
  const digests = out.filter(c => c.type === "tradedigest");
  check("the digest's thin rank cards are replaced, not merged",
    ranks.length === 24 && !ranks.some(c => /^Old/.test(c.payload.player)),
    "got " + ranks.length);
  check("both digest cards survive untouched",
    digests.length === 2, "got " + digests.length);
  check("the daily digest card is still first in the list",
    out[0].payload.period === "the last 24 hours", out[0].payload.period);
}

{
  // The endpoint being down is the ordinary case. Everything must fall back.
  const withMovers = [weeklyDigestCard("P0"), rankCard("Old1")];
  const without = [weeklyDigestCard("P0"), rankCard("Old1")];
  const deals = repeat(MIN, () => [leg("Old1", "Phoenix", "Boston"),
                                   leg("Guard", "Boston", "Phoenix")]);
  const a = T.chooseRankCards(without, null, deals);
  check("with no worker, the digest's cards are kept and enriched from the sample",
    a.filter(c => c.type === "traderank").length === 1 &&
    a[1].payload.dests[0].team === "BOS" && a[1].payload.detail_full === undefined,
    JSON.stringify(a[1].payload.dests));
  T.chooseRankCards(withMovers, { by: {}, list: [] }, deals);
  check("an empty worker list is treated as no answer at all",
    withMovers[1].payload.detail_full === undefined);
}

{
  // Worker up, digest down. This is the failure the switch exists to survive:
  // no digest card means no hero, so number one becomes a rank card.
  const out = T.chooseRankCards([], moversList(25), []);
  check("with no digest at all, the worker alone fills the tab",
    out.length === 25 && out[0].payload.rank === 1 && out[0].payload.player === "P0",
    "got " + out.length);
}

{
  // A daily digest but no weekly one: the 24-hour hero is a different question
  // and must NOT be skipped from the weekly list.
  const out = T.chooseRankCards([dailyDigestCard()], moversList(25), []);
  const ranks = out.filter(c => c.type === "traderank");
  check("the 24-hour hero does not remove anyone from the 7-day list",
    ranks.length === 25, "got " + ranks.length);
}

{
  // Nulls and nonsense must not throw on a path that runs on every page load.
  T.chooseRankCards(null, null, null);
  T.chooseRankCards(undefined, { by: {}, list: null }, []);
  T.chooseRankCards([], { list: [{}, { player: "" }] }, []);
  check("malformed input does not throw", true);
}

console.log(failures ? "\n" + failures + " failure(s)" : "\nrank detail counts what it claims to count");
process.exit(failures ? 1 : 0);
