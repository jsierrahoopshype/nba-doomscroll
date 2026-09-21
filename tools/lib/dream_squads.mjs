/* Two five-man squads of real player-seasons, and which one outscored the other.
 *
 * WHY
 *
 * Beat the Dream Team asks you to assemble a five that beats an all-time one.
 * That is a build, and a build does not fit on a card. What DOES fit is the
 * judgement underneath it: put two assembled fives side by side and say which
 * one scored more. No simulation, no rating, no opinion. Five real seasons,
 * five real scoring averages, added up.
 *
 * WHAT THE QUESTION IS, EXACTLY
 *
 * "These five men, in the seasons shown, averaged N points a game between
 * them." That is a sum of five season averages. It is NOT a prediction of what
 * the lineup would score together - five 25-point scorers sharing one ball do
 * not score 125 - and the card must never imply it is. The reveal says so in
 * plain words. The arithmetic is honest and the framing has to match it.
 *
 * WHY ONE SQUAD PER DECADE
 *
 * A random five against another random five is a coin flip with no lesson in
 * it. Drawn one decade against another, the same question carries the thing
 * most readers are wrong about: scoring is not a line that rises with time. The
 * early sixties outscore the late nineties badly, and a reader who assumes
 * "modern players score more" loses. The reveal names the scoring environment
 * of both decades, which is the whole payload.
 *
 * THE TWO TRAPS IN THE DATA
 *
 * TOT ROWS. rsStats carries a TOT row for a player who was traded midseason,
 * PLUS one row per team. Summing a player-season naively counts a traded man
 * twice and inflates his average past anything he did. tools/build_data.mjs
 * guards against this when it picks a last team; nothing else here did, because
 * nothing else here read PTS. seasonTotals below prefers the TOT row and falls
 * back to summing team rows, which is the only order that is right in both
 * shapes.
 *
 * SHORT SEASONS. A man who played six games at 31 a game did not average 31
 * over a season in any sense a reader would accept. GP has a floor, and it is
 * the floor that makes the sum defensible rather than a trivia artefact.
 */

/** Games in a season before its scoring average means anything.
 *
 * 58 is deliberate: it clears every lockout-shortened season (50 games in
 * 1998-99, 66 in 2011-12) as a proportion of a full one, while cutting the
 * injury years and ten-day contracts that would otherwise put a 30-point
 * six-game cameo on a card. */
export const MIN_GP = 58;

/** Points a game before a season is worth putting in a five. Below this the
 * squad stops being an assembled team and becomes a list of role players. */
export const MIN_PPG = 14;

/** Men per squad. */
export const SQUAD = 5;

/** How close the two totals must be, in combined points per game.
 *
 * Both ends matter. Under the floor it is a coin flip and the reader learns
 * nothing from being right. Over the ceiling the answer is visible without
 * thinking, because one squad is obviously loaded. Between them the reader has
 * to actually weigh two eras against each other, which is the point. */
export const MIN_GAP = 1.5;
export const MAX_GAP = 7.0;

/** Distinct decades a card may draw from. Two, and never the same one twice. */
export const DECADES_PER_CARD = 2;

/**
 * One row per player-season, with the TOT trap handled.
 *
 * @param {Array} rows  rsStats-shaped: { PLAYER, TEAM, YEAR, GP, PTS }
 * @returns {Map} "player|year" -> { player, year, gp, pts, teams, fromTot }
 */
export function seasonTotals(rows) {
  /* Collected in two buckets per player-season and resolved afterwards,
   * because a TOT row can appear before or after the team rows it summarises
   * and a single pass would have to guess. */
  const tot = new Map();
  const parts = new Map();

  for (const r of (rows || [])) {
    const player = r && r.PLAYER;
    const year = parseInt(String((r && r.YEAR) || "").slice(0, 4), 10);
    if (!player || !isFinite(year)) continue;
    const team = String((r && r.TEAM) || "").trim().toUpperCase();
    const gp = parseInt(r.GP, 10) || 0;
    const pts = parseFloat(r.PTS) || 0;
    const key = player + "|" + year;

    if (team === "TOT") {
      /* The league's own total for a split season. Trusted over the sum of the
       * parts: they agree when both are present, and when they disagree the
       * TOT row is the one the source vouches for. */
      tot.set(key, { player, year, gp, pts, teams: 0, fromTot: true });
      continue;
    }
    if (!parts.has(key)) {
      parts.set(key, { player, year, gp: 0, pts: 0, teams: 0, fromTot: false });
    }
    const p = parts.get(key);
    p.gp += gp;
    p.pts += pts;
    p.teams++;
  }

  const out = new Map();
  for (const [key, p] of parts) out.set(key, p);
  for (const [key, t] of tot) {
    /* Carry across how many teams the parts saw, so a caller can say "split
     * between two teams" without re-deriving it. The TOT row does not know. */
    const p = parts.get(key);
    out.set(key, Object.assign({}, t, { teams: p ? p.teams : 1 }));
  }
  return out;
}

