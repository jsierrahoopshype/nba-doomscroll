/* The For You scheduler: what the next batch is made of, and in what order.
 *
 * WHY THIS EXISTS AT ALL
 *
 * E.sampleMixed type-balances a batch. That was written to stop a thin pool
 * being buried under a fat one, and it is right for on-this-day cards. Applied
 * across fourteen archive types it inverts: `ballot` at 160 cards and `lean` at
 * 99 get a slice the size of `vs` at 1,920, so awards-voting material - which
 * should be a curiosity - arrived at roughly the rate of the feed's biggest
 * family. Measured on the shipped code, the first fifty cards were 14.0%
 * awards, 13.4% comparisons and 42.7% current NBA against a 65-70% target.
 *
 * Type is the wrong unit. A reader does not experience "a lean card" and "a
 * ballot race" as two different things; they experience both as more awards
 * voting. So this schedules by EDITORIAL BUCKET (js/editorial.js) and leaves
 * the drawing itself to the engine, which means the reader's learned weights,
 * the freshness rule and the story spacing all still apply inside each bucket.
 * This decides how many of each kind; the engine still decides which ones.
 *
 * THREE MECHANISMS, AND THEY DO DIFFERENT JOBS
 *
 *   1. THE PLAN. How many slots each bucket gets in this batch. Cold start and
 *      steady state have their own plans, because the first fifty cards are
 *      what the brief is actually about.
 *   2. THE QUOTAS. Awards, passive salary and Guess the Player are not planned
 *      for at all; they are ADMITTED, one at a time, only once enough cards
 *      have passed since the last one. That is what turns "1 per 25-40" from an
 *      aspiration into an arithmetic fact.
 *   3. THE ORDER. A batch with the right contents can still read badly - two
 *      autoplaying clips together, three comparisons in a row. The batch is
 *      arranged against the feed's real tail, not just against itself.
 *
 * DEGRADATION IS THE NORMAL CASE, NOT THE ERROR CASE. Live cards are fetched in
 * the reader's browser and there are perhaps fifty of them on a good day. A
 * plan asking for five live cards per batch of eight exhausts that in ten
 * batches, and a reader scrolls further than that. So every plan has a fallback
 * ORDER of buckets, and an unfilled live slot goes to history before it goes to
 * comparisons, and to comparisons before it ever goes to awards. A quiet news
 * day should read as more history, not as more ballots.
 *
 * Nothing here is random on its own: the caller passes the sampler and the
 * shuffle, so a test gets the same batch twice and the audit can drive the real
 * thing.
 */
