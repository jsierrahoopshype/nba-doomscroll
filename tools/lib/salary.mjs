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
 * @param {{team: string, amount: number}[]} rows  salary rows for one player-season
 * @param {Set<string>|string[]|null} playedTeams  teams rsStats has him playing for
 * @returns {{team: string, amount: number}[]} the rows worth trusting
 */
export function stripPhantomTeamRows(rows, playedTeams) {
  if (!Array.isArray(rows) || rows.length < 2) return rows || [];
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
 * Kept next to the strip because the two must agree about what a duplicate
 * means, and they did not when the logic was written twice. */
export function summariseSeason(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const amounts = new Set(list.map(r => r.amount));
  const duplicated = list.length > 1 && amounts.size === 1;
  return {
    teams: list,
    total: duplicated ? list[0].amount : list.reduce((n, r) => n + r.amount, 0),
    teamAmbiguous: duplicated,
    traded: !duplicated && list.length > 1
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
