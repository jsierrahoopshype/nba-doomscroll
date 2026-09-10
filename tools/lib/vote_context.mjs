/* Why a vote is remarkable, rather than merely counted.
 *
 * "One voter, and only one, named Jayson Tatum for MVP" is arithmetic read
 * aloud. It is also the same sentence every time, with a name slotted in,
 * which is why it reads as lame however true it is. What Jorge asked for is
 * the fact that makes a reader stop: the only player to receive votes as a
 * Clipper in however many years.
 *
 * WHAT WAS MISSING, AND IT WAS ONE FIELD
 *
 * The Media Vote Tracker's ballots carry a player, an award, a season and a
 * slot. They do not carry a TEAM. Without it there is no way to ask any
 * question about a franchise, which is where most of the genuinely surprising
 * facts live - a vote is unremarkable for a Laker and startling for a Piston.
 * So the team comes from nba-player-data's per-season stat rows, joined on
 * player and season, and everything here is about what that join makes askable.
 *
 * THE WINDOW IS PART OF THE CLAIM, ALWAYS
 *
 * "The first Clipper to get an MVP vote since 1993" is a sentence this data
 * cannot support if the tracker starts in 2015. Every answer below therefore
 * carries the window it was computed over, and the caller is expected to print
 * it: "in the 11 seasons this tracker covers" is a smaller claim than "since
 * 1993" and it has the considerable advantage of being true.
 *
 * A DROUGHT IS NOT A DROUGHT IF NOBODY WAS LOOKING
 *
 * Two gates, both about the data rather than the basketball. A team that has
 * never appeared is only interesting if the window is long enough for that to
 * mean something, and a gap is only interesting if it is longer than the
 * ordinary churn of who gets votes. Both are the caller's to set; the defaults
 * here are deliberately conservative, because a manufactured oddity teaches
 * the reader that the label means nothing.
 */

/** Season label to the year the season ended. "2023-24", "2023-2024", "2024". */
export function seasonEndYear(label) {
  const s = String(label == null ? "" : label).trim();
  let m = /^(\d{4})-(\d{4})$/.exec(s);
  if (m) return parseInt(m[2], 10) === parseInt(m[1], 10) + 1 ? parseInt(m[2], 10) : null;
  m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m) {
    const start = parseInt(m[1], 10);
    const end = Math.floor(start / 100) * 100 + parseInt(m[2], 10);
    if (end === start + 1) return end;
    if (end + 100 === start + 1) return start + 1;   // 1999-00
    return null;
  }
  m = /^(\d{4})$/.exec(s);
  if (m) return parseInt(m[1], 10);
  return null;
}

/**
 * Which team was this player on that season?
 *
 * A traded player has a row per team, and picking the wrong one would put a
 * vote on the wrong franchise - the exact class of error that matters most
 * here, since the whole card is about the franchise. So: the team he played
 * the most games for, and NOTHING when that is a tie or unknowable. A false
 * negative costs a card; a false positive is a card that is a lie.
 *
 * @param {Array} statRows  rows with PLAYER, YEAR, TEAM, GP
 * @param {(t:string)=>string} teamCode  the caller's own normaliser
 * @returns {Map<string,string>} "PLAYER|YEAR" -> team code
 */
export function teamByPlayerSeason(statRows, teamCode) {
  const games = new Map();     // "PLAYER|YEAR" -> Map(team -> gp)
  for (const r of (statRows || [])) {
    const year = parseInt(r.YEAR, 10);
    if (!r.PLAYER || !year || !r.TEAM) continue;
    const code = teamCode ? teamCode(r.TEAM) : String(r.TEAM);
    /* "TOT" and its variants are a season total, not a team. Counting it would
     * beat every real team on games played and win every tie. */
    if (/^(TOT|TOTAL|2TM|3TM|4TM)$/i.test(code)) continue;
    const key = r.PLAYER + "|" + year;
    if (!games.has(key)) games.set(key, new Map());
    const m = games.get(key);
    m.set(code, (m.get(code) || 0) + (Number(r.GP) || 0));
  }

  const out = new Map();
  for (const [key, m] of games) {
    const ranked = [...m.entries()].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) continue;
    /* One team, or a clear plurality. A dead heat between two teams means
     * nobody can say which franchise the season belonged to. */
    if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) continue;
    out.set(key, ranked[0][0]);
  }
  return out;
}

/**
 * For each award, which teams had a vote-getter in each season.
 *
 * @param {Array} awardSeasons  [{ award, season, players: string[] }]
 * @param {Map} teamOf          from teamByPlayerSeason
 * @returns {Map<string, {years:number[], teamYears:Map<string, Map<number,string[]>>}>}
 *          keyed by award. teamYears maps team -> year -> the players involved.
 */
