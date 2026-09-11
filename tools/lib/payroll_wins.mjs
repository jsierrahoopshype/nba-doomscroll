/* Joining a payroll to what it won.
 *
 * WHY THIS IS A LIBRARY AND NOT INLINE IN THE BUILDER
 *
 * Cost per win is a division, and the builder that would do it cannot be run
 * on the machine that writes this: salaries.json, the cap table and the games
 * CSV all live on Jorge's desktop. So the arithmetic and the joins live here,
 * as pure functions over plain objects, and tools/test_payroll_wins.mjs checks
 * them against fixtures. What ships is tested even though the data it will run
 * on has never been seen here.
 *
 * THE JOIN, AND WHY IT IS ON THE CITY
 *
 * salaries.json names a team by its city ("Seattle", "New Jersey", "LA
 * Lakers"). The games file names it by city and nickname at the time
 * ("Seattle SuperSonics"). Both therefore describe the team AS IT WAS THAT
 * SEASON, which is exactly what a payroll-to-wins join needs: put both through
 * the same normaliser and the Sonics match the Sonics without anyone writing a
 * relocation table. A franchise-id join would have been wrong here - it would
 * hand Seattle's 1996 payroll to Oklahoma City.
 *
 * Charlotte is the only city two franchises share (Hornets to 2002, Bobcats
 * from 2005, Hornets again from 2015). They never overlap, so city-and-season
 * is still unique.
 *
 * WHY THERE IS NO TABLE OF SEASON LENGTHS
 *
 * A joined season is only usable if the team really played a full schedule in
 * the file. The obvious check is a hand-written map of games per season - 82,
 * except 50 in 1999, 66 in 2012, the COVID stoppage, the 72-game 2021 - and
 * every entry in it is a chance to be quietly wrong about someone else's data.
 *
 * So the expected length is MEASURED from the file instead: the median games
 * played across every team in that same season. Lockouts, the bubble and any
 * future oddity calibrate themselves, and a team the file only half covers
 * stands out against its own peers rather than against my memory.
 */

/** Season-ending year for a game date. 1946-11-01 is season 1947.
 *
 * The 2020 bubble is the one place the month rule breaks: that season
 * restarted in July and its Finals ended on 11 October 2020, so "August or
 * later means next season" would push every restart game into 2021 and cost
 * the Lakers their title. Same exception build_races.mjs carries, for the same
 * reason.
 */
export function seasonEndYear(dateStr) {
  const d = String(dateStr || "");
  const y = parseInt(d.slice(0, 4), 10), m = parseInt(d.slice(5, 7), 10);
  if (!y) return null;
  if (y === 2020 && m >= 7 && m <= 10) return 2020;
  return m >= 8 ? y + 1 : y;
}

/** Wins, losses and playoff appearances per team-season.
 *
 * @param {Array} games   rows as normalizeGames leaves them: hometeamId,
 *                        awayteamId, winner, gameType, hometeamCity/Name
 * @param {(row:object, side:"home"|"away") => string|null} codeOf
 *        the caller's own team normaliser, so the salary side and this side
 *        cannot disagree about what a team is called
 * @returns {Map<string, object>} "CODE|YEAR" -> { code, year, w, l, gp, poGp }
 */
export function tallyTeamSeasons(games, codeOf) {
  const out = new Map();
  for (const g of (games || [])) {
    const year = seasonEndYear(g.gameDate || g.gameDateTimeEst);
    if (!year) continue;
    const type = String(g.gameType || "Regular Season");
    /* Pre-season and All-Star games are not results anyone means by "wins".
     * Play-In counts as neither: it decides a playoff berth and its games are
     * in the standings nowhere, so it is left out of both tallies rather than
     * folded into whichever looked convenient. */
    const reg = type === "Regular Season";
    const po = type === "Playoffs";
    if (!reg && !po) continue;

    for (const side of ["home", "away"]) {
      const code = codeOf(g, side);
      if (!code) continue;
      const key = code + "|" + year;
      if (!out.has(key)) out.set(key, { code, year, w: 0, l: 0, gp: 0, poGp: 0 });
      const rec = out.get(key);
      if (po) { rec.poGp++; continue; }
      rec.gp++;
      /* A row with no winner is a game with no result - postponed, or missing
       * from the file. Counted in neither column, so wins plus losses can be
       * short of games played, which is the honest shape. */
      const id = String(g[side + "teamId"] || "");
      const win = String(g.winner || "");
      if (!win) continue;
      if (win === id) rec.w++; else rec.l++;
    }
  }
  return out;
}

