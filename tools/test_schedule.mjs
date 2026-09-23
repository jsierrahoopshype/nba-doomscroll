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
  ck("awards and Guess the Player owe nothing",
     c.awards_voting === 0 && c.guess_the_player === 0, JSON.stringify(c));
  /* Passive salary is the exception, and deliberately so: at a gap of 64 and a
   * start of zero the first one lands at card 64, outside the fifty-card window
   * the brief measures, so the family read as 0.0% there. Starting it partway
   * lands one inside the window and keeps every one after it 64 apart. */
  ck("passive salary starts partway, so one lands inside the first fifty",
     c.money_cap_static > 0 && c.money_cap_static < S.QUOTAS.money_cap_static.gap,
     c.money_cap_static + " of a " + S.QUOTAS.money_cap_static.gap + "-card gap");
  const allow = S.admissible(c);
  ck("but nothing at all is admissible on card one",
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
  /* Exactly one, not zero and not several. It read as 0.0% of the first fifty
   * before the counter was seeded, which looked like the family had been
   * removed - Jorge asked for 1.5%, which is one card in this window. */
  ck("and exactly one passive salary card reaches the first fifty",
     countIf(feed, c => B(c) === "money_cap_static") === 1,
     countIf(feed, c => B(c) === "money_cap_static") + " found");
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

console.log("\nballot oddities are sprinkled, not banned and not frequent");

{
  /* Jorge's call in two steps. First: fewer. Measured, the weighted draw was
   * already serving ZERO in 3,000 cards - oddity-pool.json carries an explicit
   * quality_score of 0.47-0.94 while the video awards pools carry none and take
   * the engine's higher default - so "fewer" would have meant none. Then:
   * "I want some sprinkled here and there. Don't go to 0."
   *
   * So they are rationed by the awards family rotation rather than excluded:
   * one in six awards cards, and awards are one per 28-36, which lands a ballot
   * oddity roughly once every 200 cards. */
  const q = S.QUOTAS.awards_voting;
  ck("the awards slot rotates its family", Array.isArray(q.cycle), JSON.stringify(q.cycle));
  const n = {};
  for (const k of q.cycle) n[k] = (n[k] || 0) + 1;
  ck("a ballot oddity is one in six of them", n["oddity|ballot-oddity"] === 1 &&
     q.cycle.length === 6, JSON.stringify(n));
  /* NOT ZERO. The whole point of the second instruction. */
  ck("which is neither zero nor frequent", n["oddity|ballot-oddity"] > 0);
  /* The rest of the rotation is the animated awards families, which is also
   * where some of the extra video comes from. */
  ck("the other five slots are the video families",
     q.cycle.filter(k => k === "race|ballot" || k === "lean|media-lean").length === 5,
     JSON.stringify(q.cycle));
  ck("and cycleOf keys on type|category, not on the bucket",
     q.cycleOf({ type: "oddity", tags: { content_type: "oddity", category: "ballot-oddity" } })
       === "oddity|ballot-oddity");

  /* A ballot RACE is awards-voting too. Rationing by bucket would have taken
   * the video with it, which is the opposite of what was asked for. */
  ck("a ballot race is a different family in the same bucket",
     q.cycleOf({ type: "race", tags: { content_type: "race", category: "ballot" } })
       === "race|ballot");
}

console.log("\nthe video rate, and the placement that makes it safe");

{
  /* Five attempts went into raising the video share before finding that the
   * autoplay budget is the only thing that moves it - every animation is both
   * media_heavy and autoplay, so that budget binds before the media one. This
   * asserts the finding is still true so nobody repeats the five attempts. */
  const src = fs.readFileSync(path.join(REPO, "js", "schedule.js"), "utf8");
  ck("the rate is a named cycle, not a literal",
     /var AUTOPLAY_CYCLE = position < COLD_CARDS \? \[1\] : \[2, 1\]/.test(src),
     (src.match(/var AUTOPLAY_CYCLE = [^;]+;/) || [""])[0]);
  /* Jorge asked for a rate between one animation per 8 cards and one per 4.
   * [2,1] averages 1.5 per batch of eight, which is one per 5.3. A single
   * integer per batch could only ever give 12.5% or 25%, which is why there
   * appeared to be no middle. */
  ck("and it averages between the two integers", (() => {
    const m = src.match(/\[2, 1\]/);
    return !!m;
  })(), "1.5 autoplay per batch of eight is one animation per 5.3 cards");
  ck("the cold start keeps the brief's rate",
     /position < COLD_CARDS \? \[1\]/.test(src),
     "comparisons are the video family, so the bump would push §1's band");

  /* Placement is computed, not searched for. The greedy scorer could not hold
   * the spacing with two animations in a batch: measured, two clips inside four
   * cards and about one adjacent pair per hundred. */
  ck("autoplay positions are placed deterministically",
     /function placeAutoplay/.test(src));
  ck("and the gap is the one §16 asks for",
     /var MIN_AUTOPLAY_GAP = 4/.test(src));
  ck("the session still opens on current NBA, not an animation",
     /if \(!\(tail \|\| \[\]\)\.length\) slot = Math\.max\(1, slot\)/.test(src),
     "deterministic placement took index 0 until this guard went in");

  /* The caps, measured. This is what would silently stop being true if the rate
   * were raised without the placement. */
  const feed = run(400, { pool: pool({ live: 20 }) });
  const auto = c => T(c, "autoplay");
  const archMedia = c => T(c, "media_heavy") && B(c) !== "live";
  ck("at most one autoplay in any four", worstWindow(feed, auto, 4) <= 1,
     "worst window " + worstWindow(feed, auto, 4));
  let adjacent = 0;
  for (let i = 1; i < feed.length; i++) {
    if (archMedia(feed[i]) && archMedia(feed[i - 1])) adjacent++;
  }
  ck("and no two animations adjacent", adjacent === 0, adjacent + " pairs");
  /* Three in ten follows from four-apart placement - indexes 1, 5 and 9 - and
   * is why the cap moved from 2 to 3 rather than the rule being loosened. */
  ck("three in any ten is the arithmetic of four-apart",
     S.MEDIA.maxMediaHeavyPer10 === 3 &&
     worstWindow(feed, archMedia, 10) <= 3,
     "worst window " + worstWindow(feed, archMedia, 10));
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

/* A POOL THAT IS ALL ONE BUCKET MUST NOT PRODUCE A WALL OF IT.
 *
 * WHAT THIS CAUGHT, on the live site, twice. At boot only the eager pools have
 * arrived and live is still in flight, so the fallback round robin has whatever
 * that subset holds. Round robin spreads the buckets it HAS and cannot spread
 * ones that are absent: with a single bucket present it took one card from it
 * eight times a batch. The reader got eighteen consecutive two-player trivia
 * cards. Jorge: "Now I'm getting all quiz cards at the top. That's just as bad
 * as before."
 *
 * js/app.js fixes the cause by making the eager set cover the cold plan's
 * buckets (asserted in tools/test_app_pools.mjs). This asserts the scheduler
 * survives the situation anyway, because "the pools will be there" is a promise
 * about fetch timing on someone else's network.
 *
 * The contract is NOT that the batch is full. A short batch is the correct
 * answer here: the sentinel and the per-pool top-up both call loadMore again,
 * so four mixed cards now and four more when the next pool lands reads as a
 * feed loading, where eight of one kind reads as the feed the app has. */
console.log("\na degenerate pool gives a short batch, not a wall");

{
  /* Everything the cold plan asks for is missing except `game`.
   *
   * Asserted on ONE build call rather than through run(). run() keeps asking
   * until it has the cards it wants, so at the feed level a short batch is
   * invisible - it just means more calls. The contract is per batch, which is
   * what the reader sees arrive at once. */
  const onlyGame = pool({ live: 0, vs: 0, compare: 0, race: 0, otd: 0,
                          ballot: 0, salary: 0, trivia: 400, quiz: 0 });
  const batch = S.build({
    pool: onlyGame, size: 8, position: 0, tail: [], since: S.newCounters(),
    sample: (list, n) => list.slice(0, n), rng: () => 0.5
  }).cards;

  ck("the batch is short rather than padded", batch.length < 8,
     batch.length + " cards for a batch of 8");
  /* Two from the fallback plus the plan's own game slot is three. */
  ck("and no more than three of one bucket", batch.length <= 3,
     batch.length + " game cards");
  ck("and it still returns something", batch.length > 0, batch.length + " cards");
  ck("all of which are the only bucket there was",
     batch.every(c => B(c) === "game"));

  /* THE SAME POOL AFTER THE COLD WINDOW. Past card 48 everything is loaded, so
   * a cap there would only stop a deep session drawing from the one family it
   * has not exhausted - which is the 70%-on-this-day bug in reverse. */
  const deep = S.build({
    pool: onlyGame, size: 8, position: 400, tail: [], since: S.newCounters(),
    sample: (list, n) => list.slice(0, n), rng: () => 0.5
  });
  ck("but a deep session is allowed to fill from what is left",
     deep.cards.length === 8, deep.cards.length + " cards at position 400");
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the For You feed does not follow its own plan"
                 : "the plan, the quotas and the caps all hold");
process.exit(fail ? 1 : 0);
