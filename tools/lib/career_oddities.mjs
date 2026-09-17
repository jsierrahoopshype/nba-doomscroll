/* Careers the award voting remembers differently than anyone else does.
 *
 * WHY
 *
 * The vault needed content that surprises rather than content that is merely
 * dated. Award voting is a seventy-season record of what the electorate thought
 * at the time, and what it thought is often not what the player is remembered
 * for. Four shapes, each of which reads as a small biography:
 *
 *   perennial   drew votes across many seasons and won none of THESE awards.
 *               The career that was always nearly enough. The scope matters:
 *               the first real build said "never won anything" about John
 *               Stockton and Dwyane Wade, which is false about their careers
 *               and true only about the seven awards in this file.
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
 * "Won none of them" is a claim about awards, so it can only be made across the
 * awards the file actually covers. A file holding Clutch Player of
 * the Year for four seasons cannot support "never won anything" about a career
 * that ended in 1999, and it does not have to: the claim is about the awards
 * whose history spans the career.
 *
 * Nothing here reads a name, a team or a reputation. It reads votes and season
 * spans, which is all it can prove.
 */

/** Seasons a player must be absent from the data before he is "out of it". */
export const GONE_AFTER = 3;

/**
 * Seasons a player may still play AFTER his last ballot and have it read as a
 * cliff.
 *
 * This was an unnamed 2 for a day, and the day it was 2 is the day the off-by-one
 * above it was fixed, which is how it got read at last. At 2 the family filled up
 * with Bernard King drawing a Most Improved vote at 34, playing two more seasons
 * and retiring, and Ben Wallace doing the same at 35. Those are careers ending on
 * schedule. The card promises a fall, and three seasons from a ballot to the exit
 * is not one.
 *
 * At 1 the vote came in his final season or the one before it, which is the only
 * gap short enough for "and then he was gone" to be the story rather than the
 * arithmetic.
 */
export const AFTER_MAX = 1;

/**
 * Seasons a player must play AFTER his last ballot before it reads as a cliff.
 *
 * This is 1 rather than 0, which means a man who drew votes in his final season
 * gets no card at all, and it is the most expensive gate in this file: it cost
 * Wilt Chamberlain fourth in the 1972-73 MVP voting and then gone, and Bill
 * Russell fourth in 1968-69 as a player-coach holding the championship. Two of
 * the best cards the family ever produced.
 *
 * It went in because of a third one. Maurice Stokes was fifth in the 1957-58
 * MVP voting and never played again: a head injury in March 1958 left him
 * permanently paralysed, and he died in 1970. The card read "The voters still
 * had him among the best in the league in the last season he played", which is
 * true, and in a scrolling feed with no context it is a curiosity made out of a
 * catastrophe.
 *
 * That was not bad luck in the sampling. An excellent season followed
 * immediately by nothing IS the shape of a career ended by injury, because that
 * is what ending a good player's career at once looks like. The file holds
 * ballots and games played. It cannot tell that apart from a man choosing to
 * stop, and it never will.
 *
 * One season played after the ballots is enough to know the end was not
 * instant. Set this to 0 to get Wilt and Russell back, and Stokes with them.
 */
export const AFTER_MIN = 1;

/**
 * Seasons between a player's first and last ballot before the rows are more
 * likely two people than one career.
 *
 * "Tim Hardaway drew votes for 4 different awards across 8 seasons, 12 ballot
 * appearances between 1990-91 and 2023-24" is Tim Hardaway and Tim Hardaway Jr.
 * under one name, and the card described the pair as though they were a man.
 *
 * The bar has to sit above the longest real career, not at a round number:
 * LeBron James debuted in 2003-04 and was still drawing votes in 2025-26, a
 * span of 22 by this measure. Nobody has reached 25 seasons, so 24 clears every
 * career that exists and still catches a father and son thirty-three years
 * apart.
 */
export const MAX_CAREER_SPAN = 24;

/** Vote-drawing seasons before "always nearly" is a career and not a run. */
export const PERENNIAL_MIN_SEASONS = 8;

/** A top-five finish is top five. Stated so nothing has to remember it. */
export const TOP = 5;