/** Median games played per season, taken from the tally itself. */
export function medianGpByYear(tally) {
  const byYear = new Map();
  for (const rec of tally.values()) {
    if (!byYear.has(rec.year)) byYear.set(rec.year, []);
    byYear.get(rec.year).push(rec.gp);
  }
  const out = new Map();
  for (const [year, list] of byYear) {
    list.sort((a, b) => a - b);
    const mid = Math.floor(list.length / 2);
    out.set(year, list.length % 2 ? list[mid] : Math.round((list[mid - 1] + list[mid]) / 2));
  }
  return out;
}

/** How short of its peers may a team-season be and still be usable?
 *
 * Three games. A handful of NBA games have been cancelled outright rather than
 * rescheduled, so an exact match is too strict; a team missing a tenth of its
 * schedule in the file is a coverage gap and its cost per win would be
 * flattering by that much. */
export const GP_SLACK = 3;

/**
 * Join vetted payrolls to the tally.
 *
 * Nothing here invents a number. A payroll with no matching season, or one
 * whose games played is short of that season's median, comes back in its own
 * list so the builder can report it instead of shipping a card about it.
 *
 * Three separate reasons a payroll does not become a card, kept apart because
 * they mean different things and one bucket for all of them made the build log
 * lie: it reported five team-seasons as absent from a game log that had them
 * perfectly well - they had gone winless.
 *
 * @param {Array} payrolls  { team, year, total, cap, ofCap, men } - the set
 *                          build_salary.mjs has ALREADY vetted against
 *                          MIN_PAYROLL_OF_CAP. Passing the unvetted set would
 *                          divide a book that is missing players.
 * @returns {{joined:Array, missing:Array, winless:Array, shortSchedule:Array}}
 */
export function joinPayrollWins(payrolls, tally) {
  const median = medianGpByYear(tally);
  const joined = [], missing = [], winless = [], shortSchedule = [];

  for (const p of (payrolls || [])) {
    const rec = tally.get(p.team + "|" + p.year);
    if (!rec) { missing.push(p); continue; }
    const want = median.get(p.year) || 0;
    if (want && rec.gp < want - GP_SLACK) {
      shortSchedule.push(Object.assign({}, p, { gp: rec.gp, expected: want }));
      continue;
    }
    /* No wins is not no data. A cost per win needs a denominator, so there is
     * no card here either way, but the two are reported apart. */
    if (!rec.w) { winless.push(Object.assign({}, p, { gp: rec.gp, l: rec.l })); continue; }
    joined.push({
      team: p.team, year: p.year, total: p.total, cap: p.cap, ofCap: p.ofCap,
      men: p.men, w: rec.w, l: rec.l, gp: rec.gp,
      /* Playoff games in the file is the only evidence here of a berth. A team
       * with none did not play any, which for a season the file covers fully
       * means it missed - but the CALLER must confirm the file covers playoffs
       * for that year at all, or every season becomes a "miss". */
      poGp: rec.poGp,
      madePlayoffs: rec.poGp > 0,
      costPerWin: p.total / rec.w,
      capPerWin: p.cap ? (p.total / rec.w) / p.cap : null
    });
  }
  return { joined, missing, winless, shortSchedule };
}

/** Which seasons does the file cover playoffs for?
 *
 * "No playoff games" and "no playoff games IN THIS FILE" look identical from a
 * single team-season, and confusing them turns a full season of also-rans into
 * thirty teams that all missed the playoffs. A season is only usable for a
 * missed-the-playoffs card if some team in it played a playoff game.
 */
export function playoffYears(tally) {
  const years = new Set();
  for (const rec of tally.values()) if (rec.poGp > 0) years.add(rec.year);
  return years;
}

/** Cross-era cost per win, in cap terms: what fraction of that season's cap
 * the team spent per win. Raw dollars per win cannot be compared across 1993
 * and 2026 and a card that ranked them would be a card about inflation. */
