/* The For You scheduler, against the shipped js/schedule.js.
 *
 *     node tools/test_schedule.mjs
 *
 * WHAT THIS SUITE IS FOR
 *
 * The audit measures the feed and reports percentages. Percentages are a bad
 * regression test: they move for a dozen reasons, they need a thousand cards to
 * stabilise, and a number drifting from 8.0% to 6.5% tells you nothing about
 * which rule broke. This suite tests the RULES, on fixtures small enough to
 * reason about, so a failure names the mechanism.
 *
 * Four of the checks below exist because they caught a real bug in this
 * scheduler while it was being written, and each is labelled with what it
 * caught. None of them were hypothetical:
 *
 *   - the quota card drawn and then truncated away, so awards and Guess the
 *     Player came out at exactly zero rather than rationed
 *   - the fallback draining one bucket, so a 1,000-card session was 70%
 *     on-this-day
 *   - the media budget hoarded rather than spent, so every animation vanished
 *     and the feed filled with the static score cards Jorge wanted less of
 *   - the counters starting at "already due", so all three throttles fired
 *     inside the first twenty-four cards
 *
 * The scheduler is loaded headlessly the same way the audit loads the engine,
 * so this exercises the file the browser runs.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* ---- the shipped modules, headless ---- */
const win = {};
for (const f of ["editorial.js", "schedule.js"]) {
  new Function("window", fs.readFileSync(path.join(REPO, "js", f), "utf8"))(win);
}
const S = win.DoomSchedule;
const ED = win.DoomEditorial;

ck("js/schedule.js defines window.DoomSchedule", !!S);
ck("and it reads the shared classification", !!ED);
if (!S || !ED) { console.log("\n1 failed"); process.exit(1); }

/* ---- fixtures ----
 *
 * Shaped like real cards only where the scheduler looks: type, tags.category,
 * tags.players, payload.source. Deliberately generous - hundreds of every
 * bucket - so a shortfall in a result means the scheduler chose not to draw
 * one, never that there was nothing to draw. */
const mk = (type, category, i, extra) => Object.assign({
  id: type + "-" + category + "-" + i,
  type,
  tags: { content_type: type, category, players: ["Player " + i], teams: ["T" + (i % 8)] },
  payload: { source: "src" + (i % 6), published_at: new Date().toISOString() }
}, extra || {});

function pool(opts) {
  const o = Object.assign({ live: 60, vs: 200, compare: 200, race: 200, otd: 200,
                            trivia: 200, quiz: 200, ballot: 100, salary: 100 }, opts);
  const out = [];
  for (let i = 0; i < o.live; i++) out.push(mk("buzz", "", i));
  for (let i = 0; i < o.vs; i++) out.push(mk("vs", "comparison", i));
  for (let i = 0; i < o.compare; i++) out.push(mk("compare", "comparison", i));
  for (let i = 0; i < o.race; i++) out.push(mk("race", "team", i));
  for (let i = 0; i < o.otd; i++) out.push(mk("otd", "on-this-day", i));
  for (let i = 0; i < o.trivia; i++) out.push(mk("trivia", "trivia", i));
  for (let i = 0; i < o.quiz; i++) out.push(mk("quiz", "guess-the-player", i));
  for (let i = 0; i < o.ballot; i++) out.push(mk("ballot", "ballot-trivia", i));
  for (let i = 0; i < o.salary; i++) out.push(mk("salary", "salary", i));
  return out;
}

/* A deterministic run of N cards. The sampler is `take the first n`, which
 * makes every assertion below reproducible: the engine's weighting is the
 * app's business and is not what this suite is testing. */
function run(cards, opts) {
  const o = opts || {};
  const all = o.pool || pool();
  const used = {};
  const feed = [];
  const since = S.newCounters();
  let seed = 1;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let guard = 0;
  while (feed.length < cards && guard++ < cards) {
    const avail = all.filter(c => !used[c.id]);
    if (!avail.length) break;
    const r = S.build({
      pool: avail, size: 8, position: feed.length,
      tail: feed.slice(Math.max(0, feed.length - 12)), since,
      sample: (list, n) => list.slice(0, n), rng
    });
    if (!r.cards.length) break;
    for (const c of r.cards) {
      if (feed.length >= cards) break;
      used[c.id] = 1; feed.push(c); S.countCard(since, c);
    }
  }
  return feed;
}