/**
 * @param {Array} votes  awardVotes rows: { PLAYER, AWARD, RNK, YEAR }
 * @param {Map} lastSeason  player -> the last season he appears in rsStats
 * @param {object} opts  { dataTo: the last season the data covers,
 *                         awardSpan: Map award -> {from, to},
 *                         prestige: Map award -> rank, lower being the more
 *                           prestigious. Without it "best finish" is decided by
 *                           the placing alone, which makes second in Most
 *                           Improved beat fifth in MVP - true arithmetic and
 *                           the wrong sentence. The order is league knowledge,
 *                           so the caller owns it and this file does not
 *                           pretend to. }
 * @returns {Array} facts, each { kind, player, ... }, unordered
 */
export function careerOddities(votes, lastSeason, opts) {
  const o = Object.assign({ goneAfter: GONE_AFTER,
                            perennialMin: PERENNIAL_MIN_SEASONS,
                            afterMax: AFTER_MAX, afterMin: AFTER_MIN,
                            maxSpan: MAX_CAREER_SPAN }, opts || {});
  const prestige = o.prestige && o.prestige.get
    ? (a => (o.prestige.has(a) ? o.prestige.get(a) : 99))
    : (() => 0);
  const dataTo = o.dataTo || 0;
  const awardSpan = o.awardSpan || new Map();

  /* FIRST PLACES THAT CANNOT ALL BE TRUE.
   *
   * "Marvin Barnes won MVP in 1974-75" was published. Bob McAdoo won it, and
   * Barnes was the ABA's Rookie of the Year, in another league. One of those
   * rows is wrong and this file has no way to tell which.
   *
   * It does not need to. Whether the extra row is an error or a real shared
   * award, "X won MVP in 1974-75" said about ONE of two men is the wrong
   * sentence either way. So a first place in a season with more than one is not
   * treated as a win: the player keeps his ballot appearance, and the card that
   * would have named him the winner is not built. Nothing is deleted, and the
   * builder reports the season by name through contestedWins(). */
  const firsts = new Map();
  for (const v of (votes || [])) {
    if (parseInt(v && v.RNK, 10) !== 1) continue;
    const key = String(v.AWARD || "").trim() + "|" + parseInt(v.YEAR, 10);
    firsts.set(key, (firsts.get(key) || 0) + 1);
  }
  const disputed = (award, year) => (firsts.get(award + "|" + year) || 0) > 1;

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
        wins: [], topFives: [], all: [], votes: 0, first: year, last: year
      });
    }
    const p = players.get(name);
    p.votes++;
    p.seasons.add(year);
    p.awards.add(award);
    p.first = Math.min(p.first, year);
    p.last = Math.max(p.last, year);
    const bad = rnk === 1 && disputed(award, year);
    if (rnk === 1 && !bad) p.wins.push({ award, year });
    if (isFinite(rnk) && rnk <= TOP && !bad) p.topFives.push({ award, year, rnk });
    /* EVERY vote, not just the good ones. The cliff needs to know what the
     * final season's ballots were actually for, and a man's last ballot is
     * usually a long way down it. A disputed first place stays here, because he
     * did appear on that ballot, and carries the flag so no sentence calls it a
     * win. */
    p.all.push({ award, year, rnk: isFinite(rnk) ? rnk : null, disputed: bad });
  }

  /* The most notable thing on one season's ballots. A win beats any placing;
   * among placings the more prestigious award beats the better number, which is
   * the lesson from "his best finish was second for Most Improved Player" said
   * about men with top-five MVP seasons. */
  const won1 = t => (t.rnk === 1 && !t.disputed ? 0 : 1);
  const notable = (a, b) =>
    (won1(a) - won1(b)) ||
    (prestige(a.award) - prestige(b.award)) ||
    ((a.rnk || 99) - (b.rnk || 99));

  const facts = [];
  for (const p of players.values()) {
    const seasons = p.seasons.size;
    const gone = lastSeason && lastSeason.get ? lastSeason.get(p.player) : null;

    /* TWO PEOPLE UNDER ONE NAME. Nothing downstream can recover from this, so
     * the whole player is dropped rather than described wrongly. Callers who
     * want to know who was dropped ask suspectSpans() for the same list. */
    if ((p.last - p.first) > o.maxSpan) continue;

    /* Whether the data can see the end of this career at all. Both the cliff
     * and the one-shot need it, for the same reason: they are the two shapes
     * that say "and then nothing", which is a claim about a finished career. */
    const finished = !!(gone && dataTo && (dataTo - gone) >= o.goneAfter);

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
        /* Most prestigious award he made a top five in, then his best placing
         * inside it. Sorting on the placing alone is what produced "his best
         * finish was second for Most Improved Player" for a man with top-five
         * MVP seasons. */
        best: p.topFives.slice().sort((a, b) =>
          (prestige(a.award) - prestige(b.award)) || (a.rnk - b.rnk))[0] || null
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
    if (finished) {
      const after = gone - p.last;
      if (after >= o.afterMin && after <= o.afterMax) {
        /* WHICH AWARD THE LAST BALLOTS WERE FOR. This read the top-five list
         * and, when the final season was not a top five, fell back to
         * `[...p.awards][0]`: the first award anywhere in the career, in
         * whatever order the rows arrived. For a man who drew votes for four
         * different awards that names the right one by luck. p.all holds every
         * vote, so the final season can be asked directly.
         *
         * `won` and `topFive` travel with the fact because the sentence differs
         * by all three cases and the caller should not have to re-derive them
         * from a number. Winning an award and leaving is not drawing a vote and
         * leaving, and neither is finishing fifth and leaving. */
        const last = p.all.filter(t => t.year === p.last).sort(notable)[0] || null;
        facts.push({
          kind: "cliff", player: p.player, votes: p.votes, seasons,
          voteYear: p.last, lastPlayed: gone, after,
          award: last ? last.award : "",
          /* Null for a disputed row, so the caller's ranking cannot promote a
           * card built on a first place the file contradicts. */
          rnk: last && !last.disputed ? last.rnk : null,
          /* A disputed first place is neither. The card falls through to "drew
           * a vote in", which is true whichever row is the bad one. */
          won: !!(last && last.rnk === 1 && !last.disputed),
          topFive: !!(last && last.rnk && last.rnk > 1 && last.rnk <= TOP && !last.disputed)
        });
      }
    }

    /* THE ONE SHAPE THAT HAD NO GATE AT ALL, and it needed the same one as the
     * cliff. "Never drew another vote for anything" is a claim about a career
     * that is over, and this branch used to make it about anybody holding
     * exactly one first-place row - including the reigning Rookie of the Year.
     * The first real build said it about Cooper Flagg, who won it in 2025-26
     * and starts his second season next month. Every new ROY is a one-shot on
     * the day he wins, and stops being one the moment he draws a vote again. */
    if (p.wins.length === 1 && p.votes === p.wins.length && finished) {
      facts.push({
        kind: "one-shot", player: p.player,
        award: p.wins[0].award, year: p.wins[0].year,
        lastPlayed: gone
      });
    }
  }
  return facts;
}

