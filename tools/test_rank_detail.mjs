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
  " RANK_DETAIL_MIN: RANK_DETAIL_MIN };");

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

console.log(failures ? "\n" + failures + " failure(s)" : "\nrank detail counts what it claims to count");
process.exit(failures ? 1 : 0);
