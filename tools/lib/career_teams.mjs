/* Which franchises a man actually played for, and which one he did not.
 *
 * WHY
 *
 * The Career Map has been a promo card in this feed: a hook, a link, and a
 * reader who has to leave to do anything. This is the question that game asks,
 * made playable where the reader already is - four badges, one of which he
 * never wore.
 *
 * THE ONLY HARD PART IS THE WRONG ANSWER.
 *
 * Three teams he played for are easy: they are in the stats. The fourth has to
 * be a team he never played for, and that claim can fail in three ways that all
 * look fine in a spreadsheet:
 *
 *   The team did not exist. "Karl Malone never played for the Grizzlies" is
 *   true and worthless: they arrived in 1995 and he was a Jazz player until
 *   2003. A distractor has to have existed for his WHOLE career, or the answer
 *   is a fact about expansion rather than about him.
 *
 *   He played for them once. A ten-day contract is still a season in the file.
 *   A distractor needs zero appearances, ever, under any of that franchise's
 *   names - which is why this works in franchise keys rather than team codes.
 *   Seattle and Oklahoma City are one answer.
 *
 *   The three right answers are not defensible. A man who played four games
 *   for a team did play for them, and a reader who gets it wrong will feel
 *   cheated rather than beaten. The three shown are his biggest stints.
 *
 * Nothing here reads a reputation or a narrative. It reads games played.
 */

/** Franchises he must have a real stint with before there is a question. */
export const MIN_FRANCHISES = 3;

/** Games at a franchise before it counts as having played for them.
 *
 * Not zero, and the reason is the card rather than the truth: one game IS
 * playing for them, and a question whose right answers include a four-game
 * stint reads as a trick. This gate applies only to the three teams SHOWN. The
 * wrong answer is held to zero games, because there the truth is the whole
 * claim. */
export const MIN_GAMES = 20;

/** Options on the card. Three he played for, one he did not. */
export const OPTIONS = 4;

/**
 * Season rows to per-franchise stints.
 *
 * @param {Array} rows  rsStats-shaped: { PLAYER, TEAM, YEAR, GP }
 * @param {object} opts { franchiseOf(code, year) -> key|null }
 * @returns {Map} player -> Map(franchiseKey -> { games, seasons, from, to })
 */
export function careerStints(rows, opts) {
  const o = opts || {};
  const resolve = o.franchiseOf || (() => null);
  const out = new Map();
  for (const r of (rows || [])) {
    const name = r && r.PLAYER;
    const code = r && String(r.TEAM || "").trim();
    const year = parseInt(String(r && r.YEAR || "").slice(0, 4), 10);
    if (!name || !code || !isFinite(year)) continue;
    /* A row whose team cannot be resolved is skipped rather than guessed. It
     * costs a stint; guessing costs the answer. */
    const key = resolve(code, year);
    if (!key) continue;
    const games = parseInt(r.GP, 10) || 0;

    if (!out.has(name)) out.set(name, new Map());
    const byKey = out.get(name);
    if (!byKey.has(key)) byKey.set(key, { key, games: 0, seasons: 0, from: year, to: year });
    const s = byKey.get(key);
    s.games += games;
    s.seasons++;
    s.from = Math.min(s.from, year);
    s.to = Math.max(s.to, year);
  }
  return out;
}

/* A stable index from a name, so the wrong answer for a player is the same in
 * every build. The pool is rebuilt often and the feed remembers what a reader
 * has seen by story_key; a card whose options reshuffle nightly is a different
 * question wearing the same key. */
function stableIndex(text, n) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return n > 0 ? h % n : 0;
}

/**
 * One question per player, or none.
 *
 * @param {Map} stints  from careerStints()
 * @param {object} opts {
 *   eligible: [franchiseKey]   franchises a card may name at all. The caller
 *                              owns this: it is the set with a current badge to
 *                              show, which is a fact about the image files
 *                              rather than about basketball.
 *   existedIn(key, year) -> bool
 *   minGames, minFranchises
 * }
 * @returns {Array} [{ player, played: [stint x3], never: key, from, to,
 *                     franchises, games }]
 */