export function voteHistory(awardSeasons, teamOf) {
  const byAward = new Map();
  for (const as of (awardSeasons || [])) {
    const year = seasonEndYear(as.season);
    if (!as.award || !year) continue;
    if (!byAward.has(as.award)) {
      byAward.set(as.award, { years: new Set(), teamYears: new Map() });
    }
    const h = byAward.get(as.award);
    h.years.add(year);
    for (const player of (as.players || [])) {
      const team = teamOf && teamOf.get(player + "|" + year);
      if (!team) continue;              // unknown team: contributes nothing
      if (!h.teamYears.has(team)) h.teamYears.set(team, new Map());
      const ty = h.teamYears.get(team);
      if (!ty.has(year)) ty.set(year, []);
      if (ty.get(year).indexOf(player) < 0) ty.get(year).push(player);
    }
  }
  const out = new Map();
  for (const [award, h] of byAward) {
    out.set(award, { years: [...h.years].sort((a, b) => a - b), teamYears: h.teamYears });
  }
  return out;
}

/** How long a gap is worth a card, and how long a window has to be before
 * "never" means anything. Conservative on purpose. */
export const MIN_GAP = 5;
export const MIN_WINDOW = 8;

/**
 * Is this team getting a vote for this award, this season, remarkable?
 *
 * THE WINDOW IS THE OVERLAP OF TWO SPANS, NOT ONE OF THEM
 *
 * opts.franchiseFrom / franchiseTo narrow the window to the seasons the
 * franchise actually existed for. Without them this went out on the live site:
 *
 *   "the first Raptors player to finish in the top five for Defensive Player
 *    of the Year in 43 seasons of voting"
 *
 * Defensive Player of the Year voting starts in 1983 and Toronto joined the
 * league in 1996, so thirteen of those seasons are ones the Raptors could not
 * have appeared in. The claim was true and the number was invented, which
 * reads as authoritative and is trivially checkable. Both bounds are optional
 * and default to open, so a caller that does not know a franchise's span gets
 * the old behaviour rather than a wrong one.
 *
 * @returns {null | {
 *   kind: "first-in-window" | "first-since",
 *   team: string, year: number, award: string,
 *   windowFrom: number, windowTo: number, seasonsCovered: number,
 *   gap: number|null, sinceYear: number|null, sincePlayers: string[]
 * }}
 * null whenever the honest answer is "not unusual" or "cannot tell", which
 * includes every case where the window is too short to support a claim.
 */
export function teamVoteDrought(history, award, team, year, opts) {
  const o = opts || {};
  const minGap = o.minGap == null ? MIN_GAP : o.minGap;
  const minWindow = o.minWindow == null ? MIN_WINDOW : o.minWindow;
  const franchiseFrom = o.franchiseFrom == null ? -Infinity : o.franchiseFrom;
  const franchiseTo = o.franchiseTo == null ? Infinity : o.franchiseTo;

  const h = history && history.get(award);
  if (!h || !h.years.length) return null;

  /* The seasons any claim here can be about: this award's, narrowed to the ones
   * the franchise was in the league for. */
  const span = h.years.filter(y => y >= franchiseFrom && y <= franchiseTo);
  if (span.length < minWindow) return null;

  /* Only seasons at or before this one. A drought is about what came before;
   * counting later seasons would make the claim depend on the future. */
  const prior = span.filter(y => y < year);
  const windowFrom = span[0], windowTo = span[span.length - 1];

  const ty = h.teamYears.get(team);
  const before = ty
    ? [...ty.keys()].filter(y => y < year && y >= franchiseFrom && y <= franchiseTo)
        .sort((a, b) => a - b)
    : [];

  if (!before.length) {
    /* Never, within the window. Requires the window to actually START before
     * this season by enough seasons to be a claim at all. */
    if (prior.length < minWindow) return null;
    return {
      kind: "first-in-window", team, year, award,
      windowFrom, windowTo, seasonsCovered: prior.length,
      gap: null, sinceYear: null, sincePlayers: []
    };
  }

  const last = before[before.length - 1];
  /* Seasons the tracker COVERS between then and now, not calendar years. A
   * tracker that skips 2020 must not be described as having watched it. */
  const gap = prior.filter(y => y > last).length;
  if (gap < minGap) return null;
  return {
    kind: "first-since", team, year, award,
    windowFrom, windowTo, seasonsCovered: prior.length,
    gap, sinceYear: last, sincePlayers: ty.get(last) || []
  };
}