const B = c => ED.bucketOf(c);
const T = (c, t) => ED.hasTrait(c, t);
const countIf = (feed, p) => feed.filter(p).length;
const gapsOf = (feed, p) => {
  const at = []; feed.forEach((c, i) => { if (p(c)) at.push(i); });
  const g = []; for (let i = 1; i < at.length; i++) g.push(at[i] - at[i - 1]);
  return { at, min: g.length ? Math.min(...g) : null, n: at.length };
};
const worstWindow = (feed, p, size) => {
  let worst = 0;
  for (let i = 0; i + size <= feed.length; i++) {
    let n = 0; for (let j = i; j < i + size; j++) if (p(feed[j])) n++;
    if (n > worst) worst = n;
  }
  return worst;
};

console.log("\nthe counters start at zero, not at `already due`");

{
  /* CAUGHT A REAL BUG. They started at Infinity, on the reasoning that a reader
   * who has never seen an awards card is overdue for one. That fired all three
   * throttles inside the first 24 cards - an awards card, a salary card and a
   * quiz card in the opening stretch, which is the stretch the brief is about. */
  const c = S.newCounters();
  ck("a fresh session owes nothing",
     c.awards_voting === 0 && c.money_cap_static === 0 && c.guess_the_player === 0,
     JSON.stringify(c));
  const allow = S.admissible(c);
  ck("so nothing is admissible on card one",
     !allow.awards_voting && !allow.money_cap_static && !allow.guess_the_player,
     JSON.stringify(allow));

  const feed = run(24);
  ck("and the first 24 cards carry no awards card",
     countIf(feed, x => B(x) === "awards_voting") === 0,
     countIf(feed, x => B(x) === "awards_voting") + " found");
  ck("and no passive salary card",
     countIf(feed, x => B(x) === "money_cap_static") === 0);
}

console.log("\nthe throttled kinds appear, and at their stated rate");

{
  /* CAUGHT A REAL BUG. The quotas used to run AFTER the plan, and the plan
   * already filled the batch, so the admitted card was drawn, appended past the
   * end and cut off by the truncation to `size`. Awards and Guess the Player
   * came out at exactly 0.0% - a throttle that had silently become a ban. */
  const feed = run(400);

  const aw = gapsOf(feed, c => B(c) === "awards_voting");
  ck("awards cards do appear", aw.n > 0, aw.n + " in 400 cards");
  ck("and never closer together than the gap",
     aw.min === null || aw.min >= S.QUOTAS.awards_voting.gap,
     "closest pair: " + aw.min + ", gap is " + S.QUOTAS.awards_voting.gap);
  ck("and never two in a 12-card window",
     worstWindow(feed, c => B(c) === "awards_voting", 12) <= 1);

  const gtp = gapsOf(feed, c => T(c, "guess_the_player"));
  ck("Guess the Player appears", gtp.n > 0, gtp.n + " in 400 cards");
  ck("and respects its own gap",
     gtp.min === null || gtp.min >= S.QUOTAS.guess_the_player.gap,
     "closest pair: " + gtp.min);

  const money = gapsOf(feed, c => B(c) === "money_cap_static");
  ck("passive salary is rare rather than absent", money.n > 0, money.n + " in 400 cards");
  ck("and never closer than 100 apart",
     money.min === null || money.min >= S.QUOTAS.money_cap_static.gap,
     "closest pair: " + money.min);

  /* One kind per batch: a batch carrying both an awards card and a salary card
   * reads as a run of database material however far each is from its own kind. */
  const both = [];
  for (let i = 0; i + 8 <= feed.length; i += 8) {
    const slice = feed.slice(i, i + 8);
    const kinds = new Set();
    for (const c of slice) {
      if (B(c) === "awards_voting") kinds.add("awards");
      if (B(c) === "money_cap_static") kinds.add("money");
      if (T(c, "guess_the_player")) kinds.add("gtp");
    }
    if (kinds.size > 1) both.push(i);
  }
  ck("no batch carries two throttled kinds at once", both.length === 0,
     both.length ? "batches at " + both.slice(0, 4).join(", ") : "");
}

console.log("\na quiet news day reads as more history, not as more ballots");

{
  /* The failure mode the brief is really about: before this, a failed Buzz load
   * left the first fifty cards 19.2% awards voting. */
  const feed = run(50, { pool: pool({ live: 0 }) });
  ck("with no live cards the feed still fills", feed.length === 50, feed.length + " cards");
  ck("and awards stay rationed",
     countIf(feed, c => B(c) === "awards_voting") <= 2,
     countIf(feed, c => B(c) === "awards_voting") + " awards cards in 50");
  ck("and passive salary stays out of the first fifty",
     countIf(feed, c => B(c) === "money_cap_static") === 0);
}

