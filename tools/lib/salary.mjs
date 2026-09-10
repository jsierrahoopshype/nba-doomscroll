/* Rules shared by tools/build_salary.mjs and tools/diagnose_payroll.mjs.
 *
 * They lived as two copies for about ten minutes, which was long enough to see
 * the problem: a diagnostic that reports what the builder does is worthless the
 * moment the two disagree, and nothing would have said they had. */

/** Drop salary rows that carry NEXT season's team with THIS season's money.
 *
 * WHAT IS ACTUALLY IN THE FILE
 *
 * salaries.json ends at 2026 and has no 2027 season at all. For 145 players who
 * have signed or moved for 2026-27, it carries a SECOND 2026 row naming the new
 * team, with the current season's salary copied into it:
 *
 *     2026   LA Lakers      $52,627,153     <- real: LeBron's 2025-26 salary
 *     2026   Philadelphia   $52,627,153     <- team from 2026-27, money from 2025-26
 *
 * He is a 76er next season and is paid $3,876,529 there, so the second row is
 * right about the team, wrong about the year, and wrong about the money. One
 * of the 145 has a blank team. It reads like a scraper taking the team from a
 * "next season" column and the salary from the current one.
 *
 * WHY THE OBVIOUS FIXES ARE WRONG
 *
 * Summing both doubles his pay. Discarding the season - what the builder used
 * to do, calling it ambiguous - threw fifteen of twenty-eight Lakers out of the
 * 2025-26 book and produced "Luka Doncic was 47% of the LAL payroll" off the
 * $96.8M that survived.
 *
 * Keeping whichever row the stats agree with works for LeBron and fails for a
 * player who was ALSO genuinely traded mid-season: three rows, two real amounts
 * and one copy, so the amounts are not all equal, so nothing flags it and the
 * builder sums all three.
 *
 * THE RULE
 *
 * A row is phantom when BOTH hold: rsStats does not have him playing for that
 * team this season, AND its amount exactly equals another row of his. The
 * second half is what protects a real contract - a genuine second team pays a
 * different number, to the dollar. Everything else is left exactly as it was,
 * so a real mid-season split still splits and history is untouched.
 *
 * It never strips a player down to nothing: with no stats on file, or if every
 * row looks phantom, the rows come back unchanged for the caller to handle.
 *
 * SCOPED TO THE IMPORTER'S OWN SEASONS, which the first version was not.
 *
 * Matching on "same salary, different teams" across all of history removed 16
 * seasons it had no business touching:
 *
 *     Marcus Camby 2015    TOR $4,177,208 / HOU
 *     Zylan Cheatham 2022  UTA $85,578 / MIA / NOP
 *     Briante Weber 2016   MIA $30,887 / MEM
 *
 * Those are 10-day contracts. The 10-day minimum is a fixed formula, so a
 * journeyman who signs one with two clubs in a season is paid the SAME amount
 * by each. Two rows, one salary, two teams, both real - and dropping one
 * understates his career, which is the same error as the overstatement this
 * exists to fix, only pointing the other way and harder to notice.
 *
 * Identical salaries are not evidence of a copy. What identifies the bug is
 * where the row came from: update-salaries.py writes only IMPORT_YEARS, so
 * only those seasons can hold a row it invented. Everything else is left as
 * it is.
 *
 * @param {{team: string, amount: number}[]} rows  salary rows for one player-season
 * @param {Set<string>|string[]|null} playedTeams  teams rsStats has him playing for
 * @param {number|string} year  the season; outside IMPORTER_YEARS nothing is stripped
 * @returns {{team: string, amount: number}[]} the rows worth trusting
 */
export const IMPORTER_YEARS = new Set([2026]);

export function stripPhantomTeamRows(rows, playedTeams, year) {
  if (!Array.isArray(rows) || rows.length < 2) return rows || [];
  if (!IMPORTER_YEARS.has(parseInt(year, 10))) return rows;
  if (!playedTeams) return rows;
  const played = playedTeams instanceof Set ? playedTeams : new Set(playedTeams);
  if (!played.size) return rows;

  const keep = rows.filter(r => {
    if (played.has(r.team)) return true;
    return !rows.some(o => o !== r && o.amount === r.amount);
  });
  return keep.length ? keep : rows;
}

