/* Careers the award voting remembers differently than anyone else does.
 *
 * WHY
 *
 * The vault needed content that surprises rather than content that is merely
 * dated. Award voting is a seventy-season record of what the electorate thought
 * at the time, and what it thought is often not what the player is remembered
 * for. Four shapes, each of which reads as a small biography:
 *
 *   perennial   drew votes across many seasons and never won anything. The
 *               career that was always nearly enough.
 *   one-top-five one top-five finish in a career and never another. A single
 *               season that stands up out of the rest of it.
 *   cliff       drew votes, then was out of the league within a few seasons.
 *   one-shot    won an award and never drew a vote for anything again.
 *
 * THE GATES, WHICH ARE MOST OF THIS FILE
 *
 * "Out of the league within three seasons" is FALSE for a player whose last
 * season is the last season in the file. He is not gone; the data stops. So a
 * cliff needs clear air after it - seasons in the dataset that the player did
 * not play - and the amount of clear air is a named constant rather than a
 * feeling.
 *
 * "Never won anything" is a claim about every award, so it can only be made
 * across the awards the file actually covers. A file holding Clutch Player of
 * the Year for four seasons cannot support "never won anything" about a career
 * that ended in 1999, and it does not have to: the claim is about the awards
 * whose history spans the career.
 *
 * Nothing here reads a name, a team or a reputation. It reads votes and season
 * spans, which is all it can prove.
 */

/** Seasons a player must be absent from the data before he is "out of it". */
export const GONE_AFTER = 3;

/** Vote-drawing seasons before "always nearly" is a career and not a run. */
export const PERENNIAL_MIN_SEASONS = 8;

/** A top-five finish is top five. Stated so nothing has to remember it. */
export const TOP = 5;

/**
 * @param {Array} votes  awardVotes rows: { PLAYER, AWARD, RNK, YEAR }
 * @param {Map} lastSeason  player -> the last season he appears in rsStats
 * @param {object} opts  { dataTo: the last season the data covers,
 *                         awardSpan: Map award -> {from, to} }
 * @returns {Array} facts, each { kind, player, ... }, unordered
 */
export function careerOddities(votes, lastSeason, opts) {
  const o = Object.assign({ goneAfter: GONE_AFTER,
                            perennialMin: PERENNIAL_MIN_SEASONS }, opts || {});
  const dataTo = o.dataTo || 0;
  const awardSpan = o.awardSpan || new Map();

  /* One pass into a per-player record. */
  const players = new Map();
  for (const v of (votes || [])) {
    const name = v && v.PLAYER;
    const award = v && String(v.AWARD || "").trim();
    const year = parseInt(v && v.YEAR, 10);
    if (!name || !award || !isFinite(year)) continue;
    const rnk = parseInt(v.RNK, 10);

    if (!players.has(name)) {
      players.set(name, {
        player: name, seasons: new Set(), awards: new Set(),
        wins: [], topFives: [], votes: 0, first: year, last: year
      });
    }
    const p = players.get(name);
    p.votes++;
    p.seasons.add(year);
    p.awards.add(award);
    p.first = Math.min(p.first, year);
    p.last = Math.max(p.last, year);
    if (rnk === 1) p.wins.push({ award, year });
    if (isFinite(rnk) && rnk <= TOP) p.topFives.push({ award, year, rnk });
  }

  const facts = [];
  for (const p of players.values()) {
    const seasons = p.seasons.size;
    const gone = lastSeason && lastSeason.get ? lastSeason.get(p.player) : null;

    /* Which awards could this career have won? An award whose own history does
     * not overlap the career cannot be part of "never won anything". */
    const coverable = [];
    for (const [award, span] of awardSpan) {
      if (!span || !span.from || !span.to) continue;
      if (span.from <= p.last && span.to >= p.first) coverable.push(award);
    }

    if (!p.wins.length && seasons >= o.perennialMin && coverable.length >= 3) {
      facts.push({
        kind: "perennial", player: p.player, seasons, votes: p.votes,
        from: p.first, to: p.last, awards: [...p.awards].sort(),
        coverable: coverable.length,
        best: p.topFives.slice().sort((a, b) => a.rnk - b.rnk)[0] || null
      });
    }

    if (p.topFives.length === 1 && seasons >= 3) {
      const only = p.topFives[0];
      facts.push({
        kind: "one-top-five", player: p.player, seasons, votes: p.votes,
        from: p.first, to: p.last, year: only.year, award: only.award, rnk: only.rnk
      });
    }

    /* THE CLIFF, and its gate. `gone` is the last season the player appears in
     * the stats at all; dataTo is the last season the data covers. A player
     * whose career ends at the edge of the file has not fallen off anything. */
    if (gone && dataTo && (dataTo - gone) >= o.goneAfter) {
      const after = gone - p.last;
      if (after >= 0 && after <= 2) {
        facts.push({
          kind: "cliff", player: p.player, votes: p.votes,
          voteYear: p.last, lastPlayed: gone, after,
          award: (p.topFives.find(t => t.year === p.last) || {}).award ||
                 [...p.awards][0] || "",
          rnk: (p.topFives.find(t => t.year === p.last) || {}).rnk || null
        });
      }
    }

    if (p.wins.length === 1 && p.votes === p.wins.length) {
      facts.push({
        kind: "one-shot", player: p.player,
        award: p.wins[0].award, year: p.wins[0].year
      });
    }
  }
  return facts;
}

/** award -> {from, to} from the vote rows themselves. */
export function awardSpans(votes) {
  const out = new Map();
  for (const v of (votes || [])) {
    const award = v && String(v.AWARD || "").trim();
    const year = parseInt(v && v.YEAR, 10);
    if (!award || !isFinite(year)) continue;
    if (!out.has(award)) out.set(award, { from: year, to: year, seasons: new Set() });
    const s = out.get(award);
    s.from = Math.min(s.from, year);
    s.to = Math.max(s.to, year);
    s.seasons.add(year);
  }
  return out;
}