console.log("\nthe fallback shares the spare slots out");

{
  /* CAUGHT A REAL BUG. The fallback drained each bucket in turn, so once live
   * supply ran out around card fifty every spare slot went to the FIRST
   * fallback bucket, and a 1,000-card session came out 70% on-this-day. Correct
   * by the letter of the plan, and nobody would read it. */
  const feed = run(300, { pool: pool({ live: 40 }) });
  const after = feed.slice(60);      /* past the live supply */
  const counts = {};
  for (const c of after) counts[B(c)] = (counts[B(c)] || 0) + 1;
  const biggest = Math.max(...Object.values(counts));
  ck("no single bucket takes over once live runs out",
     biggest / after.length < 0.5,
     Object.entries(counts).map(([k, v]) =>
       `${k} ${(100 * v / after.length).toFixed(0)}%`).join(", "));
  ck("history, games and comparisons all keep appearing",
     ["history_record", "game", "comparison"].every(b => (counts[b] || 0) > 0));
}

console.log("\nthe media budget is spent, and capped");

{
  /* CAUGHT TWO REAL BUGS, one in each direction. Taking quiet cards first meant
   * a comparison slot always went to a static `vs` score card - 1,920 of them -
   * so the races, teammates and comparison animations disappeared entirely and
   * the feed filled with exactly the cards Jorge had asked for less of. Not
   * capping the draw at all meant five archive-media cards in ten and three
   * autoplays in four, because ordering cannot fix a batch whose CONTENTS
   * already break the cap. */
  const feed = run(300, { pool: pool({ live: 20 }) });
  const archiveMedia = c => T(c, "media_heavy") && B(c) !== "live";

  ck("animations still reach the feed",
     countIf(feed, archiveMedia) > 0,
     countIf(feed, archiveMedia) + " of 300 cards");
  ck("at most two archive-media cards in any ten",
     worstWindow(feed, archiveMedia, 10) <= S.MEDIA.maxMediaHeavyPer10,
     "worst window: " + worstWindow(feed, archiveMedia, 10));
  ck("at most one autoplay in any four",
     worstWindow(feed, c => T(c, "autoplay"), 4) <= S.MEDIA.maxAutoplayPer4,
     "worst window: " + worstWindow(feed, c => T(c, "autoplay"), 4));

  let adjacent = 0;
  for (let i = 1; i < feed.length; i++) {
    if (archiveMedia(feed[i]) && archiveMedia(feed[i - 1])) adjacent++;
  }
  ck("and none of them sit next to each other", adjacent === 0, adjacent + " adjacent pairs");
}

console.log("\nthe session opens the way the brief asks");

{
  const feed = run(50);
  ck("the first card is current NBA", B(feed[0]) === "live", B(feed[0]));
  const firstPlayable = feed.findIndex(c => T(c, "playable"));
  ck("the first playable card is at index 6-8",
     firstPlayable >= 5 && firstPlayable <= 9, "index " + firstPlayable);
  const live = countIf(feed, c => B(c) === "live");
  ck("and the first fifty are 65-70% current",
     live >= 32 && live <= 36, live + " live cards of 50");
}

console.log("\nthe plan is reported as it was actually applied");

{
  /* The returned plan used to be the nominal one, which hid the fact that a
   * quota batch had taken a slot from it. A report that does not match what was
   * served is how tuning goes wrong. */
  const all = pool();
  const since = S.newCounters();
  since.awards_voting = 999;          /* due */
  const r = S.build({
    pool: all, size: 8, position: 0, tail: [], since,
    sample: (list, n) => list.slice(0, n), rng: () => 0.5
  });
  const planned = Object.values(r.plan).reduce((a, b) => a + b, 0);
  ck("the reported plan plus the quota card fits the batch", planned <= 8,
     "plan sums to " + planned);
  ck("and the awards card is actually in the batch",
     r.cards.some(c => B(c) === "awards_voting"));
  ck("and the batch is the size asked for", r.cards.length === 8, r.cards.length + " cards");
}

console.log("\nit is deterministic under a fixed sampler and rng");

{
  const a = run(80).map(c => c.id).join(",");
  const b = run(80).map(c => c.id).join(",");
  ck("two runs of the same inputs agree", a === b);
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the For You feed does not follow its own plan"
                 : "the plan, the quotas and the caps all hold");
process.exit(fail ? 1 : 0);