/**
 * Players whose ballot span is longer than any career, which means the rows are
 * more than one person. careerOddities() drops these; this names them, so a
 * build says who rather than quietly producing fewer cards.
 *
 * @returns {Array} [{ player, from, to, span }], longest span first
 */
export function suspectSpans(votes, opts) {
  const max = (opts && opts.maxSpan) || MAX_CAREER_SPAN;
  const seen = new Map();
  for (const v of (votes || [])) {
    const name = v && v.PLAYER;
    const year = parseInt(v && v.YEAR, 10);
    if (!name || !isFinite(year)) continue;
    if (!seen.has(name)) seen.set(name, { player: name, from: year, to: year });
    const s = seen.get(name);
    s.from = Math.min(s.from, year);
    s.to = Math.max(s.to, year);
  }
  return [...seen.values()]
    .map(s => Object.assign(s, { span: s.to - s.from }))
    .filter(s => s.span > max)
    .sort((a, b) => b.span - a.span);
}

/**
 * Award-seasons with more than one first-place row.
 *
 * careerOddities() already refuses to call any of those men the winner, since
 * one of two is the wrong sentence whether the extra row is an error or a real
 * shared award. This names the seasons so the bad row can be found and fixed,
 * rather than leaving a build quietly short of cards.
 *
 * @returns {Array} [{ award, year, players }], oldest season first
 */
export function contestedWins(votes) {
  const byKey = new Map();
  for (const v of (votes || [])) {
    const award = v && String(v.AWARD || "").trim();
    const year = parseInt(v && v.YEAR, 10);
    if (!award || !isFinite(year) || parseInt(v.RNK, 10) !== 1) continue;
    const key = award + "|" + year;
    if (!byKey.has(key)) byKey.set(key, { award, year, players: [] });
    byKey.get(key).players.push(v.PLAYER);
  }
  return [...byKey.values()].filter(w => w.players.length > 1)
    .sort((a, b) => a.year - b.year);
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