/** Re-derive a player-season from rows the strip above may have changed.
 *
 * WHEN IDENTICAL AMOUNTS ARE ONE SALARY, AND WHEN THEY ARE TWO
 *
 * This used to count any repeated amount once, which was written for the 2026
 * phantom rows and is wrong everywhere else. The 10-day minimum is a fixed
 * formula, so Marcus Camby's two 2015 stints really were $4,177,208 each and
 * he really was paid both. Counting them once understated twenty journeyman
 * careers.
 *
 * Three cases, and the team is what separates them:
 *
 *   same amount, SAME team    one salary written twice. Counted once, always.
 *   same amount, other teams  two real stints at a formula wage. Summed -
 *                             EXCEPT inside the importer's own seasons, where
 *                             an unresolved phantom can still look like this
 *                             and summing it would double a man's pay.
 *   different amounts         a mid-season trade. Summed.
 *
 * @param {{team: string, amount: number}[]} rows
 * @param {number|string} year  the season, for the importer-year exception
 */
export function summariseSeason(rows, year) {
  const list = Array.isArray(rows) ? rows : [];
  const sameAmount = list.length > 1 && new Set(list.map(r => r.amount)).size === 1;
  const sameTeam = list.length > 1 && new Set(list.map(r => r.team)).size === 1;
  const importerSeason = IMPORTER_YEARS.has(parseInt(year, 10));
  const countOnce = sameAmount && (sameTeam || importerSeason);
  return {
    teams: list,
    total: countOnce ? list[0].amount : list.reduce((n, r) => n + r.amount, 0),
    /* Still "ambiguous" only where nobody can say whose book he was on. Two
     * 10-days name two real books and are not ambiguous at all. */
    teamAmbiguous: countOnce && !sameTeam,
    traded: !countOnce && list.length > 1
  };
}

/** The salary floor, as a fraction of the cap.
 *
 * Every NBA team must spend at least 90% of the cap or pay the shortfall, so a
 * team-season summing to less than that is missing players and any share
 * computed from it is wrong. Set under the real floor so a team genuinely at it
 * keeps its card; the failures this catches are not marginal - 63% and 73%,
 * against 121% to 224% for every book that was right. */
export const MIN_PAYROLL_OF_CAP = 0.80;

/* ---------------- recency ----------------
 *
 * "There's too much old salary content. Lean more towards recent content."
 *
 * The pool spans 1991 to now, and the metrics that decide a card - biggest cap
 * share, cheapest win, most top-heavy book - do not care what year it is. Over
 * thirty-five seasons that puts the feed's salary slot in the 1990s far more
 * often than a reader who follows this league would choose.
 *
 * WHY THIS SCALES QUALITY RATHER THAN FILTERING BY YEAR
 *
 * A cutoff would throw away the best cards in the file. Shaq at 47% of the
 * Lakers' book is a better card than the fourteenth-most top-heavy payroll of
 * 2023, and a rule that dropped it to make room would be worse for the reader
 * than the problem it fixed. Scaling means a great old card still beats a
 * mediocre recent one; it just has to be great, not merely old.
 *
 * WHY A HALF-LIFE AND NOT A STRAIGHT LINE
 *
 * Most of what a reader means by "recent" is the last few seasons, and beyond
 * about fifteen years back the difference between 2006 and 1996 barely matters
 * to them. A half-life flattens out where the reader's interest does; a linear
 * ramp would keep punishing 1994 relative to 1999 long after anyone cared.
 *
 * THE FLOOR IS THE POINT
 *
 * Without it a 1991 card would be scaled to near nothing and the vault would
 * lose its history entirely. At FLOOR the oldest card keeps a bit over half
 * its score, which is enough for the strongest of them to survive.
 */
export const RECENCY_HALF_LIFE = 12;   // seasons for half the decay to happen
export const RECENCY_FLOOR = 0.55;     // what the oldest card keeps

/**
 * @param {number} year     the card's season-ending year
 * @param {number} latest   the most recent season in the data, NOT the current
 *                          calendar year - the file decides what "now" is, so
 *                          this does not start penalising every card in
 *                          January because a build is a year old
 * @returns {number} a multiplier in [RECENCY_FLOOR, 1]
 */
export function recencyFactor(year, latest) {
  const y = parseInt(year, 10), l = parseInt(latest, 10);
  /* No year is not "old" - group cards like earnings-by-country are all-time
   * by nature and there is nothing to be recent about. Unscaled. */
  if (!isFinite(y) || !isFinite(l)) return 1;
  const age = Math.max(0, l - y);
  return RECENCY_FLOOR + (1 - RECENCY_FLOOR) * Math.pow(0.5, age / RECENCY_HALF_LIFE);
}

/** The season-ending year out of a "2023-24" label, or null. */
export function yearFromSeasonLabel(label) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(label || "").trim());
  if (!m) return null;
  const start = parseInt(m[1], 10);
  /* "1999-00" is 2000, not 1900. The two digits belong to whichever century
   * makes the season one year long. */
  const end = Math.floor(start / 100) * 100 + parseInt(m[2], 10);
  return end === start + 1 ? end : end + 100 === start + 1 ? start + 1 : null;
}
