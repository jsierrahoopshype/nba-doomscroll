/* Reading a games file that may be one of two shapes, and telling a full
 * schedule from a playoffs-only subset.
 *
 * WHY THIS EXISTS
 *
 * build_races.mjs was written against a Games.csv shaped
 *
 *     gameId, gameDate, hometeamId, awayteamId, winner, gameType, ...
 *
 * and that file is no longer on the machine. What IS there is
 * Games_Playoffs_Since1946.csv - the identical schema, 4,398 rows, every one of
 * them a playoff game. The builder took it happily, because a playoffs-only
 * export is a perfectly valid CSV with all the right columns, and shipped a
 * race titled "All-time franchise wins" showing the Lakers on roughly 500 wins
 * instead of 3,500. Nothing errored. The two races came out byte-identical,
 * which was the only visible symptom.
 *
 * Two lessons are encoded here.
 *
 *   Match on what a file IS, not what it is called. The full schedule survives
 *   as the standard NBA game table, which holds the same facts under different
 *   column names - so the builder learns that schema rather than asking anyone
 *   to rename a file.
 *
 *   The property that matters is not in the filename, the columns or the
 *   modification time. It is whether the file contains regular-season games.
 *   So that is what gets checked, directly.
 */

import fs from "fs";

/** The original schema: everything stated outright. */
export const GAMES_COLUMNS = ["hometeamId", "awayteamId", "winner", "gameType"];

/** The NBA game table: the same facts, two of them encoded rather than stated. */
export const GAME_TABLE_COLUMNS = ["team_id_home", "team_id_away", "wl_home", "season_id"];

/* season_id is a five-digit code whose FIRST digit is the game type and whose
 * remaining four are the season year: 22022 is the 2022-23 regular season,
 * 42022 its playoffs. */
export const SEASON_ID_TYPE = {
  "1": "Pre Season",
  "2": "Regular Season",
  "3": "All-Star",
  "4": "Playoffs",
  "5": "Play-In"
};

/**
 * Does this file hold regular-season games, or only playoffs?
 *
 * Reads the head of the file rather than all of it. 400 rows is enough: a full
 * schedule is overwhelmingly regular season, so a non-playoff row turns up
 * immediately, while a playoffs-only file cannot produce one at any depth.
 *
 * @returns {boolean|null} null when unreadable or when neither type column is
 *   present - "unknown", which must not be confused with "no".
 */
export function hasRegularSeason(file, bytes = 262144, maxLines = 400) {
  let head = "";
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.slice(0, n).toString("utf8");
  } catch (e) { return null; }

  const lines = head.split(/\r?\n/).filter(l => l.trim()).slice(0, maxLines);
  if (lines.length < 2) return null;
  const cols = lines[0].split(",").map(s => s.trim().replace(/^"+|"+$/g, ""));
  const iType = cols.indexOf("gameType");
  const iSeason = cols.indexOf("season_id");
  if (iType < 0 && iSeason < 0) return null;

  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    if (iType >= 0) {
      const t = String(cells[iType] || "").trim().replace(/^"+|"+$/g, "");
      if (t && t !== "Playoffs") return true;
    } else {
      const s = String(cells[iSeason] || "").trim().replace(/^"+|"+$/g, "");
      if (s && s.charAt(0) !== "4") return true;
    }
  }
  return false;
}

/**
 * Map whichever schema arrived onto the one everything downstream reads.
 *
 * Twelve call sites read g.winner, g.gameType, g.hometeamId. Teaching all of
 * them about two schemas is how a builder becomes unmaintainable, so the
 * translation happens once, here.
 *
 * @returns {{rows: object[], schema: string, noResult: number}}
 * @throws when the file is neither schema - a wrong file is worth stopping for.
 */
export function normalizeGames(rows) {
  if (!rows.length) return { rows, schema: "empty", noResult: 0 };
  const head = rows[0];

  if ("hometeamId" in head && "winner" in head && "gameType" in head) {
    return { rows, schema: "games", noResult: 0 };
  }

  if ("team_id_home" in head && "wl_home" in head && "season_id" in head) {
    let noResult = 0;
    const out = rows.map(r => {
      /* A row with no W/L has no winner. Counted and reported rather than
       * silently treated as a loss for the home side, which would hand every
       * postponed and unplayed game to the away team. */
      const wl = String(r.wl_home || "").trim().toUpperCase();
      const winner = wl === "W" ? r.team_id_home : wl === "L" ? r.team_id_away : "";
      if (!winner) noResult++;
      return {
        gameId: r.game_id,
        gameDate: r.game_date,
        gameDateTimeEst: r.game_date,
        hometeamId: r.team_id_home,
        awayteamId: r.team_id_away,
        /* City is folded into the name here ("Los Angeles Lakers"), and the one
         * place that reads these joins city and name with a space - so an empty
         * city yields the right string instead of a doubled one. */
        hometeamCity: "",
        hometeamName: r.team_name_home,
        awayteamCity: "",
        awayteamName: r.team_name_away,
        winner: winner,
        gameType: SEASON_ID_TYPE[String(r.season_id || "").trim().charAt(0)] || "Regular Season"
      };
    });
    return { rows: out, schema: "game-table", noResult };
  }

  const err = new Error(
    "The games file has neither schema this builder understands.\n" +
    `  wanted either: ${GAMES_COLUMNS.join(", ")}\n` +
    `             or: ${GAME_TABLE_COLUMNS.join(", ")}\n` +
    `  found: ${Object.keys(head).slice(0, 12).join(", ")}`
  );
  err.code = "UNKNOWN_GAMES_SCHEMA";
  throw err;
}

/**
 * How much history does this file actually cover?
 *
 * WHY ROW COUNT AND NOT MODIFICATION TIME
 *
 * Two full schedules were found and the newer one won, which is how the build
 * lost ten seasons of champions: franchise-titles dropped from 75 steps to 65
 * and nothing said why, because both files are valid full schedules and the
 * tie-break was a date on a filesystem. Coverage is the property that decides
 * which of two schedules is better, so coverage is what gets measured.
 *
 * Reads the whole file - tens of MB, once per candidate, and only during the
 * search. The alternative is choosing between two files by a fact about
 * neither of them.
 *
 * @returns {{rows:number, from:string|null, to:string|null}}
 */
export function scheduleSpan(file) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch (e) { return { rows: 0, from: null, to: null }; }
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rows: 0, from: null, to: null };

  const cols = lines[0].split(",").map(s => s.trim().replace(/^"+|"+$/g, ""));
  /* Either schema names its date differently; season_id carries the year when
   * no usable date column is present. */
  let idx = cols.indexOf("gameDate");
  if (idx < 0) idx = cols.indexOf("game_date");
  const iSeason = cols.indexOf("season_id");

  let from = null, to = null;
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    let v = null;
    if (idx >= 0) {
      v = String(cells[idx] || "").trim().replace(/^"+|"+$/g, "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) v = null;
    } else if (iSeason >= 0) {
      const s = String(cells[iSeason] || "").trim().replace(/^"+|"+$/g, "");
      v = /^\d{5}$/.test(s) ? s.slice(1) : null;
    }
    if (!v) continue;
    if (from === null || v < from) from = v;
    if (to === null || v > to) to = v;
  }
  return { rows: lines.length - 1, from, to };
}
