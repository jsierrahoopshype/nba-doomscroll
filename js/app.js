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
    { key: "trades", label: "Trades" },
    { key: "rumors", label: "Rumors" },
    { key: "vs", label: "VS" },
    { key: "quiz", label: "Quiz" },
    { key: "vault", label: "History" },
    { key: "races", label: "Races" }
  ];
  var BATCH = 8;
  var TAB_FOR_TYPE = { rumor: "rumors", trade: "trades" };
  var SKIM_MS = 1200; // visible less than this while scrolling past = skim

  var allCards = [];
  var byId = {};
  // Ids currently rendered in the feed. Sampling draws without replacement
  // within one batch, but nothing stopped a LATER batch re-drawing a card that
  // is already on screen — invisible with a 2,000-card pool, glaring with the
  // handful of live trades. Cleared whenever the feed is cleared.
  var rendered = {};
  var state = { tab: "foryou", exhausted: false, loading: false, raceGroup: null };

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
    vs:     ["data/vs-pool.json"],
    vault:  ["data/vault-pool.json"],
    races:  ["data/race-pool.json"],
    foryou: ["data/vs-pool.json", "data/vault-pool.json", "data/race-pool.json"]
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
      byId[c.id] = c;
      allCards.push(c);
    });
  }

  function fetchPool(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    }).then(function (d) { return d.cards || []; });
  }

  function deferIdle(fn) {
    if (root.requestIdleCallback) root.requestIdleCallback(fn, { timeout: 2500 });
    else root.setTimeout(fn, 1200);
  }

  // Which tab a shared card id belongs to, from its id prefix. Used only to
  // decide which pool to pull first when a link opens cold.
  function tabForShareId(id) {
    if (/^race-/.test(id)) return TAB_POOLS.races;
    if (/^vs-/.test(id)) return TAB_POOLS.vs;
    if (/^(salary|oddity|otd)-/.test(id)) return TAB_POOLS.vault;
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
          if (type === "rumor") dropInventedRumors();
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
        if (type === "rumor") dropInventedRumors();
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
      return '<button class="tab' + (t.key === state.tab ? " active" : "") + '" data-tab="' + t.key + '">' + t.label + "</button>";
    }).join("");
    renderTabExtra();
  }

  // Per-tab action strip. VS gets the live random-matchup generator.
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

  function goTab(key) {
    if (!key || key === state.tab || !TABS.some(function (t) { return t.key === key; })) return;
    state.tab = key;
    state.exhausted = false;
    state.raceGroup = null;
    renderTabs();
    clearFeed();
    window.scrollTo(0, 0);
    ensurePools(TAB_POOLS[state.tab] || []);
    loadMore();
    renderSummary();
    if (state.tab === "vs" && window.LiveVs) LiveVs.ready().catch(function () {});
  }

  tabsEl.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-tab]");
    if (b) goTab(b.dataset.tab);
  });

  // The type chip on every card is a link to that card's section.
  feedEl.addEventListener("click", function (ev) {
    var chip = ev.target.closest("[data-goto]");
    if (chip) goTab(chip.dataset.goto);
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
    trades: "real Trade Machine builds, deduped and balance-filtered",
    rumors: "rumor history, legal/off-court topics filtered out",
    vs: "career comparisons scored the same way as the full tool",
    quiz: "guess the player, two-player trivia, and real award ballots",
    vault: "cap-share salaries, ballot oddities, games on this date",
    races: "every franchise, country and college, one bar chart race at a time"
  };

  function renderSummary() {
    var el = document.getElementById("summary");
    if (!el) return;
    var n = poolForTab(state.tab).length;
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

  function poolForTab(tab, excludeRendered) {
    var pool = tab === "foryou" ? allCards
      : allCards.filter(function (c) { return (c.tab || []).indexOf(tab) >= 0; });
    if (tab === "races" && state.raceGroup) {
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
    feedEl.innerHTML = "";
    rendered = {};
  }

  /* ---------------- feed ---------------- */

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
    var batch = hasMixedTypes(pool)
      ? E.sampleMixed(pool, BATCH, { cap: { race: 1 } })
      : E.sample(pool, BATCH);
    if (!batch.length) {
      state.exhausted = true;
      state.loading = false;
      if (!feedEl.querySelector(".card")) {
        feedEl.innerHTML = state.tab === "rumors" && liveFailed.rumor
          ? '<div class="feed-msg">Rumors could not load right now. ' +
            'They come live from the HoopsHype archive — nothing is shown here until they do.' +
            '<br><br><a href="https://hoopshype.com/rumors/" target="_blank" rel="noopener">Read them on HoopsHype</a></div>'
          : '<div class="feed-msg">Nothing here yet.</div>';
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
      if (!root.RacePlayer) throw new Error("race player missing");
      var ctl = RacePlayer.mount(cv, race, {
        onEnd: function () { syncRaceControls(cv); }
      });
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

  function syncRaceControls(cv) {
    var ctl = racePlayers.get(cv);
    var el = raceControls(cv);
    if (!ctl || !el.btn) return;
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

  // A race starts when its card is on screen and pauses when it leaves — the
  // same contract the old muted autoplaying clips had.
  var raceObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      var cv = en.target;
      if (en.isIntersecting) {
        mountRace(cv).then(function (ctl) {
          if (!ctl) return;
          // It may have scrolled away while the JSON was in flight.
          var r = cv.getBoundingClientRect();
          if (r.bottom > 0 && r.top < root.innerHeight) {
            ctl.play();
            ensureRaceTick();
            syncRaceControls(cv);
          }
        });
      } else {
        var c = racePlayers.get(cv);
        if (c) { c.pause(); syncRaceControls(cv); }
      }
    });
  }, { threshold: 0.35 });

  function destroyRaces(rootEl) {
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
      ctl.toggle();
      ensureRaceTick();
      syncRaceControls(cv);
    });
  });

  feedEl.addEventListener("click", function (ev) {
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
      cardEl.querySelector(".quiz-sil").classList.add("revealed");
    } else if (action === "hint") {
      revealHint(cardEl, actEl);
    }
  });

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
      var sil = cardEl.querySelector(".quiz-sil");
      if (sil) sil.classList.add("revealed");
    }
    if (!correct) btn.classList.add("wrong");
    var res = cardEl.querySelector(".quiz-result");
    res.hidden = false;
    var detail = card.payload.detail;
    res.innerHTML = '<span>' + (correct ? "Correct." : "Nope.") + '</span>' +
      (detail ? '<span class="quiz-detail">' + esc(detail) + '</span>' : "");
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
    { key: "race",   label: "Races",      note: "80 seasons in 90 seconds" },
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