(function (root) {
  "use strict";

  var ED = root.DoomEditorial;

  /* How long the cold-start plan applies. §1 and §2 of the brief are about "the
   * first 40-50 cards", and 48 is six batches of eight - a whole number of
   * batches, so the last cold batch is not half-planned. */
  var COLD_CARDS = 48;

  /* SLOTS PER BATCH OF EIGHT.
   *
   * Cold start reads as 5 live, 1 game, 1 history, 1 comparison - which is
   * 62.5% / 12.5% / 12.5% / 12.5%. §2 asks for 6-7 live, 1-2 playable, 1
   * history and 0-1 comparison per ten, and per eight that is 5.2 / 1.2 / 0.8 /
   * 0.4. Whole cards do not divide that way, so the rounding is stated rather
   * than hidden: live takes 5, and the spare slot goes to comparison, which is
   * the bucket the archive has most of and therefore the one least likely to
   * leave a batch short.
   *
   * Steady state is the same shape. The brief gives explicit numbers only for
   * the cold start, but the success criterion it is measured against - "a feed
   * that is overwhelmingly about the NBA happening right now" - does not stop
   * at card fifty. What changes after the cold start is the FALLBACK: once live
   * supply is gone, a steady-state feed leans on history and games rather than
   * holding slots open for live cards that are not coming. */
  var PLANS = {
    cold: {
      slots: { live: 5, game: 1, history_record: 1, comparison: 1 },
      /* Where an unfillable slot goes. Awards and passive money are
       * deliberately absent: they are admitted by quota or not at all. */
      fallback: ["live", "history_record", "game", "comparison"]
    },
    steady: {
      slots: { live: 5, game: 1, history_record: 1, comparison: 1 },
      fallback: ["live", "history_record", "game", "comparison", "comparison"]
    }
  };

  /* THE THROTTLES. Each is "at most one, and only after this many cards".
   *
   * `gap` is the minimum number of cards since the last one of its kind. The
   * measured rates before this existed: awards every 4.7 cards against a target
   * of 25-40, passive salary every 13.1 against 100, Guess the Player every
   * 12.5 against 20-30.
   *
   * `window` is a second, tighter rule for awards: §5 says never two in a
   * twelve-card window and never two adjacent. The gap of 25 already implies
   * both, and the window check stays as the thing that would catch a future
   * change to the gap rather than as belt and braces. */
  var QUOTAS = {
    awards_voting:  { kind: "bucket", gap: 28, window: 12 },
    money_cap_static: { kind: "bucket", gap: 100, window: 100 },
    /* 22 measured out at one per 33.5 rather than the 20-30 asked for: the
     * gap is a floor, and a batch that is already full pushes the actual
     * spacing past it. 18 lands inside the band. */
    guess_the_player: { kind: "trait", gap: 18, window: 12 }
  };

  /* §16, WITH ONE DELIBERATE DEPARTURE THAT JORGE SHOULD OVERRULE IF HE WANTS.
   *
   * The brief says no two media-heavy cards adjacent and at most two in any ten.
   * Applied literally that is unsatisfiable alongside the 65-70% live target,
   * because a Buzz card IS media-heavy - it carries the post's image or video -
   * and thirty-three live cards in fifty cannot also be two media-heavy cards
   * in ten. One of the two targets has to give.
   *
   * So the cap counts ARCHIVE media only: the races, comparisons, teammates and
   * media-lean animations, which are the cards that actually cost a data plan
   * and stack up visually. Live cards are exempt from the count, and the
   * autoplay cap - one per four - still applies to everything, which is the
   * part that governs what is moving on screen. Set liveCountsAsMedia to true
   * to get the literal reading back. */
  var MEDIA = {
    maxMediaHeavyPer10: 2,
    maxAutoplayPer4: 1,
    noAdjacentMediaHeavy: true,
    noAdjacentSameBucket: true,
    liveCountsAsMedia: false
  };

  function sum(obj) {
    var n = 0;
    for (var k in obj) if (obj.hasOwnProperty(k)) n += obj[k];
    return n;
  }

  function bucketOf(c) { return ED.bucketOf(c); }
  function hasTrait(c, t) { return ED.hasTrait(c, t); }

  /** A fresh set of the counters the quotas run on.
   *
   * THEY START AT ZERO, NOT AT "ALREADY DUE". The first version started them at
   * Infinity, on the reasoning that a reader who has never seen an awards card
   * is overdue for one. Measured, that fired all three throttles inside the
   * first twenty-four cards - an awards card, a salary card and a quiz card in
   * the opening stretch, which is the exact stretch the brief is about. A cold
   * start is not a backlog. The first awards card now arrives around card 28,
   * the first passive salary card around 100, and the first Guess the Player
   * around 22, which is what the targets actually ask for. */
  function newCounters() {
    return { awards_voting: 0, money_cap_static: 0, guess_the_player: 0, served: 0 };
  }

  /** Advance the counters by one served card. */
  function countCard(since, card) {
    for (var k in QUOTAS) {
      if (!QUOTAS.hasOwnProperty(k)) continue;
      var hit = QUOTAS[k].kind === "trait" ? hasTrait(card, k) : bucketOf(card) === k;
      since[k] = hit ? 0 : (since[k] === Infinity ? Infinity : since[k] + 1);
    }
    since.served++;
    return since;
  }

  /** Which throttled kinds may appear in a batch starting here, at most once. */
  function admissible(since) {
    var out = {};
    for (var k in QUOTAS) {
      if (!QUOTAS.hasOwnProperty(k)) continue;
      out[k] = (since[k] === Infinity) || (since[k] >= QUOTAS[k].gap);
    }
    return out;
  }

  function matchesKind(card, kind) {
    return QUOTAS[kind].kind === "trait" ? hasTrait(card, kind) : bucketOf(card) === kind;
  }

  /* A card is available to the ordinary plan only if it is not something the
   * quotas govern. Otherwise a ballot card would win a `comparison` slot the
   * moment a ballot race counted as a comparison - which is exactly the kind of
   * leak the bucket/trait split was built to prevent. */
  function isThrottled(card) {
    for (var k in QUOTAS) {
      if (QUOTAS.hasOwnProperty(k) && matchesKind(card, k)) return true;
    }
    return false;
  }

  /**
   * Build the next batch.
   *
   * @param o.pool     candidate cards, already filtered to what may be drawn
   * @param o.size     how many cards are wanted
   * @param o.position how many cards the reader has already been served
   * @param o.tail     the last cards actually on screen, oldest first. Used for
   *                   adjacency, so the first card of this batch is arranged
   *                   against the last card of the previous one.
   * @param o.since    counters from newCounters()/countCard(). Not mutated.
   * @param o.sample   function(cards, n, opts) -> cards. The engine's sampler,
   *                   injected so the reader's learned weights still decide
   *                   WHICH card inside a bucket.
   * @param o.avoid    the engine's avoid set, passed through to sample.
   * @param o.rng      function() -> [0,1). Only used to break ties in ordering.
   * @returns {{ cards: Array, since: Object, plan: Object, shortfall: Object }}
   */
  function build(o) {
    var pool = o.pool || [];
    var size = o.size || 8;
    var position = o.position || 0;
    var tail = (o.tail || []).slice();
    var since = o.since || newCounters();
    var sample = o.sample || function (list, n) { return list.slice(0, n); };
    var rng = o.rng || Math.random;

    var plan = PLANS[position < COLD_CARDS ? "cold" : "steady"];

    /* A SIXTH LIVE CARD EVERY OTHER BATCH.
     *
     * Five live in eight is 62.5% and the target is 65-70%, so a plan of whole
     * cards cannot sit inside the band on its own: five is under, six is 75%
     * and over. Every other batch measured 70.0%, right on the ceiling, and it
     * took comparisons down to 4.0% against a 5-8% target - the extra live card
     * comes off comparison, and taking it too often starves the bucket. Every
     * third batch gives 5.33 per batch, which lands both inside their bands.
     *
     * Only while live supply lasts, and only in the cold start. Past card 48
     * there is usually no live material left to take a sixth slot with, and
     * asking for one would just hand the slot to the fallback anyway. */
    var slots = plan.slots;
    if (position < COLD_CARDS && Math.floor(position / size) % 3 === 2) {
      /* The slot comes off HISTORY, not comparison. Taking it off comparison
       * measured 4.0% against a 5-8% band while history sat at 12%, the top of
       * its own 8-12% band - so the donor was the bucket that could least
       * afford it and the one at its ceiling was untouched. */
      slots = { live: plan.slots.live + 1, game: plan.slots.game,
                history_record: Math.max(0, plan.slots.history_record - 1),
                comparison: plan.slots.comparison };
    }
    var allow = admissible(since);

    /* Buckets first, throttled kinds second, so a card that is both (a ballot
     * race is `awards_voting` AND media-heavy) is only ever offered through the
     * quota path. */
    var byBucket = {};
    var throttled = {};
    var used = {};
    for (var i = 0; i < pool.length; i++) {
      var c = pool[i];
      if (isThrottled(c)) {
        for (var k in QUOTAS) {
          if (QUOTAS.hasOwnProperty(k) && matchesKind(c, k)) {
            (throttled[k] = throttled[k] || []).push(c);
            break;
          }
        }
      } else {
        var b = bucketOf(c);
        (byBucket[b] = byBucket[b] || []).push(c);
      }
    }

    var picked = [];

    /* THE MEDIA BUDGET, SPENT AT DRAW TIME AND NOT AT ORDER TIME.
     *
     * Ordering alone cannot satisfy §16. If a batch of eight arrives holding
     * five autoplaying animations, every arrangement of it breaks the cap, and
     * the scorer can only choose which violation to commit. The thousand-card
     * audit showed exactly that: once live supply ran out around card fifty the
     * batches filled with comparisons, which ARE the animations, and the feed
     * went to five archive-media cards in ten and three autoplays in four.
     *
     * So the budget is spent here. A bucket asked for two cards gets its
     * non-media candidates first and only spends budget when it has to. That
     * works because the buckets are not uniform: `vs` is a comparison and a
     * static score card, `otd` is history with no animation at all, so a
     * comparison slot can be filled without spending media budget.
     *
     * The per-batch numbers come off the per-window ones: two archive-media in
     * ten is 1.6 in eight, one autoplay in four is two in eight. Ordering still
     * runs afterwards, and it is what handles the batch BOUNDARY - two batches
     * each legal on their own can still put their media cards next to each
     * other. */
    var budget = { media: 2, autoplay: 1 };
    var isMedia = function (c) {
      return hasTrait(c, "media_heavy") &&
             (MEDIA.liveCountsAsMedia || bucketOf(c) !== "live");
    };

    var take = function (list, n) {
      if (!list || !list.length || n <= 0) return [];
      var free = list.filter(function (x) { return !used[x.id]; });
      if (!free.length) return [];

      /* THE BUDGET IS SPENT, NOT HOARDED.
       *
       * The first version took quiet candidates first and only reached for an
       * animation when it ran out. Measured, that produced zero archive-media
       * cards in any ten - because a comparison slot can always be filled by a
       * `vs` score card, of which there are 1,920. The feed lost its races,
       * teammates and comparison animations entirely and filled up with exactly
       * the static score cards Jorge had already asked for less of.
       *
       * "Show this content less often, not shorter" means it still shows. So
       * the budget is spent first, up to its cap, and the rest of the slot goes
       * to quiet cards. Two archive-media and one autoplay per batch of eight
       * is the cap doing its job rather than banning the content. */
      var quiet = [], loud = [];
      for (var q = 0; q < free.length; q++) {
        (isMedia(free[q]) ? loud : quiet).push(free[q]);
      }
      var got = [];
      if (loud.length && budget.media > 0) {
        var room = Math.min(n, budget.media);
        var more = sample(loud, room, { avoid: o.avoid }) || [];
        for (var m = 0; m < more.length; m++) {
          if (hasTrait(more[m], "autoplay") && budget.autoplay <= 0) continue;
          budget.media--;
          if (hasTrait(more[m], "autoplay")) budget.autoplay--;
          got.push(more[m]);
          if (got.length >= n) break;
        }
      }
      if (got.length < n && quiet.length) {
        var fill = sample(quiet, n - got.length, { avoid: o.avoid }) || [];
        for (var z = 0; z < fill.length; z++) got.push(fill[z]);
      }
      for (var j = 0; j < got.length; j++) { used[got[j].id] = 1; picked.push(got[j]); }
      return got;
    };

    /* 1. THE QUOTAS, FIRST.
     *
     * They run BEFORE the plan, and the plan then fills what is left. The
     * obvious order - plan first, then admit - was what I wrote first, and it
     * produced exactly zero awards cards and zero Guess the Player cards in
     * fifty: the plan's slots already added up to the whole batch, so the
     * admitted card was drawn, appended past the end, and cut off by the
     * truncation to `size`. A throttle that silently becomes a ban is worse
     * than no throttle, because the feed looks fine and a whole family has
     * quietly left it.
     *
     * At most one admitted kind per batch, and only one kind: a batch carrying
     * both an awards card and a salary card reads as a run of database material
     * however far apart each is from its own kind. */
    var admittedOne = false;
    for (var k2 in QUOTAS) {
      if (!QUOTAS.hasOwnProperty(k2)) continue;
      if (admittedOne || !allow[k2]) continue;
      if (take(throttled[k2], 1).length) admittedOne = true;
    }

    /* 2. THE PLAN, trimmed by whatever the quota already took.
     *
     * The slot comes off the bucket with the most cards behind it, which is
     * comparisons - the family the brief wants least of and the archive has
     * most of. Taking it off `live` instead would mean an awards card cost the
     * reader a current-NBA card, which is precisely backwards. */
    var shortfall = {};
    var want = {};
    for (var w in slots) if (slots.hasOwnProperty(w)) want[w] = slots[w];
    var over = picked.length + sum(want) - size;
    for (var t = plan.fallback.length - 1; t >= 0 && over > 0; t--) {
      var name = plan.fallback[t];
      var cut = Math.min(over, want[name] || 0);
      want[name] -= cut;
      over -= cut;
    }
    for (var b2 in want) {
      if (!want.hasOwnProperty(b2)) continue;
      var got2 = take(byBucket[b2], want[b2]);
      if (got2.length < want[b2]) shortfall[b2] = want[b2] - got2.length;
    }

    /* 3. FALLBACK, ROUND ROBIN, ONE CARD AT A TIME.
     *
     * Slots the plan could not fill go to the fallback buckets, never to a
     * throttled kind. The order matters and the FIRST version of this drained
     * each bucket in turn, which was wrong in a way only the thousand-card
     * audit showed: live supply is about fifty cards, so from roughly card
     * fifty onward every spare slot went to the first fallback bucket, and a
     * 1,000-card session came out 70% on-this-day. Correct by the letter of the
     * plan, and nobody would read it.
     *
     * Round robin instead, one card per bucket per pass, so a session that has
     * outrun the live feed reads as a mixed archive rather than as one pool
     * with the others behind it. `comparison` appears twice in the steady list
     * because it is the biggest family by a distance - 4,336 cards against
     * 1,133 history - and a feed that draws them evenly exhausts history first
     * and then repeats it.
     *
     * Live stays at the head of the list: a card that IS current beats any
     * archive card, and on a busy day there is more live material than the
     * plan's five slots. */
    var pass = 0;
    while (picked.length < size && pass < size * plan.fallback.length) {
      var before = picked.length;
      for (var f = 0; f < plan.fallback.length && picked.length < size; f++) {
        take(byBucket[plan.fallback[f]], 1);
      }
      if (picked.length === before) break;   /* nothing left anywhere */
      pass++;
    }
    /* Still short: anything at all that is not throttled, so the feed does not
     * simply stop. A reader deep into a session has exhausted the pools the
     * plan names, and an empty batch ends the feed. */
    if (picked.length < size) {
      var rest = [];
      for (var b3 in byBucket) {
        if (byBucket.hasOwnProperty(b3) && !want[b3]) rest = rest.concat(byBucket[b3]);
      }
      take(rest, size - picked.length);
    }

    return {
      cards: order(picked.slice(0, size), tail, rng),
      since: since,
      /* The TRIMMED plan, not the nominal one: reporting plan.slots here hid
       * the fact that a quota batch had taken the comparison slot. */
      plan: want,
      shortfall: shortfall
    };
  }

  /* ---------------- ordering ----------------
   *
   * The batch has the right contents; this decides the sequence. Greedy, one
   * card at a time, scored against the cards already placed INCLUDING the tail
   * of the feed the reader is looking at - otherwise every batch boundary is a
   * place where two autoplaying clips can meet.
   *
   * Scoring rather than filtering, because a hard filter can paint itself into
   * a corner: five media-heavy cards and nowhere legal to put the fifth would
   * mean returning a short batch, and a short batch is a worse outcome for the
   * reader than two clips in a row. So a violation costs points and the least
   * bad card wins.
   */
  function order(cards, tail, rng) {
    var out = [];
    var left = cards.slice();
    var seq = tail.slice();          /* what the reader has actually seen */

    function countsAsMedia(card) {
      if (!hasTrait(card, "media_heavy")) return false;
      return MEDIA.liveCountsAsMedia || bucketOf(card) !== "live";
    }
    function mediaIn(n) {
      var c = 0;
      for (var i = Math.max(0, seq.length - n); i < seq.length; i++) {
        if (countsAsMedia(seq[i])) c++;
      }
      return c;
    }
    function autoplayIn(n) {
      var c = 0;
      for (var i = Math.max(0, seq.length - n); i < seq.length; i++) {
        if (hasTrait(seq[i], "autoplay")) c++;
      }
      return c;
    }

    while (left.length) {
      var best = null, bestScore = -Infinity, bestIdx = 0;
      for (var i = 0; i < left.length; i++) {
        var c = left[i];
        var prev = seq.length ? seq[seq.length - 1] : null;
        var score = 0;

        /* A live card is what the feed is for, so it wins ties and opens the
         * session: §3 wants the first card current. */
        if (bucketOf(c) === "live") score += 3;
        if (!seq.length && bucketOf(c) === "live") score += 20;
        /* §3 wants the first playable card at index 6-8: far enough in that the
         * session opens on the NBA rather than on a game, close enough that a
         * reader meets one early. Held back through the first six cards. */
        if (seq.length < 6 && hasTrait(c, "playable")) score -= 10;

        if (countsAsMedia(c)) {
          if (MEDIA.noAdjacentMediaHeavy && prev && countsAsMedia(prev)) score -= 60;
          if (mediaIn(9) + 1 > MEDIA.maxMediaHeavyPer10) score -= 40;
        }
        if (hasTrait(c, "autoplay")) {
          if (autoplayIn(3) + 1 > MEDIA.maxAutoplayPer4) score -= 50;
        }
        if (MEDIA.noAdjacentSameBucket && prev && bucketOf(prev) === bucketOf(c)) {
          /* Cheap compared with a media violation: two history cards in a row
           * is a texture problem, two autoplaying clips is a data-plan problem.
           * Live is exempt, because consecutive live cards ARE the feed. */
          if (bucketOf(c) !== "live") score -= 8;
        }
        /* The same source twice running reads as one outlet's timeline rather
         * than as the NBA. */
        if (prev && bucketOf(c) === "live" && bucketOf(prev) === "live") {
          var a = c.payload && (c.payload.source || c.payload.outlet);
          var b = prev.payload && (prev.payload.source || prev.payload.outlet);
          if (a && b && a === b) score -= 12;
        }
        score += rng() * 0.5;   /* tie-break, deterministic under a seeded rng */

        if (score > bestScore) { bestScore = score; best = c; bestIdx = i; }
      }
      left.splice(bestIdx, 1);
      out.push(best);
      seq.push(best);
    }
    return out;
  }

  root.DoomSchedule = {
    COLD_CARDS: COLD_CARDS,
    PLANS: PLANS,
    QUOTAS: QUOTAS,
    MEDIA: MEDIA,
    newCounters: newCounters,
    countCard: countCard,
    admissible: admissible,
    isThrottled: isThrottled,
    build: build,
    order: order
  };
})(typeof window !== "undefined" ? window : this);
