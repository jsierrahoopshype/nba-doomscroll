/* Turning the league game log into game-table rows.
 *
 *     node tools/test_gamelog.mjs
 *
 * topup_games.mjs writes into a 65,000-row file that other tools on the machine
 * read. Everything in it that could put a wrong number there lives in
 * lib/gamelog.mjs, and this is what checks it - the script itself fetches on
 * start-up and cannot be imported.
 *
 * The fixtures below are shaped exactly like the API's answer: one row PER TEAM
 * per game, home and away told apart only by whether MATCHUP contains "@".
 */

import { GAME_TYPES, pairGames, rowWriter, missingSeasons, seasonLabel, csvCell }
  from "./lib/gamelog.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* A real pair, in the API's own field names. */
const home = {
  SEASON_ID: "22023", TEAM_ID: 1610612738, TEAM_ABBREVIATION: "BOS",
  TEAM_NAME: "Boston Celtics", GAME_ID: "0022300001", GAME_DATE: "2023-10-25T00:00:00",
  MATCHUP: "BOS vs. NYK", WL: "W", PTS: 108, REB: 44, AST: 25, FG_PCT: 0.451
};
const away = {
  SEASON_ID: "22023", TEAM_ID: 1610612752, TEAM_ABBREVIATION: "NYK",
  TEAM_NAME: "New York Knicks", GAME_ID: "0022300001", GAME_DATE: "2023-10-25T00:00:00",
  MATCHUP: "NYK @ BOS", WL: "L", PTS: 104, REB: 40, AST: 20, FG_PCT: 0.432
};

console.log("\npairing the two rows of a game");

{
  const { games, unpaired } = pairGames([away, home]);   // deliberately out of order
  ck("two rows become one game", games.length === 1 && !unpaired);
  ck("the 'vs.' row is home", games[0].home.TEAM_ABBREVIATION === "BOS",
     games[0].home.TEAM_ABBREVIATION);
  ck("the '@' row is away", games[0].away.TEAM_ABBREVIATION === "NYK",
     games[0].away.TEAM_ABBREVIATION);
}

{
  /* Half a game is not a game. Inventing the other side would write a
   * fictional result into a file about who beat whom. */
  const { games, unpaired } = pairGames([home]);
  ck("a game with one row is skipped, not guessed", games.length === 0 && unpaired === 1);
}

{
  const second = Object.assign({}, home, { GAME_ID: "0022300002" });
  const secondAway = Object.assign({}, away, { GAME_ID: "0022300002" });
  const { games } = pairGames([home, away, second, secondAway]);
  ck("two games stay two games", games.length === 2);
  ck("empty input does not throw", pairGames([]).games.length === 0);
  ck("undefined input does not throw", pairGames().games.length === 0);
}

console.log("\nfilling a row in the destination file's own columns");

{
  /* The real schema's shape, including two columns the API has no answer for. */
  const cols = ["season_id", "team_id_home", "team_abbreviation_home", "team_name_home",
                "game_id", "game_date", "matchup_home", "wl_home", "pts_home", "fg_pct_home",
                "team_id_away", "team_name_away", "wl_away", "pts_away",
                "season_type", "min", "video_available_home"];
  const w = rowWriter(cols);
  const cells = w.row({ home, away }, "2", 2023).split(",");
  const at = name => cells[cols.indexOf(name)];

  ck("season_id is rebuilt from the type digit and the season",
     at("season_id") === "22023", at("season_id"));
  ck("the home side's stats come off the home row",
     at("pts_home") === "108" && at("team_name_home") === "Boston Celtics",
     at("pts_home") + " / " + at("team_name_home"));
  ck("the away side's come off the away row",
     at("pts_away") === "104" && at("wl_away") === "L",
     at("pts_away") + " / " + at("wl_away"));
  ck("the date is trimmed to a day", at("game_date") === "2023-10-25", at("game_date"));
  ck("season_type is spelled out", at("season_type") === "Regular Season", at("season_type"));
  ck("a decimal survives", at("fg_pct_home") === "0.451", at("fg_pct_home"));

  /* The two the API cannot answer: reported, not invented. */
  ck("an unmatched column is empty", at("min") === "" && at("video_available_home") === "");
  ck("and is named in unfilled",
     w.unfilled.has("min") && w.unfilled.has("video_available_home"),
     [...w.unfilled].join(","));
  ck("a column it DID fill is not in unfilled", !w.unfilled.has("pts_home"));
  ck("the row has exactly one cell per column", cells.length === cols.length,
     cells.length + " vs " + cols.length);

  const playoff = rowWriter(cols).row({ home, away }, "4", 2023).split(",");
  ck("a playoff row gets the 4 digit and the right label",
     playoff[0] === "42023" && playoff[cols.indexOf("season_type")] === "Playoffs",
     playoff[0]);
}

{
  /* A team name with a comma would break the file silently. */
  ck("a comma is quoted", csvCell("Portland, Oregon") === '"Portland, Oregon"',
     csvCell("Portland, Oregon"));
  ck("a quote is doubled", csvCell('He said "no"') === '"He said ""no"""', csvCell('He said "no"'));
  ck("a plain value is left alone", csvCell("BOS") === "BOS");
  ck("null becomes empty, not the word null", csvCell(null) === "");
  ck("zero survives as zero", csvCell(0) === "0");
}

console.log("\nwhich seasons are missing");

{
  const have = new Set([2020, 2021, 2022]);

  /* A season is labelled by the year it STARTS. In September 2026 the last
   * finished season is 2025-26, so three are missing. */
  ck("September 2026 wants 2023, 2024, 2025",
     missingSeasons(have, new Date(Date.UTC(2026, 8, 7))).join(",") === "2023,2024,2025",
     missingSeasons(have, new Date(Date.UTC(2026, 8, 7))).join(","));

  /* THE ONE WORTH HAVING. In March 2026 the 2025-26 season is still being
   * played. Taking the calendar year outright would ask the API for 2026-27,
   * which has not happened, and get an empty answer indistinguishable from a
   * failed fetch. */
  ck("March 2026 stops at 2024, because 2025-26 is still being played",
     missingSeasons(have, new Date(Date.UTC(2026, 2, 1))).join(",") === "2023,2024",
     missingSeasons(have, new Date(Date.UTC(2026, 2, 1))).join(","));

  ck("July is the turn: the season just finished counts",
     missingSeasons(have, new Date(Date.UTC(2026, 6, 1))).join(",") === "2023,2024,2025");

  ck("a file already up to date asks for nothing",
     missingSeasons(new Set([2024, 2025]), new Date(Date.UTC(2026, 8, 7))).length === 0);
  ck("a file AHEAD of the clock asks for nothing rather than counting backwards",
     missingSeasons(new Set([2030]), new Date(Date.UTC(2026, 8, 7))).length === 0);
  ck("no seasons on file asks for nothing", missingSeasons(new Set(), new Date()).length === 0);
}

{
  ck("the season label is the API's own form", seasonLabel(2023) === "2023-24", seasonLabel(2023));
  ck("and it survives the century roll", seasonLabel(1999) === "1999-00", seasonLabel(1999));
  ck("pre-season and All-Star are not among the types",
     GAME_TYPES.every(t => t.digit !== "1" && t.digit !== "3"),
     GAME_TYPES.map(t => t.api).join(", "));
}

console.log(fail ? "\n" + fail + " failure(s)" : "\nrows land in the right columns, on the right side");
process.exit(fail ? 1 : 0);
