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

console.log(failures ? "\n" + failures + " failure(s)" : "\nrank detail counts what it claims to count");
process.exit(failures ? 1 : 0);
