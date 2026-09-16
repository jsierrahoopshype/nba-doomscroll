/* Records that stood, and the season that ended them.
 *
 * WHY THIS FAMILY EXISTS
 *
 * The History vault is 82% on-this-day cards, and Jorge's verdict was that only
 * the Media Lean videos in there are worth reading. "A game happened on this
 * date" is a fact; it is not a surprise. A record with a DURATION is: 69 wins
 * stood for twenty-four seasons, and the sentence carries both the number and
 * the wait.
 *
 * WHAT A RECORD NEEDS BEFORE IT CAN BE CLAIMED
 *
 * A season the game log covers only partly understates every team's wins in it,
 * which would either hide a real record or invent one that was never set. So a
 * season counts only when the team played about as many games as the rest of
 * the league did that year - the same median-and-slack test the payroll cards
 * use, from lib/payroll_wins.mjs, rather than a second opinion about what a
 * full season looks like.
 *
 * A record also cannot be claimed from the first season in the file. The 1946-47
 * champion did not "set" a record; it is simply the earliest thing here. The
 * first season establishes the mark to beat and emits nothing, which is the
 * difference between a record and a starting value.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * No scoring or margin records. The normalised game row carries the winner and
 * the date but not the points, and a record about points computed from a file
 * that does not contain points is the Raptors-in-43-seasons mistake with a
 * different number in it.
 */

import { medianGpByYear, GP_SLACK } from "./payroll_wins.mjs";

/** Teams whose season the log covers fully enough to count.
 *
 * TWO TESTS, NOT ONE. `gp` against the league's median for that year answers
 * "did this team play a full schedule"; wins-plus-losses against `gp` answers
 * "does the file say how those games ended". A team can pass the first and fail
 * the second - the tally counts a row with no recorded winner in `gp` and in
 * neither result column, which is the honest shape and also a way to understate
 * a win total by exactly as many games as the file is missing results for.
 *
 * requireResults is off for a tally whose `w` is not a win count, which is what
 * streaksAsTally() produces: the longest run inside a season is never close to
 * the number of games in it.
 */
function fullSeasons(tally, requireResults) {
  const median = medianGpByYear(tally);
  const byYear = new Map();
  for (const rec of tally.values()) {
    const want = median.get(rec.year);
    if (!want) continue;
    if (!rec.gp || rec.gp < want - GP_SLACK) continue;
    if (requireResults && (rec.w || 0) + (rec.l || 0) < rec.gp - GP_SLACK) continue;
    if (!byYear.has(rec.year)) byYear.set(rec.year, []);
    byYear.get(rec.year).push(rec);
  }
  return byYear;
}

/**
 * The progression of a season-level maximum: who held it, for how long, and who
 * took it.
 *
 * @param {Map} tally  lib/payroll_wins.mjs tallyTeamSeasons() output
 * @param {object} [opts]
 *        value(rec) -> number         what is being maximised (default wins).
 *                                     NOT called valueOf: every object already
 *                                     has one from Object.prototype, so
 *                                     `opts.valueOf || fallback` picks up the
 *                                     prototype's and the default never runs.
 *        minStood: seasons a record must survive to be worth a card (default 5)
 *        requireResults: demand the file say how the games ended (default true;
 *                        false for a streak tally, whose `w` is a run length)
 * @returns {{ records: Array, standing: object|null, seasons: number }}
 *   records: [{ holder, wins, year, stood, breaker, brokenYear, brokenWins }]
 *            one per record that was BEATEN, oldest first
 *   standing: the current holder, which nobody has beaten yet
 */
export function recordProgression(tally, opts) {
  const o = Object.assign({ minStood: 5, requireResults: true }, opts || {});
  const value = typeof o.value === "function" ? o.value : (rec => rec.w || 0);
  const byYear = fullSeasons(tally || new Map(), o.requireResults !== false);
  const years = [...byYear.keys()].sort((a, b) => a - b);

  const records = [];
  let best = null;                 // { rec, value, year }
  for (const year of years) {
    /* One holder per season: the best of that year's teams. A tie keeps the
     * incumbent, because equalling a record is not breaking it. */
    let top = null;
    for (const rec of byYear.get(year)) {
      const v = value(rec);
      if (!top || v > top.value) top = { rec, value: v, year };
    }
    if (!top) continue;
    if (!best) { best = top; continue; }   // the earliest season sets the mark
    if (top.value <= best.value) continue;

    records.push({
      holder: best.rec, value: best.value, year: best.year,
      stood: year - best.year,
      breaker: top.rec, brokenYear: year, brokenValue: top.value
    });
    best = top;
  }

  return {
    records: records.filter(r => r.stood >= o.minStood),
    standing: best ? { holder: best.rec, value: best.value, year: best.year } : null,
    seasons: years.length
  };
}

/**
 * The longest run of consecutive wins inside one season, per team.
 *
 * Streaks are computed from the games themselves rather than from the tally,
 * because a tally knows how many a team won and not in what order. Games are
 * grouped by team and season and walked in date order.
 *
 * @param {Array} rows  normalised game rows: { gameDate, hometeamId,
 *                      awayteamId, winner, gameType }
 * @param {function} seasonOf  (dateString) -> season end year
 * @param {function} [nameOf]  (teamId) -> a display name, when the caller has one
 * @returns {Map} key "team|year" -> { team, year, streak, from, to, games }
 */
export function seasonStreaks(rows, seasonOf, nameOf) {
  const bySeason = new Map();      // "team|year" -> [{date, won}]
  for (const r of (rows || [])) {
    if (!r || r.gameType !== "Regular Season") continue;
    const date = String(r.gameDate || "").slice(0, 10);
    if (!date) continue;
    const year = seasonOf(date);
    if (!year) continue;
    for (const side of ["hometeamId", "awayteamId"]) {
      const team = r[side];
      if (!team) continue;
      /* A game with no recorded winner breaks nothing and wins nothing: it is
       * absent from the sequence rather than counted as a loss, which would end
       * a streak that was never actually ended. */
      if (!r.winner) continue;
      const key = team + "|" + year;
      if (!bySeason.has(key)) bySeason.set(key, []);
      bySeason.get(key).push({ date, won: String(r.winner) === String(team), team, year });
    }
  }

  const out = new Map();
  for (const [key, games] of bySeason) {
    games.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    let run = 0, bestRun = 0, bestFrom = null, bestTo = null, runFrom = null;
    for (const g of games) {
      if (g.won) {
        if (run === 0) runFrom = g.date;
        run++;
        if (run > bestRun) { bestRun = run; bestFrom = runFrom; bestTo = g.date; }
      } else {
        run = 0;
      }
    }
    const [team, year] = key.split("|");
    out.set(key, {
      team, year: parseInt(year, 10), streak: bestRun,
      from: bestFrom, to: bestTo, games: games.length,
      name: nameOf ? nameOf(team) : null
    });
  }
  return out;
}

/** A streak tally in the shape recordProgression() expects. */
export function streaksAsTally(streaks) {
  const tally = new Map();
  for (const [key, s] of streaks) {
    tally.set(key, {
      code: s.team, team: s.team, year: s.year,
      w: s.streak, l: 0, gp: s.games,
      /* Carried so a card can name the dates the run covered. */
      from: s.from, to: s.to, name: s.name
    });
  }
  return tally;
}
