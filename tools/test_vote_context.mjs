/* Does a "first Clipper since" claim survive contact with the data?
 *
 *     node tools/test_vote_context.mjs
 *
 * These cards make historical claims, which is a different kind of risk from
 * the arithmetic cards. "The first Clippers player to get an MVP vote since
 * 2013" is either true or it is a fabrication, and there is no rounding error
 * in between. Every case below is one that would produce a false claim.
 */

import {
  seasonEndYear, teamByPlayerSeason, voteHistory, teamVoteDrought,
  MIN_GAP, MIN_WINDOW
} from "./lib/vote_context.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};
const code = t => String(t).toUpperCase();

console.log("\nreading a season label");

ck("2023-24 is 2024", seasonEndYear("2023-24") === 2024);
ck("2023-2024 is 2024", seasonEndYear("2023-2024") === 2024);
ck("a bare 2024 is 2024", seasonEndYear("2024") === 2024);
ck("1999-00 is 2000", seasonEndYear("1999-00") === 2000, String(seasonEndYear("1999-00")));
/* A label whose halves are not one season apart is not a season. Accepting it
 * would date a claim to a year the data never described. */
ck("2023-25 is refused", seasonEndYear("2023-25") === null);
ck("2020-2024 is refused", seasonEndYear("2020-2024") === null);
ck("junk is refused", seasonEndYear("last year") === null);
ck("empty is refused", seasonEndYear("") === null);
ck("undefined does not throw", seasonEndYear() === null);

console.log("\nwhose team was it, when he played for two");

{
  const rows = [
    { PLAYER: "A Player", YEAR: "2024", TEAM: "BOS", GP: 60 },
    { PLAYER: "A Player", YEAR: "2024", TEAM: "LAC", GP: 20 },
    { PLAYER: "B Player", YEAR: "2024", TEAM: "LAC", GP: 82 }
  ];
  const t = teamByPlayerSeason(rows, code);
  ck("the plurality of games wins", t.get("A Player|2024") === "BOS", t.get("A Player|2024"));
  ck("a single team is straightforward", t.get("B Player|2024") === "LAC");
}

{
  /* A dead heat means nobody can say which franchise the season belonged to.
   * Guessing here would put a vote on the wrong team, which is the one error
   * that makes the whole card a lie rather than merely dull. */
  const t = teamByPlayerSeason([
    { PLAYER: "Split Season", YEAR: "2024", TEAM: "BOS", GP: 41 },
    { PLAYER: "Split Season", YEAR: "2024", TEAM: "LAC", GP: 41 }
  ], code);
  ck("an exact tie yields no team at all", t.get("Split Season|2024") === undefined);
}

{
  /* TOT is a season total row. It would beat every real team on games played
   * and win every tie, so a traded player's team would always be "TOT". */
  const t = teamByPlayerSeason([
    { PLAYER: "Traded Man", YEAR: "2024", TEAM: "TOT", GP: 82 },
    { PLAYER: "Traded Man", YEAR: "2024", TEAM: "BOS", GP: 50 },
    { PLAYER: "Traded Man", YEAR: "2024", TEAM: "LAC", GP: 32 }
  ], code);
  ck("a TOT row is not a team", t.get("Traded Man|2024") === "BOS", t.get("Traded Man|2024"));
  ck("2TM is not a team either",
     teamByPlayerSeason([{ PLAYER: "X", YEAR: "2024", TEAM: "2TM", GP: 82 }], code).size === 0);
}

ck("no rows does not throw", teamByPlayerSeason([], code).size === 0);
ck("undefined rows does not throw", teamByPlayerSeason(undefined, code).size === 0);

console.log("\nthe drought itself");

/* A tracker covering 2012 to 2024, thirteen seasons. LAC got a vote in 2013
 * and not again until 2024. BOS gets one most years. SAC never. */
const YEARS = [];
for (let y = 2012; y <= 2024; y++) YEARS.push(y);

const stats = [];
const seasons = [];
for (const y of YEARS) {
  const players = ["Boston Man " + y];
  stats.push({ PLAYER: "Boston Man " + y, YEAR: String(y), TEAM: "BOS", GP: 82 });
  if (y === 2013) {
    players.push("Clipper Man 2013");
    stats.push({ PLAYER: "Clipper Man 2013", YEAR: "2013", TEAM: "LAC", GP: 82 });
  }
  if (y === 2024) {
    players.push("Clipper Man 2024");
    stats.push({ PLAYER: "Clipper Man 2024", YEAR: "2024", TEAM: "LAC", GP: 82 });
  }
  seasons.push({ award: "Most Valuable Player", season: (y - 1) + "-" + String(y).slice(2), players });
}
const teamOf = teamByPlayerSeason(stats, code);
const hist = voteHistory(seasons, teamOf);

