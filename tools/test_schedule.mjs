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

console.log("\nBALLOT ODDITY cards: a tenth of what they were, and never zero");

{
  /* HISTORY OF THIS RULE, because it has moved three times.
   *
   * First Jorge asked for fewer, and the weighted draw was already serving zero
   * in 3,000 cards. Then: "I want some sprinkled here and there. Don't go to 0",
   * which put one ballot-oddity slot in the awards family rotation. Then, Sept
   * 24 2026: "I see too many of these Ballot Oddities. Cut to 10 percent of what
   * it is now."
   *
   * The third one looked contradictory until it was measured properly. Four
   * families render under the BALLOT ODDITY chip - ballot oddities proper,
   * award-history droughts, career oddities and records - and only the first
   * was ever rationed. The audit hid the rest by counting 1,069 on-this-day
   * cards the app drops on load, so history_record looked like on-this-day when
   * in a reader's browser it was nearly all career oddities. Real shares: 9.1%
   * of the first fifty, 6.9% of a session, half the first screen at boot.
   *
   * So there is one quota for the chip, keyed on type, ahead of every other. */
  const Q = S.QUOTAS;
  const keys = Object.keys(Q);
  ck("the chip has its own quota", !!Q.ballot_oddity_chip, keys.join(", "));
  ck("keyed on the card type, which is what decides the chip",
     Q.ballot_oddity_chip && Q.ballot_oddity_chip.kind === "type" &&
     Q.ballot_oddity_chip.type === "oddity");
  /* First on purpose: a card is routed to the FIRST quota it matches, and half
   * these cards are in the awards bucket. Second, and those would still go
   * through the awards cycle at the old rate. */
  ck("and it is listed first, ahead of the awards quota", keys[0] === "ballot_oddity_chip",
     "order: " + keys.join(", "));
  ck("the awards rotation no longer asks for one",
     !Q.awards_voting.cycle.some(k => /^oddity\|/.test(k)), JSON.stringify(Q.awards_voting.cycle));
  ck("and the rest of that rotation is still the video families",
     Q.awards_voting.cycle.every(k => k === "race|ballot" || k === "lean|media-lean"));

  /* BEHAVIOUR, on a pool that holds all four families in both buckets, and
   * enough of everything else that the plan never starves. */
  const fam = [];
  for (let i = 0; i < 60; i++) fam.push(mk("oddity", "ballot-oddity", i));
  for (let i = 0; i < 60; i++) fam.push(mk("oddity", "career", i));
  for (let i = 0; i < 20; i++) fam.push(mk("oddity", "record", i));
  for (let i = 0; i < 60; i++) fam.push(mk("oddity", "award-history", i));
  const big = pool({ live: 60, vs: 800, compare: 800, race: 400, otd: 400,
                     trivia: 800, quiz: 400, ballot: 200, salary: 200 }).concat(fam);
  const feed = run(1400, { pool: big });
  const odd = feed.filter(c => ED.typeOf(c) === "oddity");
  const firstAt = feed.findIndex(c => ED.typeOf(c) === "oddity");

  ck("none in the opening fifty", firstAt < 0 || firstAt >= 50,
     "first at card " + firstAt);
  /* NOT ZERO. The instruction before this one still stands. */
  ck("but not gone either", odd.length > 0, odd.length + " in " + feed.length);
  /* A tenth of 6.9% is about one in 145. */
  const per = feed.length / Math.max(1, odd.length);
  ck("about one per 140 cards", per >= 120 && per <= 200,
     "one per " + per.toFixed(0));

  /* THE BUG THE AUDIT CAUGHT ON THE FIRST RUN. Two quotas, each obeying its own
   * gap, together broke the awards rule: an awards-bucket oddity landed a few
   * cards after an awards card. `respects` is what stops it. */
  let worst = 0;
  for (let i = 0; i < feed.length; i++) {
    let n = 0;
    for (let j = i; j < Math.min(feed.length, i + 12); j++) if (B(feed[j]) === "awards_voting") n++;
    if (n > worst) worst = n;
  }
  ck("and never two awards-bucket cards in twelve, across both quotas", worst <= 1,
     "worst twelve-card window: " + worst);
}

console.log("\nnewest news first");