export function careerMapQuestions(stints, opts) {
  const o = Object.assign({ minGames: MIN_GAMES, minFranchises: MIN_FRANCHISES }, opts || {});
  const eligible = o.eligible || [];
  const existed = o.existedIn || (() => true);
  const out = [];

  for (const [player, byKey] of (stints || new Map())) {
    const all = [...byKey.values()];
    if (!all.length) continue;
    const from = Math.min(...all.map(s => s.from));
    const to = Math.max(...all.map(s => s.to));

    /* The three to show: real stints, biggest first, and only at franchises the
     * card can put a badge on. Ties break on the name so a rebuild does not
     * reorder them. */
    const shown = all
      .filter(s => s.games >= o.minGames && eligible.includes(s.key))
      .sort((a, b) => (b.games - a.games) || a.key.localeCompare(b.key))
      .slice(0, o.minFranchises);
    if (shown.length < o.minFranchises) continue;

    /* The one to show that he never played for. Zero appearances under ANY of
     * that franchise's names, and in the league for every season of his career,
     * so the answer is about him and not about expansion. */
    const candidates = eligible.filter(k =>
      !byKey.has(k) && existed(k, from) && existed(k, to));
    if (!candidates.length) continue;
    const never = candidates[stableIndex(player, candidates.length)];

    out.push({
      player, played: shown, never, from, to,
      franchises: byKey.size,
      games: all.reduce((n, s) => n + s.games, 0),
      /* How many of his stints were too thin to show. Not a gate, a number the
       * builder can report: a high count across the pool would mean MIN_GAMES
       * is throwing away good questions. */
      thinStints: all.filter(s => s.games < o.minGames).length
    });
  }
  return out;
}

/* ---------------- badges ----------------
 *
 * The card needs a logo per franchise, and the logo URLs are keyed by NBA team
 * id, which lives in nba-headshots/teams/metadata/teams.json - a file outside
 * this repo, on a path no builder here already knows.
 *
 * It does not have to. data/vault-pool.json is IN this repo and every on-this-
 * day card in it carries both team names and both logo URLs. Thirty franchises,
 * all resolvable through the same matcher everything else uses. A file that is
 * already committed and already correct beats a new path in paths.cmd that
 * somebody has to set on every machine.
 *
 * Hard-coding the thirty ids was the other option and it is worse: they would
 * be written from memory, they cannot be checked here, and a wrong one is a
 * silently blank badge.
 */

/**
 * @param {Array} cards  vault-pool cards, any that carry *_name and *_logo
 * @param {object} opts  { franchiseOf(text, year) -> key|null }
 * @returns {Map} franchiseKey -> { logo, name }
 */
export function badgesFromPool(cards, opts) {
  const resolve = (opts && opts.franchiseOf) || (() => null);
  const out = new Map();
  for (const c of (cards || [])) {
    const p = (c && c.payload) || {};
    /* The season the card is about, because "Charlotte" needs a year before it
     * means anything. A card with no season falls back to a modern one, which
     * is right for a logo file named "current". */
    const year = parseInt(String(p.season || "").slice(0, 4), 10) || 2020;
    for (const side of ["home", "away"]) {
      const name = p[side + "_name"], logo = p[side + "_logo"];
      if (!name || !logo) continue;
      const key = resolve(name, year);
      if (!key || out.has(key)) continue;
      out.set(key, { logo, name });
    }
  }
  return out;
}

/**
 * The four options in a stable order, and where the answer sits.
 *
 * Shuffled, because three-then-one puts the answer last on every card, and
 * stable, because the same player must get the same board in every build.
 *
 * @returns {{ keys: [string], answerIdx: number }}
 */
export function layOut(q) {
  const keys = q.played.map(s => s.key).concat([q.never]);
  /* A deterministic rotation rather than a shuffle: enough to move the answer
   * off the end, and reproducible without carrying a seed around. */
  const shift = stableIndex(q.player + "|board", keys.length);
  const rotated = keys.slice(shift).concat(keys.slice(0, shift));
  return { keys: rotated, answerIdx: rotated.indexOf(q.never) };
}
