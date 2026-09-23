/* NBA Doomscroll — app shell
 * Tabs, infinite feed, interactions, onboarding, profile panel, share links.
 * VS / Quiz / Trivia / Ballot come from tools/build_data.mjs; the Vault pools
 * (cap-share salaries, ballot oddities, on this day) from tools/build_vault.mjs.
 * Rumors and trades load live in the reader's browser (js/rumors.js,
 * js/trades.js);
 * falling back to sample cards when those endpoints are not reachable.
 */
(function (root) {
  "use strict";

  var E = window.DoomEngine;
  var C = window.DoomCards;
  var esc = C.esc;

  /* RUMORS ARE OFF. Jorge's call, Sept 2026, §4 of the feed-mix brief:
   * "Remove Rumors entirely from For You and live-serving logic."
   *
   * One flag, not a deletion. js/rumors.js, the ten sample cards in
   * data/dummy-cards.json, the tab's blurb and its empty state are all left
   * exactly where they are, so turning rumors back on is setting this to true.
   *
   * It governs four things, each marked RUMORS_ON below: the tab is not
   * offered, LiveRumors is never asked to load, rumor cards are refused at
   * addCards so none can reach ANY pool, and the rumors empty state is
   * unreachable rather than deleted.
   *
   * WHY THE TAB GOES TOO, WHICH IS MORE THAN THE BRIEF ASKED FOR. The only
   * rumor cards this repo ships are the ten marked `dummy`, and the existing
   * comment on swapInLive says why they must never be shown on their own: an
   * invented rumor is a fake NBA report sitting next to HoopsHype, and a
   * screenshot loses the SAMPLE label. Stop fetching the real ones and a
   * Rumors tab can only show those ten. So it is off, not empty. */
  var RUMORS_ON = false;

  var TABS = [
    { key: "foryou", label: "For You" },
    { key: "buzz", label: "Buzz" },
    { key: "trades", label: "Trades" },
    /* RUMORS_ON */
    { key: "rumors", label: "Rumors" },
    { key: "vs", label: "VS" },
    { key: "quiz", label: "Quiz" },
    { key: "vault", label: "History" },
    { key: "races", label: "Races" }
  ].filter(function (t) { return RUMORS_ON || t.key !== "rumors"; });
  var BATCH = 8;
  // Share of every mixed batch reserved for live Content Stream items.
  /* HOW MUCH OF A MIXED BATCH IS BUZZ.
   *
   * It was a flat 40% - three of every eight - which is a lot to promise when
   * the live feed is having a quiet week. Two changes, both Jorge's call:
   *
   * A BAND, NOT A NUMBER. 40% is where a reader starts, and it moves between
   * 15% and 55% with what they actually do: the engine already learns a weight
   * for "type:buzz" from likes, saves, taps and skims, and this reads it.
   * Someone who likes every Buzz card gets more of them; someone who skims
   * past them gets fewer, without ever losing them entirely.
   *
   * AND NEVER BACKFILLED WITH STALE POSTS. The reserved slots are capped at
   * how many FRESH items exist, so a thin news day yields a smaller share
   * rather than three day-old posts propped up to fill a quota. Older Buzz is
   * not banned - it can still win a slot in the ordinary weighted draw. It
   * just stops being guaranteed one. */
  var BUZZ_SHARE = 0.4;
  var BUZZ_MIN = 0.15;
  var BUZZ_MAX = 0.55;
  var BUZZ_FRESH_MS = 48 * 3600 * 1000;
  var TAB_FOR_TYPE = { rumor: "rumors", trade: "trades", buzz: "buzz" };
  var SKIM_MS = 1200; // visible less than this while scrolling past = skim

  /* The one thing allowed to be moving at a time. See js/media.js. */
  var M = root.MediaCoordinator || {
    register: function () {}, unregister: function () {}, note: function () {},
    manualPlay: function () {}, manualPause: function () {}, manualToggle: function () {},
    releaseIn: function () {}, prefersQuiet: function () { return false; }
  };

  var allCards = [];
  /* Which Guess the Player tiers reach the feed at all, and how each is
   * weighted once there. Must match QUIZ_QUALITY in tools/build_data.mjs.
   *
   * Weighting alone could not do this job. quality_score maps to the engine's
   * 0.7x-1.3x band, so the widest possible gap between tiers is 1.65x per
   * card - which is why a clear photograph of Gordon Hayward, a two-time
   * All-Star sitting in the "medium" tier, still came up often enough to
   * notice. Admission is the only lever with any force behind it.
   *
   * Superseded: all three tiers play now, and the mix is held by the
   * scheduler's tier rotation rather than by these weights. See the note on
   * QUIZ_QUALITY itself. */
  /* ALL THREE TIERS PLAY AGAIN, at the mix §10 asks for: hard 60-65%, medium
   * 25-30%, easy 10%.
   *
   * It was `{ hard: 1 }` - 625 cards, every one a player who lasted in the
   * league without ever making an All-Star team - because weighting could not
   * hold a mix on its own. That reasoning was right and is worth keeping in
   * view: quality_score maps to the engine's 0.7x-1.3x band, so the widest
   * possible gap between two tiers is 1.65x per card, which is nowhere near
   * enough to turn 193 easy cards into 10% of the quiz cards served.
   *
   * What changed is that the mix is no longer a weighting problem. The
   * scheduler admits Guess the Player one card at a time (js/schedule.js), so
   * it can rotate the TIER as it goes and hit the ratio exactly. The weights
   * here are therefore all 1: they would only fight the rotation.
   *
   * The 453 easy and medium cards come back with their pictures veiled until
   * the card is answered - see .quiz-sil-mask[data-veil] in css/style.css. A
   * clear photograph of George Mikan is not a question; a clear photograph of
   * a journeyman is. */
  var QUIZ_QUALITY = { hard: 1, medium: 1, easy: 1 };
  var byId = {};
  // Ids currently rendered in the feed. Sampling draws without replacement
  // within one batch, but nothing stopped a LATER batch re-drawing a card that
  // is already on screen — invisible with a 2,000-card pool, glaring with the
  // handful of live trades. Cleared whenever the feed is cleared.
  var rendered = {};
  /* entity: { kind: "player"|"team", value: "LeBron James" } or null.
   *
   * An entity filter deliberately CROSSES tabs rather than narrowing the
   * current one. Tapping LeBron means "show me everything about LeBron" — his
   * comparisons, his quiz cards, his races, his salary cards — and confining
   * that to whichever tab you happened to be on would be a much weaker feature
   * than the one people expect from tapping a name. */
  var state = { tab: "foryou", exhausted: false, loading: false, raceGroup: null,
               entity: null, phase: "own" };

  var feedEl = document.getElementById("feed");
  var tabsEl = document.getElementById("tabs");
  var sentinel = document.getElementById("sentinel");

  /* ---------------- boot ---------------- */

  // Eager pools are small and cover every tab's first screen. vs-pool is ~1.9MB
  // so it streams in behind the first paint and joins the mix on arrival.
  var EAGER_POOLS = ["data/dummy-cards.json", "data/quiz-pool.json",
                     "data/trivia-pool.json", "data/ballot-pool.json"];

  // Lazy pools used to load at boot no matter which tab you were on, so a
  // reader who only ever opened Trades still paid for the 1.9MB VS pool.
  // They are per-tab now. For You genuinely mixes everything, so it still
  // pulls all three — just after the first batch is on screen rather than
  // competing with it.
  /* ---------------- the pool registry: one source of truth ----------------
   *
   * §12-13 of the feed-mix brief. This was two hand-written structures - a
   * TAB_POOLS map and an OPTIONAL_POOLS set - and a pool had to be added to
   * both, plus a third list inside TAB_POOLS for For You. The For You list was
   * the one that got forgotten, and the symptom was subtle enough to survive
   * months of use:
   *
   *   FIVE POOLS, 219 CARDS, REACHED FOR YOU ONLY IF YOU HAD VISITED ANOTHER
   *   TAB FIRST. award-history (55), record (9), career (55), careermap (60)
   *   and dreamteam (40) were listed under History or Quiz and not under For
   *   You, so ensurePools never fetched them for a reader who opened the app
   *   and scrolled. Open History once and they appeared - in For You, for the
   *   rest of the session. The feed a first-time reader saw and the feed a
   *   returning reader saw were different feeds, and which one you got
   *   depended on where you had clicked.
   *
   * So there is one list now, and For You is DERIVED rather than written down:
   * every pool is in For You unless it says otherwise. A pool added to a tab
   * cannot be forgotten here, because there is no second place to remember.
   * tools/test_app_pools.mjs asserts that, and asserts that no pool file in
   * data/ is missing from the registry entirely.
   *
   *   url       the file
   *   tabs      the tabs whose own section draws on it
   *   foryou    default true. false means deliberately not in the mix.
   *   optional  its absence is a normal state, not a broken checkout
   */
  var POOLS = [
    /* ---- VS ---- */
    { url: "data/vs-pool.json",         tabs: ["vs"] },
    { url: "data/teammates-pool.json",  tabs: ["vs"] },
    { url: "data/compare-pool.json",    tabs: ["vs"] },

    /* ---- History ---- */
    { url: "data/vault-pool.json",      tabs: ["vault"] },
    { url: "data/lean-pool.json",       tabs: ["vault"] },
    /* Built from the Media Vote Tracker's ballots by tools/build_oddities.mjs.
     * Absent until that has been run, which is a normal state. */
    { url: "data/oddity-pool.json",     tabs: ["vault"], optional: true },
    /* Built from nba-player-data plus the cap table by tools/build_salary.mjs. */
    { url: "data/salary-pool.json",     tabs: ["vault"], optional: true },
    /* Franchise droughts from 71 seasons of official award voting. Its ids
     * start "oddity-hist-" so the prefix table below already routes them to
     * History - this entry is the whole wiring.
     *
     * Absent until tools/build_award_history.mjs has been run, which is a
     * normal state - and better than committing a placeholder, because an
     * empty pool that exists is indistinguishable from a build that produced
     * nothing. */
    { url: "data/award-history-pool.json", tabs: ["vault"], optional: true },
    /* Records that stood and the seasons that ended them, from the league
     * schedule. Ids start "oddity-rec-", so the prefix table below routes them
     * to History too. The vault needed content that is surprising rather than
     * dated: it was 82% on-this-day cards. Built by tools/build_records.mjs. */
    { url: "data/record-pool.json",     tabs: ["vault"], optional: true },
    /* Careers the award voting remembers differently than anybody else does.
     * Ids start "oddity-career-". Built by tools/build_career_oddities.mjs. */
    { url: "data/career-pool.json",     tabs: ["vault"], optional: true },

    /* ---- Races ---- */
    { url: "data/race-pool.json",       tabs: ["races"] },
    { url: "data/ballotrace-pool.json", tabs: ["races"] },

    /* ---- Quiz ----
     *
     * Cap Call: the value-per-dollar game as a card, built alongside the salary
     * pool. Career Map and Dream Team are the same shape: playable, built from
     * nba-player-data's rsStats, absent until their builder has been run.
     *
     * All three are in For You now, which is the coverage fix above. They are
     * games, and the brief wants games in the mix. */
    { url: "data/capcall-pool.json",    tabs: ["quiz"], optional: true },
    { url: "data/careermap-pool.json",  tabs: ["quiz"], optional: true },
    { url: "data/dreamteam-pool.json",  tabs: ["quiz"], optional: true },

    /* ---- off, and left in the registry rather than deleted ----
     *
     * FRIVOLITIES ARE OFF. Jorge's call, Sept 2026: the cards were weak. The
     * pool file, its builder and its tests are all left exactly where they are.
     * Turning them back on is putting a tab in `tabs` and dropping the
     * `foryou: false`.
     *
     * It is built from the HoopsHype archive by a script run on a machine that
     * has it (tools/build_frivolities.mjs), and the archive is not public, so a
     * checkout without the file is a normal state.
     *
     * THE GAME CARDS ARE OFF TOO. Jorge's call, Sept 2026, on seeing two of
     * them at the top of For You: "I don't want cards promoting the games. I
     * want the game in the stream (or a lite version of it) if possible. If
     * not, shelve them from the stream."
     *
     * They were a hook plus a link - an advert wearing a card's clothes - and
     * the feed has real playable cards a few rows below them, which is what
     * makes the contrast obvious. data/games.json, its test and its entries in
     * data/links.json are untouched. */
    { url: "data/frivolities-pool.json", tabs: [], foryou: false, optional: true },
    { url: "data/games.json",            tabs: [], foryou: false, optional: true }
  ];

  /* Everything below is DERIVED. Nothing here is a second place to remember a
   * pool, which is the whole point of the registry. */

  var TAB_POOLS = (function () {
    var out = { foryou: [] };
    POOLS.forEach(function (p) {
      (p.tabs || []).forEach(function (t) { (out[t] = out[t] || []).push(p.url); });
      /* Default true: a pool has to opt OUT of the mix, not into it. */
      if (p.foryou !== false && (p.tabs || []).length) out.foryou.push(p.url);
    });
    return out;
  })();

  var OPTIONAL_POOLS = (function () {
    var out = {};
    POOLS.forEach(function (p) { if (p.optional) out[p.url] = 1; });
    return out;
  })();
  var poolPromises = {};
  // Set when a live source could not be reached, so the tab can say so instead
  // of quietly showing nothing.
  var liveFailed = {};

  /* "On this day" has to mean today, so the 2,000-card vault pool is filtered
   * down to the current calendar date on load. Roughly 50 dates in the year
   * have no NBA game in 80 seasons of history (deep summer), so when today is
   * empty the nearest date that does have games is used instead. */
  function todayMd(offsetDays) {
    var d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  function pickOtdDate(list) {
    var have = {};
    list.forEach(function (c) { if (c.type === "otd" && c.payload.date) have[c.payload.date] = 1; });
    for (var off = 0; off <= 7; off++) {
      if (have[todayMd(-off)]) return todayMd(-off);
      if (off && have[todayMd(off)]) return todayMd(off);
    }
    return null;
  }

  /* Quiz ballot questions and Vault ballot oddities are built by two different
   * tools off the same reporter ballots, so the same award-season-player could
   * be both stated outright in the Vault ("exactly one voter put X first") and
   * asked about in the Quiz. Deduped here rather than at build time because the
   * two builders run on different schedules — a claim file written by one would
   * go stale the moment the other ran.
   *
   * The Vault statement wins: it is the card that carries the finding. */
  function ballotKeys(card) {
    var p = card.payload || {};
    if (!p.award_key || !p.season || !p.subjects) return [];
    return p.subjects.map(function (s) { return p.season + "|" + p.award_key + "|" + s; });
  }
  var claimedBallots = Object.create(null);

  function dropDuplicateBallots() {
    allCards.forEach(function (c) {
      if (c.type === "oddity") ballotKeys(c).forEach(function (k) { claimedBallots[k] = 1; });
    });
    var before = allCards.length;
    allCards = allCards.filter(function (c) {
      if (c.type !== "ballot") return true;
      var keys = ballotKeys(c);
      var dup = keys.length && keys.some(function (k) { return claimedBallots[k]; });
      if (dup) delete byId[c.id];
      return !dup;
    });
    if (before !== allCards.length) {
      console.info("[doomscroll] dropped " + (before - allCards.length) + " ballot questions already covered by a Vault card");
    }
  }

  function addCards(list) {
    var otdDate = null;
    if ((list || []).some(function (c) { return c.type === "otd"; })) {
      otdDate = pickOtdDate(list);
    }
    // When the fallback picks a nearby date, the card must stop claiming
    // "on this day" — it is a different day, and saying otherwise is just
    // wrong. Those cards say "Around this date" instead.
    var otdExact = otdDate === todayMd(0);
    var quizDropped = 0;
    var rumorsDropped = 0;
    (list || []).forEach(function (c) {
      if (byId[c.id]) return;
      /* RUMORS_ON. Refused at the door rather than filtered at draw time.
       *
       * poolForTab("foryou") returns allCards without looking at c.tab, so a
       * card that reaches allCards reaches For You whatever it is tagged with -
       * which is exactly how ten sample rumors tagged tab:["rumors"] were
       * turning up in For You. Keeping them out of allCards is the only place
       * the answer is the same for every pool, every tab and the entity
       * filter. */
      if (!RUMORS_ON && c.type === "rumor") { rumorsDropped++; return; }
      if (c.type === "otd" && c.payload.date && otdDate && c.payload.date !== otdDate) return;
      if (c.type === "otd" && !otdExact) c.payload.approx = true;
      /* Guess the Player shows a clear, full photograph, so the difficulty has
       * to come from the player rather than from the picture. A tier that is
       * not in QUIZ_QUALITY does not reach the feed at all - see the note
       * there for why weighting was not enough on its own. */
      if (c.type === "quiz" && c.payload) {
        var tier = c.payload.difficulty;
        if (QUIZ_QUALITY[tier] === undefined) { quizDropped++; return; }
        if (typeof c.quality_score !== "number") c.quality_score = QUIZ_QUALITY[tier];
      }
      /* Story keys and quality for the pools whose builders emit neither, so
       * the engine's spacing and weighting apply to every card type rather
       * than to the three that happened to be built last. Fills gaps only -
       * see js/story.js. */
      if (root.DoomStory) root.DoomStory.annotate(c);
      byId[c.id] = c;
      allCards.push(c);
    });
    /* Said out loud rather than dropped quietly: a tier filter that silently
     * removes a third of a pool is exactly the kind of thing that gets
     * forgotten and then puzzled over six months later. */
    if (quizDropped) {
      console.info("[doomscroll] quiz: " + quizDropped +
        " cards held back (tiers outside " + Object.keys(QUIZ_QUALITY).join(", ") + ")");
    }
    if (rumorsDropped) {
      console.info("[doomscroll] rumors are off: " + rumorsDropped +
        " card(s) held back (set RUMORS_ON to turn them back on)");
    }
  }

  function fetchPool(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    }).then(function (d) { return d.cards || []; })
      .catch(function (e) {
        if (!OPTIONAL_POOLS[url]) throw e;
        console.info("[doomscroll] optional pool absent: " + url +
          " (build it with tools/build_frivolities.mjs)");
        return [];
      });
  }

  function deferIdle(fn) {
    if (root.requestIdleCallback) root.requestIdleCallback(fn, { timeout: 2500 });
    else root.setTimeout(fn, 1200);
  }

  // Which tab a shared card id belongs to, from its id prefix. Used only to
  // decide which pool to pull first when a link opens cold.
  function tabForShareId(id) {
    if (/^race-/.test(id)) return TAB_POOLS.races;
    if (/^(vs|mates|compare)-/.test(id)) return TAB_POOLS.vs;
    if (/^lean-/.test(id)) return TAB_POOLS.vault;
    if (/^(salary|oddity|otd)-/.test(id)) return TAB_POOLS.vault;
    if (/^(friv|capcall|careermap|dreamteam)-/.test(id)) return TAB_POOLS.quiz;
    return [];
  }

  // Loads each pool at most once and folds it into the feed on arrival.
  function ensurePools(urls) {
    return Promise.all((urls || []).map(function (u) {
      if (poolPromises[u]) return poolPromises[u];
      poolPromises[u] = fetchPool(u).then(function (list) {
        addCards(list);
        // The vault pool is what carries the oddity claims, so the dedupe can
        // only run once it has landed.
        if (u.indexOf("vault-pool") >= 0) dropDuplicateBallots();
        // The group filter is built from the race cards that are loaded. Open
        // the Races tab before its pool lands and renderTabExtra() found none
        // and hid the bar, then never ran again — so a cold Races link got the
        // races without any way to filter them.
        if (state.tab === "races" && u.indexOf("race-pool") >= 0) renderTabExtra();
        state.exhausted = false;
        // Top up a feed that opened before its pool landed.
        if (feedEl.querySelectorAll(".card").length < BATCH) loadMore();
        // A shared link to a lazily-loaded card arrives before its pool does.
        // handleShareLink() gave up in that case and never ran again, so the
        // link opened the right tab without the card it pointed at.
        if (pendingShareId && byId[pendingShareId]) handleShareLink();
        renderSummary();
        return list;
      }).catch(function (e) {
        console.warn("[doomscroll] pool failed:", e.message);
        // Do not cache the failure: opening the tab again should retry.
        delete poolPromises[u];
        return [];
      });
      return poolPromises[u];
    }));
  }

  Promise.all(EAGER_POOLS.map(function (u) {
    return fetchPool(u).catch(function (e) { console.warn("[doomscroll] pool failed:", e.message); return []; });
  })).then(function (lists) {
    lists.forEach(addCards);
    if (!allCards.length) throw new Error("no cards loaded");
    E.startSession();
    renderTabs();
    var pinned = handleShareLink();   // may miss: VS/Vault pools load later
    if (E.needsOnboarding() && !pinned) showOnboarding();
    loadMore();
    renderSummary();
    observeSentinel();
    /* Live sources, fetched in the reader's browser. When real cards arrive the
     * sample cards of that type are dropped, so a tab never mixes real and
     * invented content.
     *
     * When they DO NOT arrive, rumors and trades part company. An invented
     * trade is self-evidently hypothetical — that is what a trade machine
     * produces. An invented rumor is a fake NBA report, and this sits next to
     * HoopsHype. Labelling it SAMPLE is not enough: a screenshot loses the
     * label. So a failed rumor load drops the placeholders entirely and the tab
     * says so. */
    /* §17: LIVE DATA ARRIVING NEVER CLEARS AN ACTIVE FEED.
     *
     * Every live path used to do `clearFeed(); loadMore();`. clearFeed() wipes
     * innerHTML and resets `rendered`, so a reader thirty cards into For You
     * when the Buzz fetch resolved - which is a second or two after boot, or
     * later on a slow connection - was thrown back to the top of a feed they
     * had already read. Nothing errored. It just looked like the app had
     * reloaded itself.
     *
     * The fix is that clearing is only ever allowed when there is nothing to
     * lose. A feed holding no `.card` is a placeholder message ("Loading
     * today's feed...", "Nothing here yet."), and clearing that is how the
     * message is removed. A feed holding cards keeps every one of them, in
     * order, with the scroll position untouched; the new material arrives
     * BELOW, on the next batch, which is where a reader expects new cards in a
     * feed they are scrolling.
     *
     * state.exhausted is cleared first in both cases: a tab that reached its
     * empty state has the flag set, and loadMore() returns immediately while it
     * is - so without this the new cards would not be drawn at all. */
    function absorbLive() {
      state.exhausted = false;
      if (!feedEl.querySelector(".card")) clearFeed();
      loadMore();
      renderSummary();
    }

    /* The one thing that does have to leave the screen: a sample card of a type
     * whose real cards have just arrived. Mixing an invented trade with real
     * ones is the thing swapInLive was written to prevent, and it was
     * preventing it by clearing everything.
     *
     * So the sample cards are removed individually and everything else stays
     * where it is. Removing a node mid-feed shifts what is below it up by that
     * card's height, which is a smaller disruption than a reset by the width of
     * the whole feed - and there are at most fourteen of them, all near the top
     * of a session. */
    function dropRenderedSamples(type) {
      var nodes = feedEl.querySelectorAll(".card");
      var gone = 0;
      for (var i = 0; i < nodes.length; i++) {
        var c = byId[nodes[i].dataset.id];
        if (!c || c.type !== type || !c.dummy) continue;
        /* Same teardown clearFeed() does, for this node only: a race player
         * holds a rAF loop and a resize listener, and a <video> keeps
         * streaming, so dropping the node without them leaks both. */
        destroyRaces(nodes[i]);
        if (root.BskyVideo) BskyVideo.releaseAll(nodes[i]);
        if (root.YtVideo) YtVideo.releaseAll(nodes[i]);
        delete rendered[nodes[i].dataset.id];
        nodes[i].parentNode.removeChild(nodes[i]);
        gone++;
      }
      return gone;
    }

    function swapInLive(loader, type) {
      if (!loader) return;
      loader.load().then(function (live) {
        // js/rumors.js is deliberately fail-soft and resolves with an empty
        // array rather than rejecting, so an empty result is the failure signal
        // — not just a rejected promise.
        if (!live || !live.length) {
          liveFailed[type] = true;
          /* RUMORS_ON. Unreachable while rumors are off; the branch stays so
           * that turning them back on restores the fake-rumor safeguard with
           * the flag rather than needing this code written again. */
          if (type === "rumor") { dropInventedRumors(); return; }
          // Buzz has no sample cards at all — it is live or it is nothing — so
          // a tab already sitting on its empty state has to be told. absorbLive
          // clears the placeholder message and leaves a read feed alone.
          if (state.tab === TAB_FOR_TYPE[type]) absorbLive();
          return;
        }
        allCards = allCards.filter(function (c) {
          if (c.type === type && c.dummy) { delete byId[c.id]; return false; }
          return true;
        });
        addCards(live);
        /* The samples of this type leave the screen; everything else stays.
         * See dropRenderedSamples and absorbLive for why this is not a
         * clearFeed() any more. */
        dropRenderedSamples(type);
        if (state.tab === TAB_FOR_TYPE[type] || state.tab === "foryou") absorbLive();
        else { state.exhausted = false; renderSummary(); }
      }).catch(function (e) {
        console.warn("[doomscroll] live " + type + " failed:", e.message);
        liveFailed[type] = true;
        /* RUMORS_ON, same reason as the empty-result branch above. */
        if (type === "rumor") dropInventedRumors();
        else if (state.tab === TAB_FOR_TYPE[type]) absorbLive();
      });
    }

    /* RUMORS_ON. Kept because it is the safety net for the case where rumors
     * are turned back on and the live load then fails: the sample cards must
     * still be dropped rather than shown. With rumors off it never runs,
     * because addCards refuses rumor cards long before this could. */
    function dropInventedRumors() {
      liveFailed.rumor = true;
      var before = allCards.length;
      allCards = allCards.filter(function (c) {
        if (c.type === "rumor" && c.dummy) { delete byId[c.id]; return false; }
        return true;
      });
      if (before === allCards.length) return;
      console.info("[doomscroll] rumors unavailable — " + (before - allCards.length) +
        " placeholder cards dropped rather than shown");
      /* A fake rumor is the one thing that must leave the screen even mid-read:
       * §17 protects a reader's position, not a fabricated NBA report. */
      dropRenderedSamples("rumor");
      absorbLive();
    }
    /* RUMORS_ON */
    if (RUMORS_ON) swapInLive(root.LiveRumors, "rumor");
    swapInLive(root.DoomTrades, "trade");
    swapInLive(root.LiveBuzz, "buzz");

    // A shared link can point straight at a lazy tab's card, so ask for that
    // tab's pool before waiting on the current one.
    if (pendingShareId) ensurePools(tabForShareId(pendingShareId));
    // For You needs all three, but not while the first screen is still
    // painting. Every other tab pulls only its own pool, when it is opened.
    if (state.tab === "foryou") deferIdle(function () { ensurePools(TAB_POOLS.foryou); });
    else ensurePools(TAB_POOLS[state.tab] || []);
  }).catch(function (e) {
    feedEl.innerHTML = '<div class="feed-msg">Could not load the card pools (' + esc(e.message) +
      '). If you opened index.html from disk, serve it over http instead: python -m http.server</div>';
  });

  /* ---------------- tabs ---------------- */

  function renderTabs() {
    tabsEl.innerHTML = TABS.map(function (t) {
      // While an entity filter is on, no tab is "active" — the feed is not
      // showing a tab. Tapping one clears the filter and goes there.
      var active = !state.entity && t.key === state.tab;
      return '<button class="tab' + (active ? " active" : "") + '" data-tab="' + t.key + '">' + t.label + "</button>";
    }).join("");
    renderTabExtra();
    renderEntityBar();
  }

  // Per-tab action strip. VS gets the live random-matchup generator.
  function renderEntityBar() {
    var el = document.getElementById("entityBar");
    if (!el) return;
    if (!state.entity) { el.hidden = true; el.innerHTML = ""; return; }
    var e = state.entity;
    var n = poolForTab(state.tab).length;
    el.innerHTML =
      '<div class="ent-bar-inner">' +
        '<span class="ent-bar-label mono">' +
          (e.kind === "team" ? "Team" : "Player") + '</span>' +
        '<strong class="ent-bar-name">' + esc(entityLabel(e)) + '</strong>' +
        '<span class="ent-bar-count mono">' + n.toLocaleString("en-US") +
          ' card' + (n === 1 ? "" : "s") + '</span>' +
        '<button class="ent-bar-clear" type="button" data-entity-clear>' +
          'Clear <span aria-hidden="true">&times;</span></button>' +
      '</div>';
    el.hidden = false;
  }

  function renderTabExtra() {
    var el = document.getElementById("tabExtra");
    if (state.tab === "vs") {
      el.innerHTML = '<button class="tab-action" id="randomVs" type="button">' +
        '<span aria-hidden="true">&#9861;</span> Random matchup</button>' +
        '<span class="tab-note">scored live in your browser</span>';
      el.hidden = false;
    } else if (state.tab === "races") {
      // Races span several taxonomies (career, playoffs, franchises, countries,
      // draft classes, generations, awards). Without a filter the tab is a
      // shuffle; with one it is browsable.
      var groups = [];
      allCards.forEach(function (c) {
        if (c.type === "race" && c.payload.group && groups.indexOf(c.payload.group) < 0) {
          groups.push(c.payload.group);
        }
      });
      if (!groups.length) { el.innerHTML = ""; el.hidden = true; return; }
      el.innerHTML = ['<button class="tab-action race-group-btn' + (state.raceGroup ? "" : " on") +
        '" data-race-group="" type="button">All</button>']
        .concat(groups.map(function (g) {
          return '<button class="tab-action race-group-btn' + (state.raceGroup === g ? " on" : "") +
            '" data-race-group="' + esc(g) + '" type="button">' + esc(g) + "</button>";
        })).join("");
      el.hidden = false;
    } else {
      el.innerHTML = "";
      el.hidden = true;
    }
  }

  /* Every pool any tab can draw from, deduped.
   *
   * This used to be a hand-written list of three, which meant an entity filter
   * clicked on a cold page could never surface Teammates, Comparison, Media
   * Lean or award ballot races: setEntity() asks for ALL_POOLS, and those four
   * were not in it. The bug was invisible on a warm page, because whichever tab
   * had already been opened had loaded them for its own reasons.
   *
   * Deriving it from TAB_POOLS means a pool cannot be added to a tab and
   * forgotten here, which is exactly how the first three got out of date. */
  var ALL_POOLS = (function () {
    var seen = {}, out = [];
    Object.keys(TAB_POOLS).forEach(function (tab) {
      (TAB_POOLS[tab] || []).forEach(function (u) {
        if (!seen[u]) { seen[u] = 1; out.push(u); }
      });
    });
    return out;
  })();

  // Cards carry team abbreviations, which is right on a card but terse as a
  // headline. The list lives in js/cards.js so the cards and this filter bar
  // read the same one.
  var TEAM_NAME = C.TEAM_NAME;

  function entityLabel(e) {
    return e.kind === "team" ? (TEAM_NAME[e.value] || e.value) : e.value;
  }

  function syncUrl() {
    if (!root.history || !root.history.replaceState) return;
    var q = "";
    if (state.entity) {
      q = "?" + (state.entity.kind === "team" ? "team" : "player") +
          "=" + encodeURIComponent(state.entity.value);
    } else if (state.tab !== "foryou") {
      q = "?tab=" + state.tab;
    }
    root.history.replaceState(null, "", q || root.location.pathname);
  }

  function setEntity(kind, value) {
    if (!value) return;
    state.entity = { kind: kind === "team" ? "team" : "player", value: value };
    state.exhausted = false;
    state.raceGroup = null;
    // A player filter has to search everything, not just whichever pools the
    // current tab happened to need.
    ensurePools(ALL_POOLS);
    renderTabs();
    clearFeed();
    root.scrollTo(0, 0);
    loadMore();
    renderSummary();
    syncUrl();
  }

  function clearEntity() {
    if (!state.entity) return;
    state.entity = null;
    state.exhausted = false;
    renderTabs();
    clearFeed();
    root.scrollTo(0, 0);
    loadMore();
    renderSummary();
    syncUrl();
  }

  function goTab(key) {
    if (!key || !TABS.some(function (t) { return t.key === key; })) return;
    // Tapping a tab while filtered clears the filter and goes there.
    if (key === state.tab && !state.entity) return;
    state.entity = null;
    state.tab = key;
    state.exhausted = false;
    state.raceGroup = null;
    renderTabs();
    clearFeed();
    window.scrollTo(0, 0);
    ensurePools(TAB_POOLS[state.tab] || []);
    loadMore();
    renderSummary();
    syncUrl();
    if (state.tab === "vs" && window.LiveVs) LiveVs.ready().catch(function () {});
  }

  tabsEl.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-tab]");
    if (b) goTab(b.dataset.tab);
  });

  // The type chip on every card is a link to that card's section; a player
  // name or team filters the whole feed to that entity.
  feedEl.addEventListener("click", function (ev) {
    var chip = ev.target.closest("[data-goto]");
    if (chip) { goTab(chip.dataset.goto); return; }
    var e = ev.target.closest("[data-entity]");
    if (e) {
      ev.preventDefault();
      var card = e.closest(".card");
      if (card) card.dataset.engaged = "1";
      setEntity(e.dataset.entityKind, e.dataset.entity);
    }
  });

  document.getElementById("entityBar").addEventListener("click", function (ev) {
    if (ev.target.closest("[data-entity-clear]")) clearEntity();
  });

  document.getElementById("tabExtra").addEventListener("click", function (ev) {
    var g = ev.target.closest("[data-race-group]");
    if (g) {
      state.raceGroup = g.dataset.raceGroup || null;
      state.exhausted = false;
      renderTabExtra();
      clearFeed();
      loadMore();
      renderSummary();
      return;
    }
    if (!ev.target.closest("#randomVs")) return;
    var btn = ev.target.closest("#randomVs");
    btn.disabled = true;
    LiveVs.random().then(function (card) {
      byId[card.id] = card;
      var holder = document.createElement("div");
      holder.innerHTML = C.render(card);
      var el = holder.firstChild;
      el.classList.add("pinned");
      watchCard(el);
      feedEl.insertBefore(el, feedEl.firstChild);
      window.scrollTo({ top: 0, behavior: "smooth" });
      btn.disabled = false;
    }).catch(function (e) {
      toast("Could not build a matchup: " + e.message);
      btn.disabled = false;
    });
  });

  // Content Stream's monospace summary line: what this tab is showing.
  var TAB_BLURB = {
    foryou: "every card type, weighted by what you like",
    buzz: "what the NBA world is posting today, from the HoopsMatic Content Stream",
    trades: "real Trade Machine builds, deduped and balance-filtered",
    rumors: "rumor history, legal/off-court topics filtered out",
    vs: "career comparisons scored the same way as the full tool",
    quiz: "guess the player, two-player trivia, and real award ballots",
    vault: "cap-share salaries, ballot oddities, who in the media rates whom, games on this date",
    races: "every franchise, country and college, one bar chart race at a time"
  };

  function renderSummary() {
    renderScore();
    /* Drawn here as well as after an answer, so a reader who comes back mid-run
     * sees it on load rather than only after the next question. */
    renderRunChip();
    var el = document.getElementById("summary");
    if (!el) return;
    var n = poolForTab(state.tab).length;
    if (state.entity) {
      el.innerHTML = "<strong>" + n.toLocaleString("en-US") + "</strong> card" +
        (n === 1 ? "" : "s") + " mentioning " + esc(entityLabel(state.entity)) +
        " · every section";
      renderEntityBar();
      return;
    }
    var sample = poolForTab(state.tab).filter(function (c) { return c.dummy; }).length;
    el.innerHTML = "<strong>" + n.toLocaleString("en-US") + "</strong> cards · " +
      esc(TAB_BLURB[state.tab] || "") +
      (sample ? " · <strong>" + sample + "</strong> sample" : "");
  }

  /* ---------------- you against the feed ----------------
   *
   * Quiz, trivia and ballot cards already know whether the reader got it right
   * and used to throw that away the moment the card scrolled past. The tally
   * lives in js/scoreboard.js; this is the two lines that feed it and the one
   * that prints it.
   *
   * Called AFTER E.quizAnswered on purpose. The engine's personalisation is the
   * product and the score is a garnish, so a scoreboard that throws - a full
   * quota, a browser blocking site data - must not cost a reader their
   * algorithm update or their reveal. Hence the try, and hence the ordering. */
  /* §11: one line under the card when an answer reaches 3, 5 or 10 in a row.
   *
   * No modal, no toast, nothing that interrupts a scroll - the brief is
   * explicit about that, and it is right: a feed that stops you to celebrate is
   * a feed you stop reading. It goes into the card's own result area, next to
   * "Correct.", and scrolls away with the card.
   *
   * cardEl is passed in rather than looked up, because by the time a reader has
   * answered two cards there are two answered cards on screen and querying for
   * one would find whichever came first. */
  /* THE REWARD, NOT THE REPORT.
   *
   * The first version printed the run as a line of text and Jorge's verdict was
   * "there should be some sort of reward for getting answers right". The line
   * was accurate and inert: it said where you were and never what you were
   * heading for, so a run had no shape. Three things fix that, and none of them
   * interrupts a scroll, which the brief rules out and is right to:
   *
   *   1. A METER. The run fills a bar toward the next milestone - two of three,
   *      four of five, seven of ten. A number with a target is a goal; a number
   *      on its own is a counter.
   *   2. A BADGE at the milestone itself, with the run in it, and a button that
   *      posts it. A streak worth having is a streak worth showing, and the post
   *      is the only output of this feed that is about the reader.
   *   3. A CHIP in the header that carries the run between cards, so it is
   *      visible while it is building rather than only in the second after an
   *      answer - see renderRunChip.
   *
   * Everything stays in the card's own result area and scrolls away with it.
   * Still no modal, no toast, nothing that stops the feed.
   */
  function showReward(cardEl, rw) {
    if (!cardEl || !rw) return;
    var res = cardEl.querySelector(".quiz-result");
    if (!res || res.querySelector(".quiz-run")) return;

    var wrap = document.createElement("div");
    wrap.className = "quiz-run" + (rw.hit ? " is-hit" : "");

    var head = document.createElement("div");
    head.className = "quiz-run-head";
    var label = document.createElement("span");
    label.className = "quiz-run-label mono";
    label.textContent = rw.line || (rw.run + " in a row");
    head.appendChild(label);
    if (rw.next) {
      var goal = document.createElement("span");
      goal.className = "quiz-run-goal mono";
      goal.textContent = rw.run + "/" + rw.next;
      head.appendChild(goal);
    }
    wrap.appendChild(head);

    /* Hidden from assistive tech: the count is already in the label beside it,
     * and a bar that announces "57 percent" adds nothing but noise. */
    var bar = document.createElement("div");
    bar.className = "quiz-run-bar";
    bar.setAttribute("aria-hidden", "true");
    var fill = document.createElement("span");
    fill.style.width = Math.max(0, Math.min(1, rw.fill)) * 100 + "%";
    bar.appendChild(fill);
    wrap.appendChild(bar);

    if (rw.hit) wrap.appendChild(runBadge(rw));

    res.appendChild(wrap);
  }

  /* The milestone badge. Two composer links and nothing else: no image render,
   * no canvas, no third-party script, and the only number that leaves the
   * browser is the one the reader tapped to post. */
  function runBadge(rw) {
    var box = document.createElement("div");
    box.className = "quiz-run-badge";

    var n = document.createElement("strong");
    n.textContent = rw.hit + " in a row";
    box.appendChild(n);

    if (rw.best > rw.hit) {
      var b = document.createElement("span");
      b.className = "quiz-run-best mono";
      b.textContent = "best " + rw.best;
      box.appendChild(b);
    }

    var acts = document.createElement("span");
    acts.className = "quiz-run-acts";
    [["bsky", "Post on Bluesky"], ["x", "Post on X"]].forEach(function (p) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "quiz-run-share";
      btn.textContent = p[1];
      btn.addEventListener("click", function () {
        /* Opened inside the click so no popup blocker eats it, and noopener so
         * the composer gets no handle on this window. */
        window.open(ShareText.runComposeUrl(p[0], rw.run, rw.best, siteUrl()),
                    "_blank", "noopener,noreferrer");
      });
      acts.appendChild(btn);
    });
    box.appendChild(acts);
    return box;
  }

  /* The feed's own address, with no card or tab on it. A posted run points at
   * the feed, not at whichever question happened to be the tenth. */
  function siteUrl() {
    var u = new URL(window.location.href);
    u.search = "";
    u.hash = "";
    return u.toString();
  }

  /* THE RUN, BETWEEN CARDS.
   *
   * The meter lives on the card that was just answered and scrolls away with
   * it. This is the part that persists: a chip beside the score line that shows
   * the run while the reader is still scrolling toward the next question, and
   * goes quiet at zero rather than announcing a broken streak. Reset by a wrong
   * answer, like the run itself.
   */
  function renderRunChip() {
    var el = document.getElementById("runChip");
    if (!el || !root.Scoreboard) return;
    var r;
    try { r = root.Scoreboard.run(); } catch (e) { return; }
    if (!r || r.cur < 2) { el.hidden = true; el.textContent = ""; return; }
    var next = root.Scoreboard.nextMilestone(r.cur);
    el.textContent = r.cur + " in a row" + (next ? " · " + next + " next" : "");
    el.className = "run-chip" + (root.Scoreboard.MILESTONES.indexOf(r.cur) >= 0
      ? " is-hit" : "");
    el.hidden = false;
  }

  function scoreAnswer(card, correct, cardEl) {
    if (!root.Scoreboard) return;
    try {
      var tally = root.Scoreboard.record(card.id, card.type, correct);
      /* Every correct answer from two up, not only the milestones. The first
       * version showed a line on the third answer and nothing on the fourth,
       * so the run was invisible while it was building - Jorge's words: "that
       * does not do much". */
      if (tally && tally.reward) showReward(cardEl, tally.reward);
      renderScore();
      renderRunChip();
      if (root.DailyFive) {
        var el = document.querySelector('#feed [data-id^="daily-"]');
        if (el) {
          var F = root.DailyFive;
          var ids = F.pick(allCards.filter(usableCard), F.dayKey()).map(function (c) { return c.id; });
          F.answered(card.id, correct, ids, F.dayKey());
          dailyAnswered(card);
        }
      }
    } catch (e) { /* never break a card over a tally */ }
  }

  /* Silent until there is something to say. "0-0 today" printed over a feed
   * nobody has played reads as an accusation rather than information. */
  function renderScore() {
    var el = document.getElementById("scoreLine");
    if (!el || !root.Scoreboard) return;
    var line = "";
    try { line = root.Scoreboard.line(); } catch (e) { line = ""; }
    el.textContent = line;
    el.hidden = !line;
  }

  /* ---------------- the Daily Five ----------------
   *
   * Pinned as the tenth card of the first screen, at Jorge's call: not the
   * first thing anyone sees, because a feed that opens with a quiz is a quiz;
   * and not buried, because a game nobody finds is not a game. Ten cards in is
   * far enough to have started scrolling and near enough to still be there.
   *
   * The five are ordinary quiz, trivia and ballot cards. This builds a wrapper
   * card around whichever one is next; js/daily-five.js decides which five and
   * remembers how each went.
   */
  function dailyCard() {
    if (!root.DailyFive) return null;
    var F = root.DailyFive;
    /* usableCard, not allCards raw: the Daily Five must not be the one place a
     * two-option ballot can still reach a reader. Everything the feed refuses
     * to show, this refuses to ask. */
    var five = F.pick(allCards.filter(usableCard), F.dayKey());
    if (five.length < F.SIZE) return null;          // pools not loaded yet

    var ids = five.map(function (c) { return c.id; });
    var st = F.state(ids, F.dayKey());
    var cur = F.current(st);
    var byResult = {};
    st.results.forEach(function (r) { byResult[r.id] = r.correct; });

    return {
      id: "daily-" + st.day,
      type: "daily",
      tab: ["foryou"],
      pinned: true,
      tags: { content_type: "daily", players: [], teams: [], era: "2020s" },
      payload: {
        day: st.day,
        total: st.ids.length,
        index: cur ? cur.index : st.ids.length,
        done: F.done(st),
        score: F.score(st),
        grid: F.grid(st),
        streak: root.Scoreboard ? root.Scoreboard.streak() : 0,
        marks: st.ids.map(function (id) {
          return (id in byResult) ? (byResult[id] ? "hit" : "miss") : "";
        }),
        inner: cur ? byId[cur.id] || null : null
      }
    };
  }

  /* Slot ten of the first screen. Silently does nothing when the feed is short,
   * when the tab is not For You, or when an entity filter is on - a filtered
   * feed is a promise about what it contains, and today's five are not about
   * whoever was tapped. */
  function insertDaily() {
    if (state.tab !== "foryou" || state.entity) return;
    if (feedEl.querySelector('[data-id^="daily-"]')) return;
    var cards = feedEl.querySelectorAll(".card");
    if (cards.length < 10) return;
    var card = dailyCard();
    if (!card) return;
    var frag = document.createElement("div");
    frag.innerHTML = C.render(card);
    var el = frag.firstChild;
    if (!el) return;
    rendered[card.id] = 1;
    byId[card.id] = card;
    cards[9].parentNode.insertBefore(el, cards[9]);
  }

  /* Redraw in place, keeping its position in the feed. */
  function refreshDaily() {
    var el = feedEl.querySelector('[data-id^="daily-"]');
    if (!el) return;
    var card = dailyCard();
    if (!card) return;
    byId[card.id] = card;
    var frag = document.createElement("div");
    frag.innerHTML = C.render(card);
    if (frag.firstChild) el.parentNode.replaceChild(frag.firstChild, el);
  }

  /* Called after every scored answer. Only today's five are its business; the
   * rest of the feed answers cards all day and none of it belongs here. */
  function dailyAnswered(card) {
    var el = feedEl.querySelector('[data-id^="daily-"]');
    if (!el || !root.DailyFive) return;
    var inner = el.querySelector(".daily-inner");
    if (!inner || inner.dataset.id !== card.id) return;
    /* The reveal stays on screen. Advancing immediately would wipe the
     * right/wrong colouring the reader has not read yet, so the next question
     * waits behind a button. */
    var next = el.querySelector(".dq-next");
    if (next) next.hidden = false;
  }

  function hasMixedTypes(pool) {
    var seen = null;
    for (var i = 0; i < pool.length; i++) {
      var t = pool[i].tags && pool[i].tags.content_type;
      if (seen === null) seen = t;
      else if (t !== seen) return true;
    }
    return false;
  }

  function matchesEntity(c, e) {
    var t = c.tags || {};
    var list = e.kind === "team" ? (t.teams || []) : (t.players || []);
    return list.indexOf(e.value) >= 0;
  }

  /* A ballot card with two options is a coin flip dressed as a question: a
   * reader who knows nothing is right half the time and the card cannot tell
   * them apart from one who knows. The builder makes four now
   * (tools/build_data.mjs, T1), and this drops the two-option cards still
   * sitting in a pool built before that change - 66 of the 160 at the time of
   * writing. They come back the moment the pool is rebuilt; nothing is edited
   * or deleted on disk. */
  /* A "who has more" question is only a question if the two numbers are close.
   *
   * Jorge, on a card asking whether Michael Jordan (32,292 points) or Steve
   * Francis (10,446) scored more: "We can't have dumb questions like that. They
   * are supposed to be difficult with similar numbers." He is right - a 3x gap
   * is not trivia, it is a name-recognition test that the reader passes without
   * reading the numbers.
   *
   * The builder's gate was ratio <= 4, which let that card through. It is now
   * 1.6 there too (tools/build_data.mjs), so a rebuilt pool is all close pairs.
   * This is the browser-side half: the pool a reader has in cache right now was
   * built under the old rule, and 133 of its 300 cards are blowouts. Refusing
   * them here fixes the feed on the next page load instead of on the next
   * weekly data refresh, and stays as the safety net afterwards.
   *
   * 1.6 keeps 167 of the shipped 300 - thin for a tab of its own, ample for one
   * card type in a feed of 8,000. */
  var TRIVIA_MAX_RATIO = 1.6;

  function triviaTooEasy(c) {
    var p = c && c.payload;
    if (!p || !p.a || !p.b) return false;
    var va = p.a.value, vb = p.b.value;
    if (typeof va !== "number" || typeof vb !== "number") return false;
    var hi = Math.max(va, vb), lo = Math.min(va, vb);
    if (!lo) return true;                      // one of them is zero: no contest
    return hi / lo > TRIVIA_MAX_RATIO;
  }

  function usableCard(c) {
    if (c && c.type === "ballot" && (c.payload.options || []).length < 4) return false;
    if (c && c.type === "trivia" && triviaTooEasy(c)) return false;
    /* A Career Map card with a missing option or an answer off the end of the
     * board would render four buttons and mark every one of them wrong. The
     * builder refuses to write such a card; this refuses to draw one that
     * reached a reader's cache before it did. */
    if (c && c.type === "careermap") {
      var o = (c.payload && c.payload.options) || [];
      var i = c.payload && c.payload.answer_idx;
      if (o.length !== 4) return false;
      if (!(typeof i === "number" && i >= 0 && i < o.length)) return false;
    }
    /* A dream-team card is two fives and an index into them. A pool written by
     * a half-finished build would otherwise render a panel with no men in it,
     * which looks like a styling bug rather than missing data. */
    if (c && c.type === "dreamteam") {
      var sq = (c.payload && c.payload.squads) || [];
      var di = c.payload && c.payload.answer_idx;
      if (sq.length !== 2) return false;
      if (!sq.every(function (x) { return x && (x.players || []).length === 5; })) return false;
      if (!(di === 0 || di === 1)) return false;
    }
    return true;
  }

  function poolForTab(tab, excludeRendered) {
    // The entity filter outranks the tab: it draws from everything.
    var pool = (state.entity
      ? allCards.filter(function (c) { return matchesEntity(c, state.entity); })
      /* NO SAMPLE CARDS IN FOR YOU - AT THE SOURCE.
       *
       * This filter used to live only in scheduleBatch. That covered the one
       * path it was written for and left two open: the fallback draw at the
       * bottom of loadMore, which runs whenever window.DoomSchedule is missing
       * for any reason (a 404 on js/schedule.js, a parse error in it, a stale
       * cache holding the old file), and any future For You path somebody adds
       * without reading this comment.
       *
       * The invented trades reached a reader's screen TWICE. Both times the
       * scheduleBatch filter was correct and something upstream of it decided
       * which pool it got. Filtering here means there is no For You draw that
       * can see them, whichever code does the drawing. The Trades tab still
       * shows them: there the reader has asked for trades and a labelled
       * example beats an empty tab. */
      : (tab === "foryou"
        ? allCards.filter(function (c) { return !c.dummy; })
        : allCards.filter(function (c) { return (c.tab || []).indexOf(tab) >= 0; })))
      .filter(usableCard);
    if (!state.entity && tab === "races" && state.raceGroup) {
      pool = pool.filter(function (c) { return c.payload.group === state.raceGroup; });
    }
    if (!excludeRendered) return pool;
    // No repeat fallback: re-drawing an exhausted pool just prints the same
    // five cards over and over, which reads as broken. An honest end-of-feed
    // note is better. The big pools never reach it.
    return pool.filter(function (c) { return !rendered[c.id]; });
  }

  function clearFeed() {
    // Race players hold a requestAnimationFrame loop and a resize listener, so
    // wiping innerHTML without stopping them leaks a running loop per race the
    // reader has scrolled past this session.
    destroyRaces(feedEl);
    // A playing <video> inside a node about to be discarded keeps streaming.
    if (root.BskyVideo) BskyVideo.releaseAll(feedEl);
    if (root.YtVideo) YtVideo.releaseAll(feedEl);
    feedEl.innerHTML = "";
    rendered = {};
  }

  /* ---------------- feed ---------------- */

  /* The tail of the feed, as identity rather than as cards.
   *
   * An entity filter is exempt: somebody who asked for every LeBron card has
   * asked for exactly the repetition this suppresses, and demoting his cards
   * inside his own filter would be the app arguing with the reader. */
  var DIVERSITY_WINDOW = 12;
  function recentlyShown() {
    if (state.entity) return {};
    var out = { stories: {}, players: {}, families: {} };
    var els = feedEl.querySelectorAll(".card");
    for (var i = Math.max(0, els.length - DIVERSITY_WINDOW); i < els.length; i++) {
      var c = byId[els[i].dataset.id];
      if (!c) continue;
      if (c.story_key) out.stories[c.story_key] = 1;
      if (c.story_family) out.families[c.story_family] = 1;
      var pl = (c.tags && c.tags.players) || [];
      for (var j = 0; j < pl.length; j++) out.players[pl[j]] = 1;
    }
    return out;
  }

  /* Buzz cards carry the source's own publication time. Anything unparseable
   * sorts to the end rather than to the top, which is what a plain
   * Date.parse -> NaN -> 0 would do on the wrong side of the comparison. */
  function buzzTime(card) {
    var p = card && card.payload;
    var t = p && p.published_at ? Date.parse(p.published_at) : NaN;
    return isNaN(t) ? 0 : t;
  }

  /* The share of the next batch reserved for Buzz: a band, bounded by supply.
   *
   * The learned weight runs from -12 to 24 by the engine's own clamp. Negative
   * pulls toward BUZZ_MIN, positive toward BUZZ_MAX, and an untouched profile
   * sits exactly on the 40% it always did. The curve is deliberately gentle on
   * the positive side - a reader who likes one Buzz card has not asked for the
   * feed to become a news feed. */
  function buzzShare(pool) {
    var w = E.typeWeight ? E.typeWeight("buzz") : 0;
    var want = BUZZ_SHARE;
    if (w > 0) want = BUZZ_SHARE + (BUZZ_MAX - BUZZ_SHARE) * Math.min(1, w / 18);
    else if (w < 0) want = BUZZ_SHARE - (BUZZ_SHARE - BUZZ_MIN) * Math.min(1, -w / 9);

    /* The supply cap. Counting only what is fresh means a quiet week shrinks
     * the reserved block instead of filling it with week-old posts. */
    var cutoff = Date.now() - BUZZ_FRESH_MS;
    var fresh = 0;
    for (var i = 0; i < pool.length; i++) {
      var c = pool[i];
      if (((c.tags && c.tags.content_type) || c.type) !== "buzz") continue;
      if (rendered[c.id]) continue;
      if (buzzTime(c) >= cutoff) fresh++;
    }
    return Math.max(0, Math.min(want, fresh / BATCH));
  }

  /* ---------------- how far the feed goes ----------------
   *
   * "You have seen everything here for now." was an honest end to a section and
   * the wrong answer to the question this app exists to answer. A doomscroll
   * feed that stops is a feed that is over.
   *
   * It stopped because poolForTab excludes what is already on screen and
   * nothing ever looked past the current tab. Three phases now, walked forward
   * and never back:
   *
   *   own     the section the reader chose
   *   spill   everything else, once that section is used up, under a line
   *           saying so - a Races reader who has seen all 221 races gets the
   *           rest of the app rather than a full stop
   *   loop    everything again, once the whole app is used up
   *
   * A card can only come back in loop, and by then the reader has been through
   * every card there is. Even then it is spaced out: recentlyShown() demotes
   * whatever is in the last twelve on screen, and the profile's own freshness
   * rule cuts a card seen in the past twenty minutes to 8% of its weight.
   *
   * AN ENTITY FILTER NEVER SPILLS. Somebody who tapped "LeBron James" asked for
   * LeBron cards, and answering with the rest of the feed is not answering. That
   * mode keeps the end note it has always had.
   */

  /* The media-heavy types, one per batch each, everywhere.
   *
   * These exist for For You, where a run of autoplaying clips stacked in one
   * batch is visually noisy and the one thing here that costs real data. */
  var MIXED_CAPS = { race: 1, mates: 1, compare: 1, lean: 1, vs: 1 };

  /* THE VS TAB NEEDS ITS OWN, AND THIS IS WHY.
   *
   * A cap table shared by every tab is fine until a tab's ENTIRE contents are
   * capped types. The VS tab holds exactly three - vs, compare, mates - and
   * MIXED_CAPS caps all three at one, so sampleMixed ran out of eligible types
   * after three picks and broke out of its loop. Batches of three, in a tab
   * asking for eight, from a pool of 4,120 cards. Nothing failed: the reader
   * just got a shorter scroll and a third of it was score cards, when the point
   * of adding `vs` to that table was to make score cards a fifth.
   *
   * So the VS tab caps the one type Jorge wanted less of and leaves the video
   * comparisons uncapped to carry the tab. Two of eight is a quarter, which is
   * the closest a whole number of cards gets to a fifth; the learned weights
   * push it below that for a reader who skips them, and the cap stops it going
   * above for one who does not.
   */
  var VS_TAB_CAPS = { vs: 2 };

  /* ---------------- the For You scheduler ----------------
   *
   * For You is the only tab that goes through js/schedule.js, and deliberately
   * so. Every other tab is a reader asking for one kind of thing: somebody on
   * Races wants races, and a scheduler that thinned them out would be the app
   * arguing with the reader. The mix targets in Jorge's brief are targets for
   * the feed you get when you have not chosen anything.
   *
   * An entity filter is exempt for the same reason. Tapping "LeBron James" asks
   * for every LeBron card; rationing them by bucket would answer a question
   * nobody asked.
   *
   * The counters live here rather than in the scheduler because they belong to
   * the reader's session, not to a batch: "how many cards since the last awards
   * card" has to survive across batches, and it is reset when the feed is
   * genuinely restarted. */
  var foryouSince = root.DoomSchedule ? DoomSchedule.newCounters() : null;

  function resetSchedule() {
    if (root.DoomSchedule) foryouSince = DoomSchedule.newCounters();
  }

  /* The tail of the feed as cards, so the scheduler can arrange the next batch
   * against what is actually on screen rather than only against itself. Twelve
   * is DIVERSITY_WINDOW; the media caps need ten. */
  function feedTail(n) {
    var els = feedEl.querySelectorAll(".card");
    var out = [];
    for (var i = Math.max(0, els.length - n); i < els.length; i++) {
      var c = byId[els[i].dataset.id];
      if (c) out.push(c);
    }
    return out;
  }

  function scheduleBatch(pool, avoid) {
    /* NO SAMPLE CARDS IN FOR YOU.
     *
     * The fourteen placeholder trades in data/dummy-cards.json are type
     * "trade", which the editorial classification calls `live` - correctly, for
     * a real one. At boot, before the live fetch resolves, they are the ONLY
     * live cards in the pool, so the scheduler filled all five of its live
     * slots with them and the feed opened on a screen of "SAMPLE TRADE". The
     * old type-balanced draw spread them out enough to hide it; scheduling live
     * deliberately did not.
     *
     * An invented trade is not current NBA, so it is not eligible here. The
     * Trades tab still shows them, because there the reader has asked for
     * trades and an empty tab is worse than a labelled example. Until live
     * arrives those slots fall through to history, games and comparisons, and
     * absorbLive appends the real cards below when they land.
     *
     * THIS FIX WAS LOST ONCE. It was written on a branch that was then
     * abandoned in favour of one cut from main, and its test assertion went
     * with it - so the suite passed at 56 with the bug back in the feed and
     * Jorge found it on the live site for the second time. The assertion in
     * tools/test_app_live_refresh.mjs is what stops that happening again. */
    var real = pool.filter(function (c) { return !c.dummy; });
    var res = DoomSchedule.build({
      pool: real,
      size: BATCH,
      position: feedEl.querySelectorAll(".card").length,
      tail: feedTail(DIVERSITY_WINDOW),
      since: foryouSince,
      avoid: avoid,
      /* THE ENGINE STILL PICKS. The scheduler says how many cards of each kind;
       * E.sample decides which ones, so the learned weights, the freshness rule
       * and the story spacing all still apply inside every bucket. Replacing
       * that with a plain shuffle would have thrown away the personalisation
       * this app is built on. */
      sample: function (list, n, opts) { return E.sample(list, n, opts); }
    });
    foryouSince = res.since;
    return res.cards;
  }

  function drawFrom(pool, avoid, newestFirst, caps) {
    if (!pool.length) return [];
    // Any pool holding more than one card type gets the type-balanced draw.
    // Vault is the reason: its ~8 on-this-day cards for the current date would
    // otherwise be buried under 120 salary and 54 ballot-oddity cards, and
    // "on this day" is the whole point of having them.
    // Cap the media-heavy card type: a run of autoplaying clips stacked in one
    // batch is both visually noisy and the one thing here that costs real data.
    return hasMixedTypes(pool)
      // Buzz gets a RESERVED share of every mixed batch, because the
      // type-balanced draw cannot produce one on its own: it damps thin pools,
      // and ~50 live items is a thin pool against thousands of archive cards.
      // How big that share is now depends on the reader and on how much fresh
      // Buzz there actually is - see buzzShare().
      //
      // `vs` is in MIXED_CAPS because those score cards were crowding the feed
      // and Jorge wants the video comparisons carrying that content instead.
      // The VS tab passes its own table - see VS_TAB_CAPS for why a shared one
      // cannot serve a tab whose every type is capped.
      ? E.sampleMixed(pool, BATCH, {
          cap: caps || MIXED_CAPS,
          share: { buzz: buzzShare(pool) },
          avoid: avoid
        })
      // The Buzz tab reads newest-first, because it is the only tab where the
      // order carries information. Everywhere else the pool is an archive and
      // the shuffle is the point. Only ever true while drawing Buzz's own
      // section: a spilled batch is the whole app and has no chronology.
      : (newestFirst ? E.recent(pool, BATCH, buzzTime) : E.sample(pool, BATCH, { avoid: avoid }));
  }

  function sectionLabel(key) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].key === key) return TABS[i].label;
    return "this section";
  }

  function feedNote(text) {
    var el = document.createElement("div");
    el.className = "feed-msg feed-note";
    el.textContent = text;
    feedEl.appendChild(el);
  }

  /* Move to the next phase. Returns false when there is nowhere left to go,
   * which is the only remaining way the feed can end. */
  function advancePhase() {
    if (state.entity) return false;
    if (state.phase === "own") {
      state.phase = "spill";
      /* For You already draws from everything, so there is nothing to spill
       * into. Announcing the rest of the feed and then immediately announcing
       * that the feed is over would be two notes back to back, the first of
       * them false. Fall straight through to the loop instead. */
      if (allCards.some(function (c) { return !rendered[c.id]; })) {
        feedNote(state.tab === "trades"
          ? "That is every trade that cleared the balance filter. Build one in the Trade Machine and it shows up here. Below is the rest of the feed."
          : "That is everything in " + sectionLabel(state.tab) + ". Below is the rest of the feed.");
        return true;
      }
    }
    /* spill -> loop, and loop -> round again. Clearing `rendered` is what makes
     * the pool non-empty; the cards stay in the DOM, so recentlyShown() still
     * reads the real tail of the feed and spaces out what comes back. */
    var firstLap = state.phase !== "loop";
    state.phase = "loop";
    rendered = {};
    if (firstLap) feedNote("You have seen everything. Going round again.");
    return true;
  }

  function loadMore() {
    if (state.loading || state.exhausted) return;
    state.loading = true;
    /* An empty feed is starting over, whatever phase the last one ended in.
     * Deriving it here rather than resetting a flag at each of the eight places
     * that clear the feed: one of those would have been missed. */
    if (!feedEl.querySelector(".card")) { state.phase = "own"; resetSchedule(); }

    var batch = [];
    /* own -> spill -> loop is three tries. The bound is what stops an app with
     * no cards at all from spinning here. */
    for (var attempt = 0; attempt < 3 && !batch.length; attempt++) {
      var own = state.phase === "own";
      var pool = own
        ? poolForTab(state.tab, true)
        : allCards.filter(function (c) { return !rendered[c.id]; });
      /* What the reader has just been shown, handed to the sampler so the next
       * batch does not repeat it. Twelve cards is roughly a screen and a half on
       * a phone: long enough that a repeat would be noticed, short enough that a
       * favourite player is still allowed to come back. */
      /* The VS tab's own caps apply only while it is drawing its OWN section.
       * A spilled or looped batch is the whole app, where vs is one type among
       * a dozen and MIXED_CAPS is the right table. */
      /* For You is scheduled by editorial bucket; every other tab keeps the
       * type-balanced draw it has always used. See scheduleBatch. */
      batch = (root.DoomSchedule && state.tab === "foryou" && !state.entity)
        ? scheduleBatch(pool, recentlyShown())
        : drawFrom(pool, recentlyShown(), own && state.tab === "buzz",
                   own && state.tab === "vs" ? VS_TAB_CAPS : null);
      if (!batch.length && !advancePhase()) break;
    }

    if (!batch.length) {
      state.exhausted = true;
      state.loading = false;
      if (!feedEl.querySelector(".card") && state.entity) {
        feedEl.innerHTML = '<div class="feed-msg">Nothing about ' +
          esc(entityLabel(state.entity)) + ' yet.<br><br>' +
          '<button class="btn" type="button" data-entity-clear>Back to the feed</button></div>';
      } else if (!feedEl.querySelector(".card")) {
        if (state.tab === "rumors" && liveFailed.rumor) {
          feedEl.innerHTML = '<div class="feed-msg">Rumors could not load right now. ' +
            'They come live from the HoopsHype archive — nothing is shown here until they do.' +
            '<br><br><a href="https://hoopshype.com/rumors/" target="_blank" rel="noopener">Read them on HoopsHype</a></div>';
        } else if (state.tab === "buzz") {
          // Buzz is live-only by design. Nothing here means the feed is not
          // reachable, not that the NBA had a quiet day, and saying so is
          // better than an empty section that looks broken.
          feedEl.innerHTML = '<div class="feed-msg">' + (liveFailed.buzz
            ? "Today&rsquo;s feed could not load. It comes live from the HoopsMatic " +
              "Content Stream in your browser, and nothing is shown here until it does."
            : "Loading today&rsquo;s feed&hellip;") + '</div>';
        } else {
          feedEl.innerHTML = '<div class="feed-msg">Nothing here yet.</div>';
        }
      } else if (!feedEl.querySelector(".feed-end")) {
        /* Only reachable behind an entity filter now, which is the one place
         * the feed is still allowed to end. */
        var end = document.createElement("div");
        end.className = "feed-msg feed-end";
        end.textContent = state.entity
          ? "That is every card about " + entityLabel(state.entity) + "."
          : "You have seen everything here for now.";
        feedEl.appendChild(end);
      }
      return;
    }
    var frag = document.createElement("div");
    frag.innerHTML = batch.map(C.render).join("");
    while (frag.firstChild) {
      var node = frag.firstChild;
      if (node.nodeType === 1) {
        decorate(node); watchCard(node); rendered[node.dataset.id] = 1;
        /* Counted as SERVED, not as drawn. The quotas are about what the reader
         * is shown, and a card that was drawn into a batch the feed then
         * truncated was never shown. */
        if (root.DoomSchedule && foryouSince && byId[node.dataset.id]) {
          DoomSchedule.countCard(foryouSince, byId[node.dataset.id]);
        }
      }
      feedEl.appendChild(node);
    }
    insertDaily();
    trimFeed();
    state.loading = false;
  }

  /* ---------------- keeping the DOM finite ----------------
   *
   * The feed used to end, and the end was also the cap: a few hundred cards and
   * the reader ran out. Then it started spilling and looping, which was the
   * right call and removed the only thing bounding the DOM. A long session now
   * accumulates cards without limit - each one carrying a headshot, some an
   * <img>, a few a canvas or a video element - and the phone gets slower the
   * longer somebody enjoys the app.
   *
   * WHY SPACERS RATHER THAN JUST REMOVING THEM
   *
   * .feed is a grid, so every card is a row and removing one shortens the page.
   * The browser keeps scrollTop, so the content under the reader's thumb would
   * jump by however much was removed. Chrome and Firefox have scroll anchoring
   * that compensates; Safari does not, and a phone is where this matters. So a
   * trimmed region leaves a spacer of exactly the height it replaced, and
   * nothing moves. Contiguous spacers merge into one, absorbing the grid gap
   * each removed row also took, so the DOM is genuinely bounded rather than
   * trading a card for a div.
   *
   * WHAT IS NEVER TRIMMED
   *
   *   the Daily Five      insertDaily() guards on the element being in the DOM,
   *                       so trimming it would make it reappear ten cards down
   *   its five questions  they are nested .card elements inside it, which is
   *                       also why this only ever touches direct children
   *   anything near the   three screens of margin, on top of the card count,
   *   viewport            because a reader scrolling back up a screen or two is
   *                       ordinary and finding a hole there is not
   *
   * The reader who scrolls a long way back up does reach the region, and it
   * says what happened rather than looking broken.
   */
  var KEEP_CARDS = 60;        // live cards behind the reader before trimming
  var TRIM_SCREENS = 3;       // and none within this many screens of the view

  function trimFeed() {
    var cards = feedEl.querySelectorAll(".card");
    var over = cards.length - KEEP_CARDS;
    if (over <= 0) return;

    var gap = parseFloat(getComputedStyle(feedEl).rowGap) || 0;
    var edge = -(window.innerHeight * TRIM_SCREENS);

    for (var i = 0; i < over; i++) {
      var el = cards[i];
      /* Direct children only: the Daily Five's questions are nested cards and
       * removing one would gut the card that holds them. */
      if (!el || el.parentNode !== feedEl) continue;
      if (/^daily-/.test(el.dataset.id || "")) continue;

      var rect = el.getBoundingClientRect();
      /* Document order, so once one card is inside the live zone every card
       * after it is too. */
      if (rect.bottom > edge) break;

      /* A race holds a requestAnimationFrame loop and a resize listener, and a
       * playing video keeps streaming, so both outlive the node unless asked
       * not to. Same three calls clearFeed() makes, scoped to one card. */
      destroyRaces(el);
      if (root.BskyVideo) BskyVideo.releaseAll(el);
      if (root.YtVideo) YtVideo.releaseAll(el);
      skimObserver.unobserve(el);
      visTimes.delete(el);

      var height = Math.round(rect.height);
      var prev = el.previousElementSibling;
      if (prev && prev.classList.contains("card-trimmed")) {
        /* Merge. The removed row took a grid gap with it, so the spacer has to
         * absorb that too or the feed creeps upward by 0.6rem a card. */
        prev.style.height = (parseFloat(prev.style.height) || 0) + height + gap + "px";
        feedEl.removeChild(el);
      } else {
        var sp = document.createElement("div");
        sp.className = "card-trimmed";
        sp.style.height = height + "px";
        sp.innerHTML = '<span>Earlier cards were cleared to keep scrolling smooth.</span>';
        feedEl.replaceChild(sp, el);
      }
    }
  }

  function decorate(cardEl) {
    var id = cardEl.dataset.id;
    if (E.isLiked(id)) cardEl.querySelector(".act.like").classList.add("on");
    if (E.isSaved(id)) cardEl.querySelector(".act.save").classList.add("on");
  }

  function observeSentinel() {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: "900px 0px" }).observe(sentinel);
  }

  /* -------- impression + skim detection -------- */

  var visTimes = new Map(); // element -> first-visible ts
  var skimObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var el = en.target, card = byId[el.dataset.id];
      if (!card) return;
      if (en.isIntersecting) {
        if (!visTimes.has(el)) visTimes.set(el, performance.now());
        E.markSeen(card);
      } else if (visTimes.has(el)) {
        var dwell = performance.now() - visTimes.get(el);
        visTimes.delete(el);
        // scrolled past quickly, upward exits don't count against the card
        var rect = el.getBoundingClientRect();
        if (dwell < SKIM_MS && rect.top < 0 && !el.dataset.engaged) E.skim(card);
        skimObserver.unobserve(el);
      }
    });
  }, { threshold: 0.4 });

  function watchCard(el) {
    skimObserver.observe(el);
    var cv = el.querySelector(".race-canvas");
    if (cv) raceObserver.observe(cv);
    // Bluesky video posters become muted autoplaying clips when they reach the
    // middle of the screen. No-op when the reader has asked for less motion or
    // less data, or when the browser cannot play HLS.
    if (root.BskyVideo) BskyVideo.watch(el);
    if (root.YtVideo) YtVideo.watch(el);
  }

  /* ---------------- bar chart races ---------------- */

  // One fetch per race file, shared across every card that points at it, and
  // only issued when a race card actually reaches the viewport. A tab full of
  // race cards therefore downloads only the races that get looked at.
  var raceFetches = Object.create(null);
  var racePlayers = new Map();     // canvas -> controller
  var raceTick = 0;

  function loadRaceData(url) {
    if (!raceFetches[url]) {
      raceFetches[url] = fetch(url).then(function (r) {
        if (!r.ok) throw new Error(url + " " + r.status);
        return r.json();
      }).catch(function (e) {
        delete raceFetches[url];      // let a later scroll-in retry
        throw e;
      });
    }
    return raceFetches[url];
  }

  function mountRace(cv) {
    if (racePlayers.has(cv)) return Promise.resolve(racePlayers.get(cv));
    if (cv.dataset.mounting) return Promise.resolve(null);
    cv.dataset.mounting = "1";
    var status = cv.parentNode.querySelector("[data-race-status]");
    return loadRaceData(cv.dataset.race).then(function (race) {
      delete cv.dataset.mounting;
      /* Four renderers, one lifecycle. A bar chart race, a Teammates Score
       * scoreboard, a head-to-head comparison and a media-lean chart are
       * different pictures with
       * identical needs — fetch on scroll-in, play while visible, pause on the
       * way out, scrub, tear down with the feed — so they share every line of
       * that and differ only here. All four expose the same control object. */
      var engine = cv.dataset.player === "mates" ? root.MatesPlayer
        : cv.dataset.player === "compare" ? root.ComparePlayer
        : cv.dataset.player === "lean" ? root.LeanPlayer
        : root.RacePlayer;
      if (!engine) throw new Error((cv.dataset.player || "race") + " player missing");
      /* Pacing hints ride on the canvas so a card can ask for a different
       * runtime without this lifecycle knowing which renderer will read it.
       * Nothing sets them today beyond the data files themselves; the path
       * exists so a single unusual card can be slowed down or sped up without
       * a code change. */
      var ctl = engine.mount(cv, race, {
        onEnd: function () { syncRaceControls(cv); },
        targetMs: +cv.dataset.targetMs || 0,
        pace: cv.dataset.pace || ""
      });
      if (!ctl) throw new Error("nothing to play");
      racePlayers.set(cv, ctl);
      if (status) status.remove();
      cv.classList.add("ready");
      syncRaceControls(cv);
      return ctl;
    }).catch(function (e) {
      delete cv.dataset.mounting;
      console.warn("[doomscroll] race failed:", e.message);
      if (status) status.textContent = "this race could not load";
      return null;
    });
  }

  function raceControls(cv) {
    var card = cv.closest(".card");
    return card ? {
      btn: card.querySelector("[data-race-toggle]"),
      scrub: card.querySelector("[data-race-scrub]")
    } : { btn: null, scrub: null };
  }

  /* Teammates cards withhold both final scores and the verdict until the
   * animation has actually arrived at them - see renderMates. This writes them
   * in. Called when the race ends, when it is scrubbed to the end, when
   * reduced motion means there was never an animation to watch, and when the
   * reader asks outright. Idempotent: revealing twice is a no-op. */
  function revealMatesResult(cardEl) {
    if (!cardEl || cardEl.dataset.spoiled) return;
    var scores = cardEl.querySelectorAll(".mt-score[data-score]");
    if (!scores.length) return;
    cardEl.dataset.spoiled = "1";
    for (var i = 0; i < scores.length; i++) scores[i].textContent = scores[i].dataset.score;
    var box = cardEl.querySelector(".mt-verdict[data-spoiler]");
    if (!box) return;
    var btn = box.querySelector(".mt-spoil-btn");
    var txt = box.querySelector(".mt-verdict-text");
    if (btn) btn.hidden = true;
    if (txt) txt.hidden = false;
  }

  function syncRaceControls(cv) {
    var ctl = racePlayers.get(cv);
    var el = raceControls(cv);
    if (!ctl || !el.btn) return;
    if (cv.dataset.player === "mates" && (ctl.reducedMotion || ctl.progress >= 1)) {
      revealMatesResult(cv.closest(".card"));
    }
    if (ctl.reducedMotion) {
      el.btn.textContent = "Final";
      el.btn.disabled = true;
    } else {
      el.btn.textContent = ctl.playing ? "Pause" : (ctl.progress >= 1 ? "Replay" : "Play");
    }
    if (el.scrub && document.activeElement !== el.scrub) {
      el.scrub.value = String(Math.round(ctl.progress * 1000));
    }
  }

  // One timer for the whole feed rather than a callback per player: the only
  // thing that needs syncing while a race runs is its own scrub position.
  function ensureRaceTick() {
    if (raceTick) return;
    raceTick = root.setInterval(function () {
      var any = false;
      racePlayers.forEach(function (ctl, cv) {
        if (ctl.playing) { any = true; syncRaceControls(cv); }
      });
      if (!any) { root.clearInterval(raceTick); raceTick = 0; }
    }, 200);
  }

  /* Races no longer decide for themselves whether to play.
   *
   * This observer does two separate jobs and it is worth keeping them apart.
   * MOUNTING still happens on a low threshold, because a player that has not
   * fetched its data cannot start the moment it is wanted - but mounting only
   * builds the canvas, it does not animate. PLAYING is decided by
   * MediaCoordinator, which is also weighing the Bluesky clip two cards down.
   * Before this, both systems said yes and a race and a video animated at once.
   *
   * The thresholds are a list rather than one number so the coordinator gets a
   * usable ratio to compare instead of a bare in/out. */
  var raceObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var cv = en.target;
      if (en.isIntersecting) {
        mountRace(cv).then(function (ctl) {
          if (!ctl) return;
          M.register(cv, {
            kind: cv.dataset.player || "race",
            play: function () {
              ctl.play();
              ensureRaceTick();
              syncRaceControls(cv);
            },
            pause: function () { ctl.pause(); syncRaceControls(cv); },
            isPlaying: function () { return ctl.playing; }
          });
          // Re-measure: it may have scrolled away while the JSON was in flight.
          var r = cv.getBoundingClientRect();
          var vh = root.innerHeight || 1;
          var vis = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
          M.note(cv, r.height ? vis / r.height : 0);
        });
      } else {
        M.note(cv, 0);
      }
    });
  }, { threshold: [0, 0.2, 0.35, 0.6, 0.8, 1] });

  function destroyRaces(rootEl) {
    M.releaseIn(rootEl);
    racePlayers.forEach(function (ctl, cv) {
      if (!rootEl || rootEl.contains(cv)) { ctl.destroy(); racePlayers.delete(cv); }
    });
  }

  feedEl.addEventListener("click", function (ev) {
    var t = ev.target.closest("[data-race-toggle]") ||
            (ev.target.classList && ev.target.classList.contains("race-canvas") ? ev.target : null);
    if (!t) return;
    var card = t.closest(".card");
    var cv = card && card.querySelector(".race-canvas");
    if (!cv) return;
    card.dataset.engaged = "1";
    mountRace(cv).then(function (ctl) {
      if (!ctl) return;
      /* Through the coordinator rather than straight at the controller, so a
       * deliberate play outranks whatever is centred, and a deliberate pause
       * is not undone by scrolling away and back. */
      M.manualToggle(cv);
      ensureRaceTick();
      syncRaceControls(cv);
    });
  });

  feedEl.addEventListener("click", function (ev) {
    if (ev.target.closest("[data-entity-clear]")) { clearEntity(); return; }
    var sp = ev.target.closest("[data-race-speed]");
    if (!sp) return;
    var card = sp.closest(".card");
    var cv = card && card.querySelector(".race-canvas");
    if (!cv) return;
    card.dataset.engaged = "1";
    var SPEEDS = [1, 1.5, 2, 0.5];
    var next = SPEEDS[(SPEEDS.indexOf(Number(sp.dataset.speed || 1)) + 1) % SPEEDS.length];
    sp.dataset.speed = String(next);
    sp.innerHTML = (next === 0.5 ? "0.5" : next) + "&times;";
    mountRace(cv).then(function (ctl) { if (ctl) ctl.setSpeed(next); });
  });

  feedEl.addEventListener("input", function (ev) {
    var s = ev.target.closest("[data-race-scrub]");
    if (!s) return;
    var card = s.closest(".card");
    var cv = card && card.querySelector(".race-canvas");
    if (!cv) return;
    card.dataset.engaged = "1";
    mountRace(cv).then(function (ctl) {
      if (!ctl) return;
      ctl.pause();
      ctl.seek(Number(s.value) / 1000);
      syncRaceControls(cv);
    });
  });

  /* ---------------- interactions ---------------- */

  feedEl.addEventListener("click", function (ev) {
    var actEl = ev.target.closest("[data-action]");
    if (!actEl) return;
    var cardEl = actEl.closest(".card");
    var card = cardEl && byId[cardEl.dataset.id];
    if (!card) return;
    cardEl.dataset.engaged = "1";
    var action = actEl.dataset.action;

    /* The Daily Five's own controls. Handled before the generic card actions
     * because "next" and the three share buttons belong to the wrapper, not to
     * whichever question is currently inside it. */
    if (action.indexOf("daily-") === 0) {
      if (action === "daily-next") { refreshDaily(); return; }
      if (root.DailyFive) {
        var F = root.DailyFive;
        var ids = F.pick(allCards.filter(usableCard), F.dayKey()).map(function (x) { return x.id; });
        var st = F.state(ids, F.dayKey());
        var text = F.shareText(st);
        /* The app's own address, not a baked-in one: this has to keep
         * working on localhost, and to follow the feed if it ever moves onto
         * hoopsmatic.com. Query and hash stripped so a shared grid opens a
         * clean feed rather than someone else's deep link. */
        var u = new URL(window.location.href);
        u.search = ""; u.hash = "";
        var url = u.toString();
        if (action === "daily-copy") { copyText(text + "\n" + url); toast("Result copied"); return; }
        if (action === "daily-x") {
          window.open("https://x.com/intent/post?text=" + encodeURIComponent(text) +
            "&url=" + encodeURIComponent(url), "_blank", "noopener,noreferrer");
          return;
        }
        if (action === "daily-bsky") {
          window.open("https://bsky.app/intent/compose?text=" +
            encodeURIComponent(text + "\n\n" + url), "_blank", "noopener,noreferrer");
          return;
        }
      }
      return;
    }

    if (action === "like") {
      actEl.classList.toggle("on", E.like(card));
      pulse(actEl);
    } else if (action === "save") {
      actEl.classList.toggle("on", E.save(card));
      pulse(actEl);
    } else if (action === "share") {
      shareCard(card);
    } else if (action === "tap") {
      E.tap(card); // link itself navigates
    } else if (action === "quiz" || action === "ballot") {
      answerQuiz(cardEl, actEl, card, action);
    } else if (action === "trivia") {
      answerTrivia(cardEl, actEl, card);
    } else if (action === "reveal") {
      revealFace(cardEl);
    } else if (action === "hint") {
      revealHint(cardEl, actEl);
    } else if (action === "spoil") {
      // Skipping to the answer is a deliberate choice, so it counts as
      // engagement rather than as the skim a fast scroll-past would log.
      revealMatesResult(cardEl);
    }
  });

  /* Both the mask and the image get the class: the mask is what the current
   * markup styles, the image is what a card rendered before the mask existed
   * styles. Either alone would leave one of the two blurred forever. */
  function revealFace(cardEl) {
    var mask = cardEl.querySelector(".quiz-sil-mask");
    if (mask) mask.classList.add("revealed");
    var sil = cardEl.querySelector(".quiz-sil");
    if (sil) sil.classList.add("revealed");
  }

  /* The picture is no longer obscured, so hints only narrow the field - which
   * is what a hint is. Kept as a no-op rather than removed so every existing
   * call site stays valid and a cached card cannot end up half-styled. */
  function setObscure() {}

  // One hint per tap, vague to specific. Taking a hint counts as engagement,
  // so a card someone worked at is not also logged as a skim.
  function revealHint(cardEl, btn) {
    var box = cardEl.querySelector(".quiz-hints");
    if (!box) return;
    var hints;
    try { hints = JSON.parse(box.dataset.hints); } catch (e) { return; }
    var shown = Number(box.dataset.shown || 0);
    if (shown >= hints.length) return;
    var li = document.createElement("li");
    li.textContent = hints[shown];
    cardEl.querySelector(".quiz-hint-list").appendChild(li);
    shown++;
    box.dataset.shown = String(shown);
    setObscure(cardEl, shown);
    if (shown >= hints.length) {
      btn.disabled = true;
      btn.textContent = "No hints left";
    } else {
      btn.textContent = "Another hint (" + (hints.length - shown) + " left)";
    }
  }

  function pulse(el) {
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
  }

  function answerQuiz(cardEl, btn, card, action) {
    var wrap = cardEl.querySelector(".quiz-opts");
    if (wrap.dataset.done) return;
    wrap.dataset.done = "1";
    var correct;
    if (action === "ballot") {
      correct = String(btn.dataset.pick) === String(wrap.dataset.answerIdx);
      var answerBtn = wrap.children[Number(wrap.dataset.answerIdx)];
      if (answerBtn) answerBtn.classList.add("correct");
    } else {
      correct = btn.dataset.pick === wrap.dataset.answer;
      Array.prototype.forEach.call(wrap.children, function (b) {
        if (b.dataset.pick === wrap.dataset.answer) b.classList.add("correct");
      });
      revealFace(cardEl);
    }
    if (!correct) btn.classList.add("wrong");
    var res = cardEl.querySelector(".quiz-result");
    res.hidden = false;
    var detail = card.payload.detail;
    res.innerHTML = '<span>' + (correct ? "Correct." : "Nope.") + '</span>' +
      (detail ? '<span class="quiz-detail">' + esc(detail) + '</span>' : "");
    /* The source appears only now. Before answering it is hidden, because a
     * HoopsHype URL usually contains the player's name and would give away a
     * "which player is this about?" card to anyone reading a status bar. */
    var src = cardEl.querySelector(".friv-source");
    if (src) src.hidden = false;
    res.className = "quiz-result " + (correct ? "good" : "bad");
    var hintBox = cardEl.querySelector(".quiz-hints");
    E.quizAnswered(card, {
      correct: correct,
      hints: hintBox ? Number(hintBox.dataset.shown || 0) : 0
    });
    scoreAnswer(card, correct, cardEl);
  }

  function answerTrivia(cardEl, btn, card) {
    var wrap = cardEl.querySelector(".trivia-opts");
    if (wrap.dataset.done) return;
    wrap.dataset.done = "1";
    var correct = btn.dataset.pick === wrap.dataset.answer;
    wrap.classList.add("revealed"); // shows the hidden values via CSS
    Array.prototype.forEach.call(wrap.querySelectorAll(".trivia-opt"), function (b) {
      if (b.dataset.pick === wrap.dataset.answer) b.classList.add("correct");
    });
    if (!correct) btn.classList.add("wrong");
    var res = cardEl.querySelector(".quiz-result");
    res.hidden = false;
    /* Cap Call carries a detail line - what each point actually cost - which
     * is the payoff of the card and only makes sense once the numbers show.
     * Ordinary trivia cards have none and read exactly as before. */
    var detail = card.payload.detail;
    res.innerHTML = '<span>' + (correct ? "Correct." : "Nope.") + '</span>' +
      (detail ? '<span class="quiz-detail">' + esc(detail) + '</span>' : "");
    res.className = "quiz-result " + (correct ? "good" : "bad");
    var hintBox = cardEl.querySelector(".quiz-hints");
    E.quizAnswered(card, {
      correct: correct,
      hints: hintBox ? Number(hintBox.dataset.shown || 0) : 0
    });
    scoreAnswer(card, correct, cardEl);
  }

  /* ---------------- share ---------------- */

  function cardUrl(card) {
    var u = new URL(window.location.href);
    u.search = "";
    u.searchParams.set("tab", state.tab);
    u.searchParams.set("card", card.id);
    return u.toString();
  }

  /* Can this browser put an actual FILE in the native share sheet?
   * Feature-detected against a real one-byte file: Safari and Chrome both
   * advertise navigator.share while refusing files, and the difference is the
   * whole point of the fast path. */
  function canShareFiles() {
    try {
      if (!navigator.canShare || !navigator.share || typeof File !== "function") return false;
      return navigator.canShare({ files: [new File(["x"], "t.png", { type: "image/png" })] });
    } catch (e) { return false; }
  }

  function shareBlob(card, blob, url) {
    return navigator.share({
      files: [new File([blob], ShareImage.filename(card), { type: "image/png" })],
      text: ShareText.text(card),
      url: url
    });
  }

  /* THE SHEET, ALWAYS.
   *
   * There used to be a fast path here: if navigator.canShare reported it could
   * put a file in the OS share sheet, the Share button rendered the PNG and
   * went straight there, skipping the modal. On a phone that is the right
   * trade. On Windows it is not, and Windows is where Jorge tested it: Chrome
   * and Edge both advertise file sharing there, so every card's Share button
   * opened the Windows "Compartir" panel offering Paint, Teams, OneDrive and a
   * contacts list. No X, no Bluesky, no @hoopshype, no link - the OS sheet
   * carries the file and drops the text on most targets. Jorge: "Not good."
   *
   * The destinations that matter for a feed are the two social composers, and
   * the only thing that reaches them is this sheet. So the sheet always opens,
   * and it is one tap on every platform instead of one on some and a dead end
   * on others. The native sheet is still in there as "More…" for the phone case
   * where handing Instagram or WhatsApp an actual image is the point - see the
   * nativeBtn line in openShareSheet, which is what feature-detects it now.
   *
   * canShareFiles() is still used by the "More…" and native buttons below. */
  function shareCard(card) {
    openShareSheet(card, cardUrl(card));
  }

  function openShareSheet(card, url) {
    var sheet = document.getElementById("shareSheet");
    sheet.dataset.cardId = card.id;
    sheet.querySelector(".share-url").textContent = url || cardUrl(card);
    /* Only offered when there is a native sheet AND the fast path did not
     * already use it - otherwise it is a second button doing the same job. */
    /* "More…" hands the card to the OS sheet, which is worth having on a phone
     * (Instagram, WhatsApp, Messages all take the image) and worth NOT having
     * as the default, because on desktop that sheet cannot reach X or Bluesky.
     * So it is one button among five rather than the whole share flow. */
    var nativeBtn = sheet.querySelector('[data-share="native"]');
    nativeBtn.hidden = !navigator.share;
    sheet.hidden = false;
    document.body.classList.add("modal-open");
  }

  function currentShareCard() {
    return byId[document.getElementById("shareSheet").dataset.cardId];
  }

  document.getElementById("shareSheet").addEventListener("click", function (ev) {
    var sheet = this;
    if (ev.target === sheet || ev.target.closest('[data-share="close"]')) {
      sheet.hidden = true;
      document.body.classList.remove("modal-open");
      return;
    }
    var btn = ev.target.closest("[data-share]");
    if (!btn) return;
    var kind = btn.dataset.share;
    var card = currentShareCard();
    if (!card) return;
    var url = cardUrl(card);

    if (kind === "link") {
      copyText(url);
      closeShare();
    } else if (kind === "x" || kind === "bsky") {
      /* Opened before any await, so it is still inside the click and no popup
       * blocker eats it. noopener because the composer must not get a handle
       * on this window. */
      window.open(ShareText.composeUrl(kind, card, url), "_blank", "noopener,noreferrer");
      closeShare();
    } else if (kind === "image" || kind === "native") {
      btn.disabled = true;
      var was = btn.textContent;
      btn.textContent = "Rendering…";
      ShareImage.render(card).then(function (blob) {
        if (kind === "native" && canShareFiles()) return shareBlob(card, blob, url);
        if (kind === "native") return navigator.share({ title: "NBA Doomscroll — HoopsMatic", url: url });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = ShareImage.filename(card);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
        toast("Image saved");
      }).catch(function (e) {
        if (e && e.name === "AbortError") return;  // user dismissed the sheet
        toast("Could not make the image: " + e.message);
      }).then(function () {
        btn.disabled = false;
        btn.textContent = was;
        closeShare();
      });
    }
  });

  function closeShare() {
    var s = document.getElementById("shareSheet");
    s.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast("Link copied"); },
        function () { window.prompt("Copy this link:", text); });
    } else {
      window.prompt("Copy this link:", text);
    }
  }

  var pendingShareId = null;

  function handleShareLink() {
    var params = new URLSearchParams(window.location.search);
    var id = params.get("card");
    var tab = params.get("tab");
    var who = params.get("player"), team = params.get("team");
    if (who || team) {
      state.entity = { kind: who ? "player" : "team", value: who || team };
      ensurePools(ALL_POOLS);
      renderTabs();
    }
    if (tab && TABS.some(function (t) { return t.key === tab; })) { state.tab = tab; renderTabs(); }
    if (!id) return false;
    if (!byId[id]) { pendingShareId = id; return false; }   // retried on pool arrival
    pendingShareId = null;
    var holder = document.createElement("div");
    holder.innerHTML = C.render(byId[id]);
    var el = holder.firstChild;
    el.classList.add("pinned");
    decorate(el);
    watchCard(el);
    var note = document.createElement("div");
    note.className = "pinned-note mono";
    note.textContent = "shared card";
    // Prepend, not append. On the retry path (the card's pool arrives after the
    // first batch has already rendered) appending put the shared card at the
    // bottom of eight unrelated ones, so the link opened on something else.
    feedEl.insertBefore(el, feedEl.firstChild);
    feedEl.insertBefore(note, el);
    window.scrollTo(0, 0);
    return true;
  }

  /* ---------------- toast ---------------- */

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 1800);
  }

  /* ---------------- onboarding ---------------- */

  var TEAM_LIST = ["ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GSW","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NOP","NYK","OKC","ORL","PHI","PHX","POR","SAC","SAS","TOR","UTA","WAS"];
  var ERA_LIST = ["1960s","1970s","1980s","1990s","2000s","2010s","2020s"];
  var LOGO = "https://jsierrahoopshype.github.io/nba-headshots/teams/logos/current/svg/";

  /* Asked first, and before teams. A team and an era narrow WHICH cards you
   * see; what kind of card you want is the bigger lever on whether the feed is
   * worth scrolling at all, and it is the one question a new reader can answer
   * without thinking. The keys match the engine's own tag keys
   * ("type:" + content_type), so no seeding logic is needed for them. */
  var TYPE_LIST = [
    { key: "trade",  label: "Trades",     note: "deals other people built" },
    { key: "rumor",  label: "Rumors",     note: "from this day in history" },
    { key: "vs",     label: "Battles",    note: "career vs career" },
    { key: "quiz",   label: "Quizzes",    note: "guess the player" },
    { key: "trivia", label: "Trivia",     note: "two players, one stat" },
    /* Not "80 seasons in 90 seconds": no race runs 90 seconds any more, and
     * plenty do not span 80 seasons. Pacing is content-aware now (js/pacing.js
     * sizes each run to its frame count), so the copy stops promising a
     * stopwatch reading it cannot keep. */
    { key: "race",   label: "Races",      note: "NBA history in about a minute" },
    { key: "salary", label: "Salaries",   note: "what it cost, in cap share" },
    { key: "otd",    label: "On this day", note: "games from this date" }
  ];

  /* Optional player picker. Names come from the card pools already in memory,
   * so it needs no extra data file and can only ever offer players the feed can
   * actually show. It is below teams on purpose: it is the one step that asks
   * the reader to think rather than tap. */
  var obPicked = [];

  function obPlayerNames() {
    var seen = Object.create(null), out = [];
    allCards.forEach(function (c) {
      ((c.tags && c.tags.players) || []).forEach(function (n) {
        if (n && !seen[n]) { seen[n] = 1; out.push(n); }
      });
    });
    return out.sort();
  }

  function renderObPicked() {
    document.getElementById("obPlayerPicked").innerHTML = obPicked.map(function (n) {
      return '<button class="ob-chip" type="button" data-ob-drop="' + esc(n) + '">' +
        esc(n) + ' <span aria-hidden="true">&times;</span></button>';
    }).join("");
  }

  function wireObPlayers() {
    var input = document.getElementById("obPlayerSearch");
    var results = document.getElementById("obPlayerResults");
    if (!input) return;
    var names = obPlayerNames();
    input.addEventListener("input", function () {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { results.hidden = true; results.innerHTML = ""; return; }
      var hits = names.filter(function (n) { return n.toLowerCase().indexOf(q) >= 0; }).slice(0, 8);
      if (!hits.length) { results.hidden = true; results.innerHTML = ""; return; }
      results.innerHTML = hits.map(function (n) {
        return '<button class="ob-result" type="button" data-ob-add="' + esc(n) + '">' + esc(n) + '</button>';
      }).join("");
      results.hidden = false;
    });
    document.getElementById("onboard").addEventListener("click", function (ev) {
      var add = ev.target.closest("[data-ob-add]");
      if (add) {
        if (obPicked.indexOf(add.dataset.obAdd) < 0) obPicked.push(add.dataset.obAdd);
        input.value = ""; results.hidden = true; results.innerHTML = "";
        renderObPicked();
        return;
      }
      var drop = ev.target.closest("[data-ob-drop]");
      if (drop) {
        obPicked = obPicked.filter(function (n) { return n !== drop.dataset.obDrop; });
        renderObPicked();
      }
    });
  }

  function showOnboarding() {
    var m = document.getElementById("onboard");
    m.querySelector(".ob-types").innerHTML = TYPE_LIST.map(function (t) {
      return '<button class="ob-pick type" data-key="type:' + t.key + '">' +
        '<b>' + esc(t.label) + '</b><span>' + esc(t.note) + "</span></button>";
    }).join("");
    m.querySelector(".ob-teams").innerHTML = TEAM_LIST.map(function (t) {
      return '<button class="ob-pick" data-key="team:' + t + '"><img loading="lazy" src="' + LOGO + t.toLowerCase() + '.svg" alt=""><span>' + t + "</span></button>";
    }).join("");
    m.querySelector(".ob-eras").innerHTML = ERA_LIST.map(function (e2) {
      return '<button class="ob-pick era" data-key="era:' + e2 + '">' + e2 + "</button>";
    }).join("");
    obPicked = [];
    renderObPicked();
    wireObPlayers();
    m.hidden = false;
    document.body.classList.add("modal-open");
  }

  document.getElementById("onboard").addEventListener("click", function (ev) {
    var pick = ev.target.closest(".ob-pick");
    if (pick) { pick.classList.toggle("on"); return; }
    if (ev.target.closest("[data-ob=start]")) {
      var keys = Array.prototype.map.call(this.querySelectorAll(".ob-pick.on"), function (b) { return b.dataset.key; });
      // "player:Name" is already a tag key the engine weights, so a picked
      // player needs no special handling beyond being seeded harder than a
      // team — it is a much more specific thing to ask for.
      obPicked.forEach(function (n) { keys.push("player:" + n, "player:" + n); });
      if (keys.length) E.seed(keys); else E.skipOnboarding();
      closeOnboarding(keys.length);
    } else if (ev.target.closest("[data-ob=skip]")) {
      E.skipOnboarding();
      closeOnboarding(false);
    }
  });

  function closeOnboarding(reseed) {
    document.getElementById("onboard").hidden = true;
    document.body.classList.remove("modal-open");
    if (reseed) { feedEl.innerHTML = ""; state.exhausted = false; loadMore(); }
  }

  /* ---------------- profile panel ---------------- */

  var panel = document.getElementById("panel");
  document.getElementById("profileBtn").addEventListener("click", function () {
    renderPanel();
    panel.hidden = false;
    document.body.classList.add("modal-open");
  });
  panel.addEventListener("click", function (ev) {
    if (ev.target === panel || ev.target.closest("[data-panel=close]")) {
      panel.hidden = true;
      document.body.classList.remove("modal-open");
      return;
    }
    var act = ev.target.closest("[data-panel]");
    if (!act) return;
    var kind = act.dataset.panel;
    if (kind === "reset") {
      if (confirm("Reset the algorithm? Your likes/saves stay, tag weights are wiped.")) {
        E.resetAlgorithm(); renderPanel(); toast("Algorithm reset");
      }
    } else if (kind === "delete") {
      if (confirm("Delete ALL local data? Likes, saves, weights — everything. This cannot be undone.")) {
        E.deleteAll();
        // "everything" has to mean everything, including the scoreboard.
        if (root.Scoreboard) root.Scoreboard.reset();
        panel.hidden = true; document.body.classList.remove("modal-open");
        window.location.search = ""; // full clean reload
      }
    } else if (kind === "export") {
      var blob = new Blob([E.exportProfile()], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "nba-doomscroll-profile.json";
      a.click();
      URL.revokeObjectURL(a.href);
    } else if (kind === "import") {
      document.getElementById("importFile").click();
    }
  });

  document.getElementById("importFile").addEventListener("change", function () {
    var f = this.files[0];
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try { E.importProfile(reader.result); renderPanel(); toast("Profile imported"); }
      catch (e) { toast("Import failed: " + e.message); }
    };
    reader.readAsText(f);
    this.value = "";
  });

  function tagLabel(key) {
    var i = key.indexOf(":");
    var kind = key.slice(0, i), val = key.slice(i + 1);
    var kindLabel = { player: "player", team: "team", era: "era", type: "type", cat: "" }[kind];
    return (kindLabel ? kindLabel + " · " : "") + val;
  }

  function renderPanel() {
    var s = E.stats();
    function rows(list, cls) {
      if (!list.length) return '<div class="panel-empty">nothing yet — keep scrolling</div>';
      var max = Math.max.apply(null, list.map(function (e) { return Math.abs(e.w); }).concat([1]));
      return list.map(function (e) {
        var pct = Math.round(Math.abs(e.w) / max * 100);
        return '<div class="w-row"><span class="w-label">' + esc(tagLabel(e.key)) + '</span>' +
          '<span class="w-bar"><i class="' + cls + '" style="width:' + pct + '%"></i></span>' +
          '<span class="w-num mono">' + e.w.toFixed(1) + "</span></div>";
      }).join("");
    }
    function cardList(ids) {
      if (!ids.length) return '<div class="panel-empty">empty</div>';
      return ids.slice(0, 30).map(function (id) {
        var c = byId[id];
        if (!c) return "";
        return '<a class="mini-card" href="?tab=' + esc(state.tab) + '&card=' + esc(id) + '">' +
          '<span class="chip">' + esc(c.type) + "</span><span>" + esc(miniTitle(c)) + "</span></a>";
      }).join("");
    }
    document.getElementById("panelBody").innerHTML =
      '<section><h3>What the algorithm thinks you like</h3>' + rows(s.top, "up") + "</section>" +
      '<section><h3>What it is showing you less</h3>' + rows(s.bottom, "down") + "</section>" +
      '<section><h3>Saved (' + s.nSaved + ')</h3>' + cardList(E.savedIds()) + "</section>" +
      '<section><h3>Liked (' + s.nLiked + ')</h3>' + cardList(E.likedIds()) + "</section>" +
      '<section class="panel-meta mono">' + s.counts.like + " likes · " + s.counts.save + " saves · " +
      s.counts.tap + " tap-throughs · " + s.counts.quiz + " quizzes · " + s.nTags + " tags tracked</section>";
  }

  function miniTitle(c) {
    var p = c.payload || {};
    switch (c.type) {
      case "trade": return (p.sides || []).map(function (s) { return s.team; }).join(" ↔ ");
      case "rumor": return (p.text || "").slice(0, 60);
      case "vs": return p.p1.name + " vs " + p.p2.name;
      case "trivia": return p.question;
      case "quiz": return "Guess the player (" + p.difficulty + ")";
      case "ballot": return p.question;
      case "careermap": return p.question;
      case "dreamteam": return p.question;
      case "salary": return p.player + ", " + (p.season || p.year);
      case "oddity": return p.headline;
      case "otd": return p.away + " @ " + p.home + ", " + p.year;
      case "race": return p.title;
      default: return c.id;
    }
  }

  /* Escape closes whichever sheet is open. */
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    ["shareSheet", "panel", "onboard"].some(function (id) {
      var el = document.getElementById(id);
      if (el.hidden) return false;
      if (id === "onboard") { E.skipOnboarding(); closeOnboarding(false); }
      else { el.hidden = true; document.body.classList.remove("modal-open"); }
      return true;
    });
  });

  /* ---------------- privacy badge ---------------- */

})(window);