{
  /* Jorge, Sept 24 2026: Buzz "shows a lot of older content from 10+ hours
   * ago ... I would most definitely lean towards showing recent content over
   * the older stuff." The live slots used to be a weighted draw across the
   * whole live pool, days deep; now only the newest LIVE_WINDOW unshown cards
   * are eligible, and inside a batch newer sits higher.
   *
   * Measured on the real content-stream index before and after: the first ten
   * news cards went from a median of 17.8 hours old (oldest 39) to 10.4 (oldest
   * 12), and the one post under an hour old moved from position 4 to 1. That
   * morning the index held only two posts under three hours old - the order can
   * be fixed, the supply cannot. */
  const H = 3600000, NOW = Date.now();
  const aged = (i, hours, src) => ({
    id: "live-" + i, type: "buzz",
    tags: { content_type: "buzz", category: "", players: ["P" + i], teams: ["T" + (i % 8)] },
    payload: { source: src || ("src" + (i % 6)), published_at: new Date(NOW - hours * H).toISOString() }
  });
  /* Forty posts, one per hour back to forty hours, shuffled so array order
   * carries no hint of age. */
  const live = [];
  for (let i = 0; i < 40; i++) live.push(aged(i, i + 0.5));
  for (let i = live.length - 1; i > 0; i--) { const j = (i * 7919) % (i + 1); [live[i], live[j]] = [live[j], live[i]]; }
  const arch = pool({ live: 0 });
  const shuffle = (l, n) => { const a = l.slice(); for (let i = a.length - 1; i > 0; i--) { const j = (i * 31 + 7) % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
  const hoursOf = c => (NOW - Date.parse(c.payload.published_at)) / H;

  const src = fs.readFileSync(path.join(REPO, "js", "schedule.js"), "utf8");
  const W = +((src.match(/var LIVE_WINDOW = (\d+);/) || [])[1] || 0);
  ck("the window is a named constant", W > 0, "LIVE_WINDOW = " + W);

  /* A sampler that ignores freshness entirely, so this proves the WINDOW does
   * the work and not the engine's curve. */
  const b1 = S.build({ pool: live.concat(arch), size: 8, position: 0, tail: [],
    since: S.newCounters(), sample: shuffle, rng: () => 0.5 }).cards;
  const news1 = b1.filter(c => B(c) === "live");
  ck("the first batch's news all comes from the newest window",
     news1.length > 0 && news1.every(c => hoursOf(c) < W),
     news1.map(c => hoursOf(c).toFixed(0) + "h").join(" "));
  ck("and the newest of them sits highest", news1.length > 1 &&
     news1.every((c, i) => i === 0 || hoursOf(c) >= hoursOf(news1[i - 1]) - 1e-9),
     news1.map(c => hoursOf(c).toFixed(0) + "h").join(" "));

  /* Older posts are not banned, they wait: once the newest are shown the
   * window slides back in time. */
  const feed = [], used = {}, since = S.newCounters();
  while (feed.length < 120) {
    const r = S.build({ pool: live.concat(arch).filter(c => !used[c.id]), size: 8,
      position: feed.length, tail: feed.slice(-12), since, sample: shuffle, rng: () => 0.5 });
    if (!r.cards.length) break;
    r.cards.forEach(c => { used[c.id] = 1; feed.push(c); S.countCard(since, c); });
  }
  const seq = feed.filter(c => B(c) === "live").map(hoursOf);
  let inversions = 0;
  for (let i = 1; i < seq.length; i++) if (seq[i] + W < seq[i - 1]) inversions++;
  ck("across the session, no post shows up more than a window's worth ahead of its time",
     inversions === 0, inversions + " out of order by more than " + W + "h");
  ck("and the old ones still arrive, later", Math.max(...seq) > 24,
     "oldest shown: " + Math.max(...seq).toFixed(0) + "h");

  /* A live card with no time - the weekly trade trends - has nothing to rank
   * by, so it must stay eligible rather than silently vanish. */
  const digest = { id: "digest-1", type: "tradedigest",
    tags: { content_type: "tradedigest", category: "", players: [], teams: [] }, payload: {} };
  const withDigest = S.build({ pool: live.concat([digest]).concat(arch), size: 8, position: 16,
    tail: [], since: S.newCounters(), sample: l => l.filter(c => c.id === "digest-1").concat(l).slice(0, 8),
    rng: () => 0.5 }).cards;
  ck("an untimed live card is still eligible", withDigest.some(c => c.id === "digest-1"));

  /* Trades carry built_at, not published_at: the window must read it, or a
   * trade built five minutes ago would count as having no time at all. */
  ck("the window reads built_at for trades",
     /p\.published_at \|\| p\.built_at/.test(src));
  const trades = fs.readFileSync(path.join(REPO, "js", "trades.js"), "utf8");
  ck("and trade cards carry it", /built_at: isNaN\(new Date\(t\.ts\)/.test(trades));
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
  /* The plan's own game slot, and nothing else: `game` is not in the cold
   * fallback list, so an orphaned live slot never becomes a quiz. */
  ck("and it is the plan's one game slot, not a fallback pile", batch.length === 1,
     batch.length + " game cards");
  ck("and it still returns something", batch.length > 0, batch.length + " cards");
  ck("all of which are the only bucket there was",
     batch.every(c => B(c) === "game"));

  /* THE ASYMMETRY IS DELIBERATE and is the whole fix, so it is pinned here.
   *
   * At boot the five live slots have nothing to put in them, and whatever the
   * fallback hands them becomes the first screen. A quiz is the least
   * current-NBA card in the pool, so `game` is out of the COLD fallback and
   * keeps only its single plan slot. Past the cold window live really is
   * exhausted, the reader has chosen to keep scrolling, and games belong in the
   * archive mix - so the steady fallback keeps it.
   *
   * Reading the two lists out of the shipped file rather than restating them:
   * putting `game` back in the cold list is the regression, and it would look
   * like a tidy-up in a diff. */
  const schedSrc = fs.readFileSync(path.join(REPO, "js", "schedule.js"), "utf8");
  const coldFb = (/cold:[\s\S]*?fallback: \[([^\]]*)\]/.exec(schedSrc) || [, ""])[1];
  const steadyFb = (/steady:[\s\S]*?fallback: \[([^\]]*)\]/.exec(schedSrc) || [, ""])[1];
  ck("the cold fallback does not include game", !/"game"/.test(coldFb),
     coldFb.replace(/\s+/g, " ").trim());
  ck("and the steady one does", /"game"/.test(steadyFb),
     steadyFb.replace(/\s+/g, " ").trim());
  ck("both still lead with live", /^\s*"live"/.test(coldFb) && /^\s*"live"/.test(steadyFb),
     "a card that IS current beats any archive card");

  /* NO GAMES BEFORE THE NEWS. Jorge, on what the first screen should show
   * while live is loading: "I'd rather have race animations than trivia
   * there." While the pool holds no live card, inside the cold window, the
   * game slot goes to comparison. */
  const bootish = pool({ live: 0, vs: 0, compare: 0, quiz: 0, salary: 0,
                         race: 220, otd: 64, trivia: 300, ballot: 160 });
  const first = S.build({ pool: bootish, size: 8, position: 0, tail: [],
    since: S.newCounters(), sample: (list, n) => list.slice(0, n), rng: () => 0.5 }).cards;
  ck("before any live card, the first batch carries no games",
     first.length > 0 && first.every(c => B(c) !== "game"),
     first.map(c => ED.typeOf(c)).join(", "));
  /* The slot games gave up goes to comparison, and races are the comparison
   * pool that is there at boot. Whether a history card sorts ahead of it is
   * the ordering pass's business, not this rule's. */
  ck("and the slot games gave up goes to a race", first.some(c => ED.typeOf(c) === "race"),
     first.map(c => ED.typeOf(c)).join(", "));

  /* The moment one live card exists, the plan is back to one game in eight.
   * A rule that kept games out after the news landed would be a ban. */
  const withLive = bootish.concat(pool({ live: 40, vs: 0, compare: 0, race: 0, otd: 0,
                                         trivia: 0, quiz: 0, ballot: 0, salary: 0 }));
  const withNews = S.build({ pool: withLive, size: 8, position: 8, tail: [],
    since: S.newCounters(), sample: (list, n) => list.slice(0, n), rng: () => 0.5 }).cards;
  ck("and games return once the news is in the pool",
     withNews.some(c => B(c) === "game"), withNews.map(c => ED.typeOf(c)).join(", "));

  /* Past the cold window the hold lifts even with no live at all: by card 48
   * the news has either arrived or is not coming, and a long session with no
   * games would be a ban by another route. */
  const late = S.build({ pool: bootish, size: 8, position: 400, tail: [],
    since: S.newCounters(), sample: (list, n) => list.slice(0, n), rng: () => 0.5 }).cards;
  ck("and the hold lifts after the cold window", late.some(c => B(c) === "game"),
     late.map(c => ED.typeOf(c)).join(", "));

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