export function capCostPerWin(rec) {
  return rec.cap && rec.w ? (rec.total / rec.cap) / rec.w : null;
}

/**
 * What every team in the league paid per win, that season.
 *
 * WHY THIS EXISTS
 *
 * A card went out reading "Every win cost New York $4.39M in 2005-06.
 * $100.9M for 23 wins, or 8.86% of that season's cap per win." Jorge's note
 * was the one he has now made three times: "Every time give more context. Was
 * the cost of victory the highest of any team? Give me how much it cost each
 * team."
 *
 * He is right that the number alone is inert. $4.39M a win means nothing until
 * you know that the median team that season paid a fifth of it, and that the
 * team with the best record paid less still. A figure with no field around it
 * is a figure a reader has to take on trust.
 *
 * THE COVERAGE GATE IS THE POINT OF THE FUNCTION
 *
 * "The most expensive win in the league that season" is a claim about thirty
 * teams. If twenty-six of them joined, it is a claim about the file, which is
 * the same class of error as telling the Raptors they went 43 seasons without
 * a Defensive Player of the Year vote. So the league's actual size comes from
 * the game log - every team that played that season, whether or not a payroll
 * joined for it - and `complete` says whether a league-wide claim is available
 * at all. A season where a team went winless is deliberately incomplete: a
 * 0-win team has no cost per win and might well have been the worst, so the
 * superlative is not ours to make.
 *
 * @param {Array} joined  from joinPayrollWins
 * @param {Map} tally     from tallyTeamSeasons - the league, not the payrolls
 * @returns {Map<number, {
 *   year, rows, teams, leagueTeams, complete,
 *   median, dearest, cheapest, mostWins
 * }>} rows are dearest-per-win first
 */
export function seasonField(joined, tally) {
  /* How many teams actually played that season. Regular-season games only:
   * poGp alone is a team that appears in the file for the playoffs and nothing
   * else, which is a coverage artefact rather than a team. */
  const league = new Map();
  for (const rec of (tally ? tally.values() : [])) {
    if (!rec.gp) continue;
    if (!league.has(rec.year)) league.set(rec.year, new Set());
    league.get(rec.year).add(rec.code);
  }

  const byYear = new Map();
  for (const j of (joined || [])) {
    if (!(j.costPerWin > 0) || !isFinite(j.costPerWin)) continue;
    if (!byYear.has(j.year)) byYear.set(j.year, []);
    byYear.get(j.year).push(j);
  }

  const out = new Map();
  for (const [year, list] of byYear) {
    const rows = list.slice().sort((a, b) => b.costPerWin - a.costPerWin);
    const costs = rows.map(r => r.costPerWin).slice().sort((a, b) => a - b);
    const mid = Math.floor(costs.length / 2);
    const median = costs.length % 2 ? costs[mid] : (costs[mid - 1] + costs[mid]) / 2;
    const size = (league.get(year) || new Set()).size;
    out.set(year, {
      year, rows,
      teams: rows.length,
      leagueTeams: size,
      /* Every team that played has a rate here. Anything less and a
       * league-wide SUPERLATIVE is about the file. */
      complete: size > 0 && rows.length >= size,
      /* A superlative and a table are not the same claim, and gating both on
       * `complete` was wrong. "The worst rate in the league" needs every team,
       * because a missing team might have been worse. A table headed "26 of
       * the 30 teams" needs nothing beyond saying 26 and 30, and the real
       * numbers make that distinction expensive: only 3 of 35 seasons have a
       * payroll for all thirty, so the strict gate withheld the table from
       * almost every card that was built to carry one. */
      coverage: size > 0 ? rows.length / size : 0,
      median,
      dearest: rows[0],
      cheapest: rows[rows.length - 1],
      /* The contrast that makes the card land: what a win cost the team that
       * won the most of them. */
      mostWins: rows.slice().sort((a, b) => b.w - a.w)[0]
    });
  }
  return out;
}

/** Where this team-season sits in its own season, dearest win first. 1-based,
 * null when the season is not in the field. */
export function rankInSeason(field, rec) {
  const f = field && field.get ? field.get(rec.year) : field;
  if (!f || !f.rows) return null;
  const i = f.rows.findIndex(r => r.team === rec.team && r.year === rec.year);
  return i < 0 ? null : i + 1;
}
