/* Cap Call: two players, one season, one tap.
 *
 * WHY THIS EXISTS
 *
 * Jorge shelved the cards that promoted the other games - a hook and a link is
 * an advert wearing a card's clothes - and asked for the game itself in the
 * stream, or a lite version of it. The Daily 73-9 cannot be played inside a
 * card: it charges an attempt server-side the moment a draft starts, and the
 * feed runs on a different origin from hoopsmatic.com, so an in-card version
 * would either play under a second device identity (six attempts a day, a
 * loophole he has spent real effort closing) or need cross-origin identity
 * plumbing. Neither is worth it.
 *
 * What the 73-9 games are actually about is value per dollar: the perfect
 * squad is the one that spends $150M best. This is that idea at the size of a
 * card. Two players from the same season, one paid several times the other,
 * and the question is who scored more. The salary is shown and the scoring is
 * hidden, so the money is the misdirection - and pairs are balanced so that
 * the cheaper man wins exactly as often as he loses, which means the salary
 * is not a tell in either direction.
 *
 * WHAT MAKES A PAIR
 *
 *   same season         - so the money is the same money
 *   different teams     - a star and his own backup is not a question
 *   salary ratio >= 3   - otherwise the money is not a story
 *   both >= 8 ppg       - a rookie on a minimum against a star is a gimme
 *   ppg gap >= 3        - there has to be a clear answer
 *   both have headshots - the caller's gate; a grey disc is not a card
 *
 * Every rule is a named constant, so retuning is a number and not a rewrite.
 *
 * THE SELECTION IS DETERMINISTIC. Sorted by interest, greedy under caps, no
 * randomness, so two builds from the same data produce the same pool and a
 * card keeps its identity across rebuilds. Which side the cheaper player sits
 * on is decided by a hash of the pair, for the same reason.
 */

export const CAPCALL = {
  MIN_RATIO: 3,        // dear.salary / cheap.salary
  MIN_PPG: 8,          // both players
  MIN_GAP: 3,          // |dear.ppg - cheap.ppg|
  /* A HOLD IS ONLY A QUESTION WHEN IT IS CLOSE. The first real pool's holds
   * were Curry against Justin Champagnie and LeBron against Jarrett Allen -
   * nobody hesitates. The cheaper man in a hold has to be a real scorer, and
   * the star has to only just outscore him. */
  HOLD_MIN_CHEAP_PPG: 14,
  PER_SEASON: 6,       // cards per season, so 35 seasons do not become 35 of one
  PER_PLAYER: 1,       // a player appears once in the whole pool
  TARGET: 120          // pool size, before the feed's own thinning
};

/* FNV-1a with a finaliser, as in award_sentences.mjs - plain FNV's low bits
 * barely move and `% 2` would put the cheaper player on the same side of
 * every card. */
function hashOf(s) {
  let h = 0x811c9dc5;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Is this season line usable at all? The caller adds its own gates (games,
 * minutes, headshot); these are the ones a pair cannot do without. */
function usable(s) {
  return s && s.player && s.year > 0 && s.salary > 0 && s.ppg > 0 && s.team;
}

/**
 * Build the pairs.
 *
 * @param {Array} seasons  build_salary.mjs's joined records:
 *                         { player, year, team, salary, pts, gp, ppg, ... }
 *                         ALREADY filtered by the caller for games, minutes
 *                         and headshot - this function trusts what it is given.
 * @param {object} opts    overrides for CAPCALL, plus
 *                         recency(year) -> 0..1 weight, default 1
 * @returns {Array<{ year, cheap, dear, upset:boolean, interest:number, cheapSide:"a"|"b" }>}
 *          upset means the cheaper player scored more.
 */
export function pickCapCalls(seasons, opts) {
  const o = Object.assign({}, CAPCALL, opts || {});
  const recency = (o.recency && typeof o.recency === "function") ? o.recency : () => 1;

  const byYear = new Map();
  for (const s of (seasons || [])) {
    if (!usable(s)) continue;
    if (s.ppg < o.MIN_PPG) continue;
    if (!byYear.has(s.year)) byYear.set(s.year, []);
    byYear.get(s.year).push(s);
  }

  /* Every qualifying pair, scored. Interest is ASYMMETRIC, and that is the
   * whole game. An upset - the cheaper man scored more - gets better the wider
   * the gap: Cam Thomas on $2M outscoring Chris Paul on $30M by thirteen a
   * night is the card. A hold - the star scored more - gets better the
   * NARROWER the gap, because a star outscoring a minimum-contract role player
   * by twenty is not a question anyone gets wrong. Money gap has diminishing
   * returns both ways: a 20x ratio is not ten times the story a 2x one is. */
  const cands = [];
  for (const [year, list] of byYear) {
    const sorted = list.slice().sort((a, b) => a.salary - b.salary);
    for (let i = 0; i < sorted.length; i++) {
      const cheap = sorted[i];
      for (let j = i + 1; j < sorted.length; j++) {
        const dear = sorted[j];
        if (dear.salary / cheap.salary < o.MIN_RATIO) continue;
        if (dear.team === cheap.team) continue;
        if (dear.player === cheap.player) continue;
        const gap = Math.abs(dear.ppg - cheap.ppg);
        if (gap < o.MIN_GAP) continue;
        const upset = cheap.ppg > dear.ppg;
        if (!upset && cheap.ppg < o.HOLD_MIN_CHEAP_PPG) continue;
        const shape = upset ? Math.min(gap, 12) : Math.max(1, 12 - gap);
        const interest = Math.log(dear.salary / cheap.salary) * shape * recency(year);
        cands.push({ year, cheap, dear, upset, interest });
      }
    }
  }
  cands.sort((a, b) => b.interest - a.interest ||
    a.year - b.year || a.cheap.player.localeCompare(b.cheap.player));

  /* Greedy under caps, and BALANCED: the cheaper player must win about as
   * often as he loses, or the salary becomes the answer. Interest orders the
   * queue; balance decides whether the next card may be an upset. */
  const out = [];
  const perYear = new Map(), seenPlayer = new Set();
  let upsets = 0, holds = 0;
  for (const c of cands) {
    if (out.length >= o.TARGET) break;
    if ((perYear.get(c.year) || 0) >= o.PER_SEASON) continue;
    if (seenPlayer.has(c.cheap.player) || seenPlayer.has(c.dear.player)) continue;
    if (c.upset && upsets > holds) continue;
    if (!c.upset && holds > upsets) continue;
    out.push(Object.assign({}, c, {
      cheapSide: hashOf(c.cheap.player + "|" + c.dear.player + "|" + c.year) % 2 ? "b" : "a"
    }));
    perYear.set(c.year, (perYear.get(c.year) || 0) + 1);
    seenPlayer.add(c.cheap.player); seenPlayer.add(c.dear.player);
    if (c.upset) upsets++; else holds++;
  }
  return out;
}
