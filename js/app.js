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

  var TABS = [
    { key: "foryou", label: "For You" },
    { key: "buzz", label: "Buzz" },
    { key: "trades", label: "Trades" },
    { key: "rumors", label: "Rumors" },
    { key: "vs", label: "VS" },
    { key: "quiz", label: "Quiz" },
    { key: "vault", label: "History" },
    { key: "races", label: "Races" }
  ];
  var BATCH = 8;
  // Share of every mixed batch reserved for live Content Stream items.
  var BUZZ_SHARE = 0.4;
  var TAB_FOR_TYPE = { rumor: "rumors", trade: "trades", buzz: "buzz" };
  var SKIM_MS = 1200; // visible less than this while scrolling past = skim

  /* The one thing allowed to be moving at a time. See js/media.js. */
  var M = root.MediaCoordinator || {
    register: function () {}, unregister: function () {}, note: function () {},
    manualPlay: function () {}, manualPause: function () {}, manualToggle: function () {},
    releaseIn: function () {}, prefersQuiet: function () { return false; }
  };

  var allCards = [];
  /* Must match QUIZ_QUALITY in tools/build_data.mjs. A hard-tier player is a
   * long-serving journeyman who was never an All-Star, which is the good
   * question; easy stays in the pool at a low weight so the tab is not
   * relentless rather than being deleted from it. */
  var QUIZ_QUALITY = { hard: 1, medium: 0.55, easy: 0.15 };
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
  var state = { tab: "foryou", exhausted: false, loading: false, raceGroup: null, entity: null };

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
  var TAB_POOLS = {
    vs:     ["data/vs-pool.json", "data/teammates-pool.json", "data/compare-pool.json"],
    vault:  ["data/vault-pool.json", "data/lean-pool.json", "data/oddity-pool.json",
             "data/salary-pool.json"],
    races:  ["data/race-pool.json", "data/ballotrace-pool.json"],
    quiz:   ["data/frivolities-pool.json"],
    foryou: ["data/vs-pool.json", "data/vault-pool.json", "data/race-pool.json",
             "data/teammates-pool.json", "data/compare-pool.json",
             "data/ballotrace-pool.json", "data/lean-pool.json",
             "data/frivolities-pool.json", "data/oddity-pool.json",
             "data/salary-pool.json"]
  };

  /* Pools that may legitimately not exist.
   *
   * The Frivolities pool is built from the HoopsHype archive by a script run on
   * a machine that has it (tools/build_frivolities.mjs), and the archive is not
   * public. A checkout without that file is a normal state, not a broken one,
   * so its absence loads nothing and says so once rather than surfacing the
   * "could not load the card pools" error that a missing vs-pool should. */
  var OPTIONAL_POOLS = {
    "data/frivolities-pool.json": 1,
    /* Built from the Media Vote Tracker's ballots by tools/build_oddities.mjs.
     * Absent until that has been run, which is a normal state. */
    "data/oddity-pool.json": 1,
    /* Built from nba-player-data plus the cap table by tools/build_salary.mjs. */
    "data/salary-pool.json": 1
  };
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
    (list || []).forEach(function (c) {
      if (byId[c.id]) return;
      if (c.type === "otd" && c.payload.date && otdDate && c.payload.date !== otdDate) return;
      if (c.type === "otd" && !otdExact) c.payload.approx = true;
      /* Guess the Player shows a clear, full photograph, so the difficulty has
       * to come from the player rather than from the picture. build_data.mjs
       * emits this now; the fallback covers a pool built before it did, which
       * is every pool currently deployed. Deliberately does not overwrite a
       * score the builder set. */
      if (c.type === "quiz" && typeof c.quality_score !== "number" &&
          c.payload && QUIZ_QUALITY[c.payload.difficulty] !== undefined) {
        c.quality_score = QUIZ_QUALITY[c.payload.difficulty];
      }
      /* Story keys and quality for the pools whose builders emit neither, so
       * the engine's spacing and weighting apply to every card type rather
       * than to the three that happened to be built last. Fills gaps only -
       * see js/story.js. */
      if (root.DoomStory) root.DoomStory.annotate(c);
      byId[c.id] = c;
      allCards.push(c);
    });
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
    if (/^friv-/.test(id)) return TAB_POOLS.quiz;
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
    function swapInLive(loader, type) {
      if (!loader) return;
      loader.load().then(function (live) {
        // js/rumors.js is deliberately fail-soft and resolves with an empty
        // array rather than rejecting, so an empty result is the failure signal
        // — not just a rejected promise.
        if (!live || !live.length) {
          liveFailed[type] = true;
          if (type === "rumor") dropInventedRumors();
          // Buzz has no sample cards at all — it is live or it is nothing — so
          // a tab already sitting on its empty state has to be told.
          // exhausted has to be cleared first: the tab reached its empty state
          // on the first pass, and loadMore() returns immediately while that
          // flag is set — so clearing the feed without it would wipe the
          // message and leave a blank section.
          else if (state.tab === TAB_FOR_TYPE[type]) {
            state.exhausted = false; clearFeed(); loadMore();
          }
          return;
        }
        allCards = allCards.filter(function (c) {
          if (c.type === type && c.dummy) { delete byId[c.id]; return false; }
          return true;
        });
        addCards(live);
        state.exhausted = false;
        if (state.tab === TAB_FOR_TYPE[type] || state.tab === "foryou") {
          clearFeed();
          loadMore();
        }
        renderSummary();
      }).catch(function (e) {
        console.warn("[doomscroll] live " + type + " failed:", e.message);
        liveFailed[type] = true;
        if (type === "rumor") dropInventedRumors();
        else if (state.tab === TAB_FOR_TYPE[type]) { clearFeed(); loadMore(); }
      });
    }

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
      state.exhausted = false;
      if (state.tab === "rumors" || state.tab === "foryou") { clearFeed(); loadMore(); }
      renderSummary();
    }
    swapInLive(root.LiveRumors, "rumor");
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

  function poolForTab(tab, excludeRendered) {
    // The entity filter outranks the tab: it draws from everything.
    var pool = state.entity
      ? allCards.filter(function (c) { return matchesEntity(c, state.entity); })
      : (tab === "foryou" ? allCards
        : allCards.filter(function (c) { return (c.tab || []).indexOf(tab) >= 0; }));
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

  function loadMore() {
    if (state.loading || state.exhausted) return;
    state.loading = true;
    var pool = poolForTab(state.tab, true);
    // Any tab holding more than one card type gets the type-balanced draw.
    // Vault is the reason: its ~8 on-this-day cards for the current date would
    // otherwise be buried under 120 salary and 54 ballot-oddity cards, and
    // "on this day" is the whole point of having them.
    // Cap the media-heavy card type: a run of autoplaying clips stacked in one
    // batch is both visually noisy and the one thing here that costs real data.
    /* What the reader has just been shown, handed to the sampler so the next
     * batch does not repeat it. Twelve cards is roughly a screen and a half on
     * a phone: long enough that a repeat would be noticed, short enough that a
     * favourite player is still allowed to come back. */
    var avoid = recentlyShown();
    var batch = hasMixedTypes(pool)
      // Buzz gets a reserved 40% of every mixed batch — Jorge's call, and the
      // type-balanced draw cannot produce it on its own: it damps thin pools,
      // and ~50 live items is a thin pool against thousands of archive cards.
      ? E.sampleMixed(pool, BATCH, { cap: { race: 1, mates: 1, compare: 1, lean: 1 }, share: { buzz: BUZZ_SHARE }, avoid: avoid })
      // The Buzz tab reads newest-first, because it is the only tab where the
      // order carries information. Everywhere else the pool is an archive and
      // the shuffle is the point. The mixed batches above are untouched: this
      // governs the news tab on its own, not Buzz's share of the For You feed.
      // Guarded on the pool actually being single-type, because an entity
      // filter draws across every section regardless of which tab is open.
      : (state.tab === "buzz" ? E.recent(pool, BATCH, buzzTime) : E.sample(pool, BATCH, { avoid: avoid }));
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
        var end = document.createElement("div");
        end.className = "feed-msg feed-end";
        end.textContent = state.tab === "trades"
          ? "That is every trade that cleared the balance filter. Build one in the Trade Machine and it shows up here."
          : "You have seen everything here for now.";
        feedEl.appendChild(end);
      }
      return;
    }
    var frag = document.createElement("div");
    frag.innerHTML = batch.map(C.render).join("");
    while (frag.firstChild) {
      var node = frag.firstChild;
      if (node.nodeType === 1) { decorate(node); watchCard(node); rendered[node.dataset.id] = 1; }
      feedEl.appendChild(node);
    }
    state.loading = false;
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
    res.textContent = correct ? "Correct." : "Nope.";
    res.className = "quiz-result " + (correct ? "good" : "bad");
    var hintBox = cardEl.querySelector(".quiz-hints");
    E.quizAnswered(card, {
      correct: correct,
      hints: hintBox ? Number(hintBox.dataset.shown || 0) : 0
    });
  }

  /* ---------------- share ---------------- */

  function cardUrl(card) {
    var u = new URL(window.location.href);
    u.search = "";
    u.searchParams.set("tab", state.tab);
    u.searchParams.set("card", card.id);
    return u.toString();
  }

  /* Share offers both things the brief asks for: the card's own URL, and a
   * branded PNG. On phones that support sharing files, one tap hands both to
   * the native sheet; everywhere else the image downloads and the link copies.
   */
  function shareCard(card) {
    var url = cardUrl(card);
    var sheet = document.getElementById("shareSheet");
    sheet.dataset.cardId = card.id;
    sheet.querySelector(".share-url").textContent = url;
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
    } else if (kind === "image" || kind === "native") {
      btn.disabled = true;
      var was = btn.textContent;
      btn.textContent = "Rendering…";
      ShareImage.render(card).then(function (blob) {
        if (kind === "native" && navigator.canShare &&
            navigator.canShare({ files: [new File([blob], "card.png", { type: "image/png" })] })) {
          return navigator.share({
            files: [new File([blob], ShareImage.filename(card), { type: "image/png" })],
            text: "NBA Doomscroll — HoopsMatic",
            url: url
          });
        }
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
        E.deleteAll(); panel.hidden = true; document.body.classList.remove("modal-open");
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
