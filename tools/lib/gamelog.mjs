/* Turning stats.nba.com's league game log into rows of the NBA game table.
 *
 * Lifted out of tools/topup_games.mjs so it can be tested without the network:
 * that script fetches on start-up, which makes every rule inside it untestable
 * in place. This is the part with rules in it.
 *
 * WHAT THE API RETURNS
 *
 * leaguegamelog with PlayerOrTeam=T answers one row PER TEAM PER GAME - two
 * rows for every game, each with that team's own box score. The game table
 * wants one row per game with both sides on it, so the two have to be paired
 * and a home/away decision made.
 *
 * MATCHUP is what decides it. "BOS vs. LAL" is the home team's row; "BOS @ LAL"
 * is the away team's. There is no other field that says so.
 */

/** The type digit each season type takes in season_id, matching SEASON_ID_TYPE
 * in lib/games.mjs. Pre-season and All-Star are deliberately absent: these rows
 * feed win counts, and neither is a real win. */
export const GAME_TYPES = [
  { api: "Regular Season", digit: "2" },
  { api: "Playoffs",       digit: "4" },
  { api: "PlayIn",         digit: "5" }
];

/**
 * Pair the two team rows of each game.
 *
 * A game with only one row is SKIPPED and counted, never guessed at. One side
 * missing means the log is incomplete for that game, and inventing an opponent
 * would put a fictional result into a file about who beat whom.
 *
 * @param {object[]} rows  API rows, each with GAME_ID and MATCHUP
 * @returns {{games: {home: object, away: object}[], unpaired: number}}
 */
export function pairGames(rows) {
  const byGame = new Map();
  for (const r of rows || []) {
    if (!r || !r.GAME_ID) continue;
    if (!byGame.has(r.GAME_ID)) byGame.set(r.GAME_ID, {});
    /* "@" means this team is away. Checked on "@" rather than "vs." because
     * only one of the two spellings has ever varied. */
    const slot = String(r.MATCHUP || "").includes("@") ? "away" : "home";
    byGame.get(r.GAME_ID)[slot] = r;
  }
  const games = [];
  let unpaired = 0;
  for (const g of byGame.values()) {
    if (g.home && g.away) games.push(g); else unpaired++;
  }
  return { games, unpaired };
}

/**
 * Build a row writer for one particular file's column list.
 *
 * COLUMNS ARE MATCHED, NOT ASSUMED. The game table is almost entirely stats
 * carrying a _home or _away suffix, and under the suffix the name is the API's
 * own: pts_home -> PTS on the home row, team_id_away -> TEAM_ID on the away
 * row, wl_home -> WL. So the rule is one line, and it covers the whole schema
 * without a hand-written map to fall out of date.
 *
 * A column that matches nothing is left EMPTY and recorded in `unfilled`.
 * Guessing at it would put a wrong number in a file that looks authoritative;
 * filling it blank without saying so would hide that from whoever reads the
 * file next. Both are worse than an empty cell and a list.
 *
 * @param {string[]} cols  the destination file's header, in order
 * @returns {{row: function, unfilled: Set<string>}}
 */
export function rowWriter(cols) {
  const unfilled = new Set();

  function value(col, game, digit, seasonStart) {
    const lc = col.toLowerCase();
    if (lc === "season_id") return digit + seasonStart;
    if (lc === "game_id") return game.home.GAME_ID;
    if (lc === "game_date") return String(game.home.GAME_DATE || "").slice(0, 10);
    if (lc === "season_type") {
      const t = GAME_TYPES.find(x => x.digit === digit);
      return t ? t.api : "";
    }

    var side = null, stat = null;
    if (lc.endsWith("_home")) { side = game.home; stat = lc.slice(0, -5); }
    else if (lc.endsWith("_away")) { side = game.away; stat = lc.slice(0, -5); }
    if (!side) { unfilled.add(col); return ""; }

    const key = stat.toUpperCase();
    if (key in side) return side[key];
    unfilled.add(col);
    return "";
  }

  return {
    unfilled,
    /** One CSV line, in the destination file's own column order. */
    row: function (game, digit, seasonStart) {
      return cols.map(c => csvCell(value(c, game, digit, seasonStart))).join(",");
    }
  };
}

/** Quote a cell only when it needs it, the way the source file does. */
export function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Season start years the file does not have, up to the last FINISHED season.
 *
 * Two off-by-ones live here and the first version of this had one of them.
 *
 * A season is labelled by the year it STARTS: 2025-26 is "2025". It runs from
 * October to the following June. So the last season that has actually been
 * played is:
 *
 *     July onwards      this year minus 1   (Sept 2026 -> 2025-26, finished)
 *     January to June    this year minus 2   (March 2026 -> 2024-25; the
 *                                             2025-26 season is still running)
 *
 * Asking for the season currently being played, or one that has not started,
 * gets an empty answer from the API - which is indistinguishable from a fetch
 * that failed, and would be reported as a failure on a run that was fine.
 *
 * June is counted as unfinished. The Finals end mid-month and there is no
 * version of this that is right on the 12th and wrong on the 10th; a season
 * arriving three weeks late is better than a half-season arriving on time.
 *
 * @param {Set<number>|number[]} have  season start years already in the file
 * @param {Date} now
 */
export function missingSeasons(have, now) {
  const set = have instanceof Set ? have : new Set(have || []);
  if (!set.size) return [];
  const last = Math.max(...set);
  const d = now || new Date();
  const month = d.getUTCMonth() + 1;
  const lastFinished = d.getUTCFullYear() - (month >= 7 ? 1 : 2);
  const out = [];
  for (let y = last + 1; y <= lastFinished; y++) out.push(y);
  return out;
}

/** "2023-24", the form the API wants. */
export const seasonLabel = y => y + "-" + String(y + 1).slice(2);