/** Points per game, to one decimal, from a season total. */
export function ppg(s) {
  return (s && s.gp > 0) ? Math.round((s.pts / s.gp) * 10) / 10 : 0;
}

/** "2015-16" from an ENDING year, which is what rsStats YEAR is. */
export function seasonLabel(year) {
  return (year - 1) + "-" + String(year % 100).padStart(2, "0");
}

/** "1960s" from a season's ending year. */
export function decadeOf(year) {
  return (year - (year % 10)) + "s";
}

/**
 * The seasons a card may use at all.
 *
 * @param {Map} totals  from seasonTotals()
 * @param {object} opts { minGp, minPpg }
 * @returns {Array} [{ player, year, gp, pts, ppg, decade, label }]
 */
export function eligibleSeasons(totals, opts) {
  const o = Object.assign({ minGp: MIN_GP, minPpg: MIN_PPG }, opts || {});
  const out = [];
  for (const s of (totals || new Map()).values()) {
    if (s.gp < o.minGp) continue;
    const p = ppg(s);
    if (p < o.minPpg) continue;
    out.push({
      player: s.player, year: s.year, gp: s.gp, pts: s.pts, ppg: p,
      decade: decadeOf(s.year), label: seasonLabel(s.year), teams: s.teams
    });
  }
  /* Sorted so every downstream pick is reproducible: a rebuild must produce
   * the same card for the same story_key or the feed's seen-list silently
   * stops working. */
  out.sort((a, b) => (b.ppg - a.ppg) || a.player.localeCompare(b.player) || (a.year - b.year));
  return out;
}

/**
 * The scoring environment of a season, from the same rows.
 *
 * Points per player-game across every qualifying season in that year. Not
 * "pace" - pace is possessions and this file has no possessions - but it moves
 * with pace and it is defined precisely by what is here, which a borrowed pace
 * figure would not be. The reveal quotes it as what it is.
 *
 * @param {Array} seasons  from eligibleSeasons()
 * @returns {Map} year -> { ppg, n }
 */
export function scoringByYear(seasons) {
  const agg = new Map();
  for (const s of (seasons || [])) {
    if (!agg.has(s.year)) agg.set(s.year, { pts: 0, gp: 0, n: 0 });
    const a = agg.get(s.year);
    a.pts += s.pts; a.gp += s.gp; a.n++;
  }
  const out = new Map();
  for (const [year, a] of agg) {
    out.set(year, { ppg: a.gp > 0 ? Math.round((a.pts / a.gp) * 10) / 10 : 0, n: a.n });
  }
  return out;
}

/** Mean scoring environment across a set of seasons, one decimal. */
export function environmentOf(squad, byYear) {
  const vals = squad.map(s => (byYear.get(s.year) || {}).ppg || 0).filter(v => v > 0);
  if (!vals.length) return 0;
  return Math.round((vals.reduce((n, v) => n + v, 0) / vals.length) * 10) / 10;
}

/* A stable index from a string, so a rebuild picks the same squads. Same
 * FNV-style walk used by lib/career_teams.mjs, for the same reason. */
function stableIndex(text, n) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return n > 0 ? h % n : 0;
}

/** Total of a squad's scoring averages, one decimal. */
export function squadTotal(squad) {
  return Math.round(squad.reduce((n, s) => n + s.ppg, 0) * 10) / 10;
}

/**
 * Five from one decade, at most one season per player.
 *
 * Walks the decade's seasons from a stable offset and takes the first five
 * distinct men. Offset rather than "the top five" because the top five of a
 * decade is the same card every time and there is more than one good five in
 * any ten years.
 *
 * @returns {Array|null} five seasons, or null if the decade cannot fill one
 */