{
  const h = hist.get("Most Valuable Player");
  ck("the window is the seasons the data holds",
     h.years[0] === 2012 && h.years[h.years.length - 1] === 2024,
     h.years[0] + "-" + h.years[h.years.length - 1]);
  ck("BOS appears in every season", h.teamYears.get("BOS").size === 13);
  ck("LAC appears in exactly two", h.teamYears.get("LAC").size === 2);
  ck("a team with no votes is absent entirely", !h.teamYears.has("SAC"));
}

{
  const d = teamVoteDrought(hist, "Most Valuable Player", "LAC", 2024);
  ck("LAC in 2024 is a drought", !!d);
  ck("and it is a since, not a never", d.kind === "first-since", d && d.kind);
  ck("the gap counts SEASONS COVERED, not calendar years", d.gap === 10, d && String(d.gap));
  ck("it names the year it broke", d.sinceYear === 2013, d && String(d.sinceYear));
  ck("and who it was", d.sincePlayers[0] === "Clipper Man 2013", d && d.sincePlayers.join());
}

{
  /* A team that never appears, over a long enough window, is the stronger
   * card - but it must be phrased as "in the seasons covered", never as
   * "ever", which this data cannot support. The result says which. */
  stats.push({ PLAYER: "King Man 2024", YEAR: "2024", TEAM: "SAC", GP: 82 });
  const s2 = seasons.map(s => s.season.endsWith("24")
    ? { ...s, players: s.players.concat(["King Man 2024"]) } : s);
  const h2 = voteHistory(s2, teamByPlayerSeason(stats, code));
  const d = teamVoteDrought(h2, "Most Valuable Player", "SAC", 2024);
  ck("a first-ever-in-window is reported as such", d && d.kind === "first-in-window", d && d.kind);
  ck("it carries the window so the card cannot overclaim",
     d && d.windowFrom === 2012 && d.seasonsCovered === 12,
     d && d.windowFrom + " + " + d.seasonsCovered);
  ck("and no since-year to accidentally print", d && d.sinceYear === null);
}

{
  ck("BOS every season is not a drought",
     teamVoteDrought(hist, "Most Valuable Player", "BOS", 2024) === null);
  /* LAC in 2013 had no prior appearance, but the window before it is one
   * season - far too short to claim anything. */
  ck("a claim needs a window BEFORE the season, not just around it",
     teamVoteDrought(hist, "Most Valuable Player", "LAC", 2013) === null);
}

{
  const short = voteHistory(seasons.slice(-4), teamOf);
  ck(`a window under ${MIN_WINDOW} seasons yields nothing at all`,
     teamVoteDrought(short, "Most Valuable Player", "LAC", 2024) === null);
}

{
  /* Gap exactly at the threshold fires; one less does not.
   *
   * The gap is the covered seasons BETWEEN two appearances, both ends
   * excluded: 2018 and then 2024 means 2019 through 2023 went without one,
   * which is five. So the earlier appearance sits at 2024 - (gap + 1).
   *
   * The first version of this fixture put it at 2024 - gap and the test
   * failed. Worth keeping the note: the off-by-one was in the fixture, not
   * the code, and an off-by-one here is a card claiming the wrong number of
   * years. */
  const mk = gapYears => {
    const st = [], ss = [];
    for (const y of YEARS) {
      st.push({ PLAYER: "B" + y, YEAR: String(y), TEAM: "BOS", GP: 82 });
      const players = ["B" + y];
      if (y === 2024 - (gapYears + 1) || y === 2024) {
        players.push("C" + y);
        st.push({ PLAYER: "C" + y, YEAR: String(y), TEAM: "LAC", GP: 82 });
      }
      ss.push({ award: "MVP", season: String(y), players });
    }
    return voteHistory(ss, teamByPlayerSeason(st, code));
  };
  const at = teamVoteDrought(mk(MIN_GAP), "MVP", "LAC", 2024);
  ck(`a gap of ${MIN_GAP} fires`, !!at, at && "gap " + at.gap);
  ck("and reports exactly that gap", at && at.gap === MIN_GAP, at && String(at.gap));
  ck(`a gap of ${MIN_GAP - 1} does not`,
     teamVoteDrought(mk(MIN_GAP - 1), "MVP", "LAC", 2024) === null);
}

{
  ck("an unknown award yields nothing", teamVoteDrought(hist, "Nope", "LAC", 2024) === null);
  ck("an unknown team over a long window is a first-in-window",
     (teamVoteDrought(hist, "Most Valuable Player", "MIA", 2024) || {}).kind === "first-in-window");
  ck("no history does not throw", teamVoteDrought(new Map(), "MVP", "LAC", 2024) === null);
  ck("undefined history does not throw", teamVoteDrought(undefined, "MVP", "LAC", 2024) === null);
  ck("a player whose team is unknown contributes nothing",
     voteHistory([{ award: "X", season: "2024", players: ["Ghost"] }], teamOf)
       .get("X").teamYears.size === 0);
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a historical claim here would be a fabrication"
                 : "every drought claim carries the window it was measured over");
process.exit(fail ? 1 : 0);