export function squadFrom(seasons, seed, used) {
  if (!seasons || seasons.length < SQUAD) return null;
  const taken = [];
  const names = new Set();
  const start = stableIndex(seed, seasons.length);
  for (let i = 0; i < seasons.length && taken.length < SQUAD; i++) {
    const s = seasons[(start + i) % seasons.length];
    /* One season per man per card, and never a man who is already on the
     * opposing five: the same name on both sides reads as an error whatever
     * the seasons are. */
    if (names.has(s.player)) continue;
    if (used && used.has(s.player)) continue;
    names.add(s.player);
    taken.push(s);
  }
  return taken.length === SQUAD ? taken : null;
}

/** Seeds tried per decade pairing before giving up on it.
 *
 * ONE SEED PER PAIRING IS NOT ENOUGH, and finding that out cost a rewrite.
 * Eight decades give 28 pairings, and the first five of any two decades land
 * inside the gap band only by luck - most pairings miss it by twenty points.
 * A pool of three cards is not a card type. Walking seeds turns the band from
 * something a pairing has to happen to satisfy into something it is searched
 * for, which is the difference between three cards and sixty. */
export const SEED_ATTEMPTS = 60;

/** Cards taken from any one decade pairing.
 *
 * More than one is fine and desirable: there are several good fives in any ten
 * years. Capped so that a pairing with a deep pool cannot crowd out the rest
 * of the pool and leave the feed asking about the same two decades all day. */
export const PER_PAIRING = 3;

/**
 * The cards.
 *
 * Every decade pairing, searched over seeds for two fillable fives whose
 * totals land inside the gap band. Pairings and seeds are both walked in a
 * fixed order, so the pool is identical on every build.
 *
 * @param {Array} seasons  from eligibleSeasons()
 * @param {object} opts { minGap, maxGap, attempts, perPairing }
 * @returns {Array} [{ a, b, aTotal, bTotal, gap, higher, decades, seed }]
 */
export function squadPairs(seasons, opts) {
  const o = Object.assign({
    minGap: MIN_GAP, maxGap: MAX_GAP,
    attempts: SEED_ATTEMPTS, perPairing: PER_PAIRING
  }, opts || {});
  const byDecade = new Map();
  for (const s of (seasons || [])) {
    if (!byDecade.has(s.decade)) byDecade.set(s.decade, []);
    byDecade.get(s.decade).push(s);
  }
  const decades = [...byDecade.keys()].sort();
  const out = [];

  for (let i = 0; i < decades.length; i++) {
    for (let j = i + 1; j < decades.length; j++) {
      const da = decades[i], db = decades[j];
      let takenHere = 0;
      /* Fives already used from this pairing, by the names they are made of,
       * so three cards about the sixties and the nineties are three different
       * questions rather than the same one with the men reordered. */
      const seen = new Set();

      for (let k = 0; k < o.attempts && takenHere < o.perPairing; k++) {
        const seed = da + "|" + db + "|" + k;
        const a = squadFrom(byDecade.get(da), seed + "|a", null);
        if (!a) break;   // the decade cannot fill a five at all; no seed will
        const b = squadFrom(byDecade.get(db), seed + "|b", new Set(a.map(s => s.player)));
        if (!b) break;

        const aTotal = squadTotal(a), bTotal = squadTotal(b);
        const gap = Math.round(Math.abs(aTotal - bTotal) * 10) / 10;
        /* THE BAND IS THE QUALITY GATE. Too close and the reader is guessing;
         * too far and there is nothing to guess. The builder reports how many
         * seeds were rejected by it, so the bounds can be judged against real
         * numbers rather than defended in the abstract. */
        if (gap < o.minGap || gap > o.maxGap) continue;
        /* A tie has no answer at all. Excluded by the floor above, and checked
         * again because a future caller passing minGap: 0 must not quietly
         * ship a card with two right answers. */
        if (aTotal === bTotal) continue;

        const fingerprint = a.map(s => s.player).sort().join("|") + "::" +
                            b.map(s => s.player).sort().join("|");
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);

        out.push({
          a, b, aTotal, bTotal, gap, seed,
          higher: aTotal > bTotal ? "a" : "b",
          decades: [da, db]
        });
        takenHere++;
      }
    }
  }
  return out;
}
