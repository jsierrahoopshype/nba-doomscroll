/* NBA Doomscroll — app shell
 * Tabs, infinite feed, interactions, onboarding, profile panel, share links.
 * VS / Quiz / Trivia / Ballot run on real data built by tools/build_data.mjs.
 * Trades / Rumors / Vault still run on data/dummy-cards.json until their
 * sources are wired in (steps 4-5).
 */
(function () {
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
    { key: "vault", label: "Vault" }
  ];
  var BATCH = 8;
  var SKIM_MS = 1200; // visible less than this while scrolling past = skim

  var allCards = [];
  var byId = {};
  var state = { tab: "foryou", exhausted: false, loading: false };

  var feedEl = document.getElementById("feed");
  var tabsEl = document.getElementById("tabs");
  var sentinel = document.getElementById("sentinel");

  /* ---------------- boot ---------------- */

  // Eager pools are small and cover every tab's first screen. vs-pool is ~1.9MB
  // so it streams in behind the first paint and joins the mix on arrival.
  var EAGER_POOLS = ["data/dummy-cards.json", "data/quiz-pool.json",
                     "data/trivia-pool.json", "data/ballot-pool.json"];
  var LAZY_POOLS = ["data/vs-pool.json"];

  function addCards(list) {
    (list || []).forEach(function (c) {
      if (byId[c.id]) return;
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

  Promise.all(EAGER_POOLS.map(function (u) {
    return fetchPool(u).catch(function (e) { console.warn("[doomscroll] pool failed:", e.message); return []; });
  })).then(function (lists) {
    lists.forEach(addCards);
    if (!allCards.length) throw new Error("no cards loaded");
    E.startSession();
    renderTabs();
    var pinned = handleShareLink();
    if (E.needsOnboarding() && !pinned) showOnboarding();
    loadMore();
    renderSummary();
    observeSentinel();
    // background: the big VS pool
    LAZY_POOLS.forEach(function (u) {
      fetchPool(u).then(function (list) {
        addCards(list);
        state.exhausted = false;
        // top up a thin feed (e.g. the VS tab opened before the pool landed)
        if (feedEl.querySelectorAll(".card").length < BATCH) loadMore();
        renderSummary();
      }).catch(function (e) { console.warn("[doomscroll] lazy pool failed:", e.message); });
    });
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
    } else {
      el.innerHTML = "";
      el.hidden = true;
    }
  }

  tabsEl.addEventListener("click", function (ev) {
    var b = ev.target.closest("[data-tab]");
    if (!b || b.dataset.tab === state.tab) return;
    state.tab = b.dataset.tab;
    state.exhausted = false;
    renderTabs();
    feedEl.innerHTML = "";
    window.scrollTo(0, 0);
    loadMore();
    renderSummary();
    if (state.tab === "vs" && window.LiveVs) LiveVs.ready().catch(function () {});
  });

  document.getElementById("tabExtra").addEventListener("click", function (ev) {
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
    trades: "trades built in the Trade Machine, balance-filtered",
    rumors: "rumor history, legal/off-court topics filtered out",
    vs: "career comparisons scored the same way as the full tool",
    quiz: "guess the player, and trivia from real award ballots",
    vault: "salary history, ballot oddities, on this day"
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

  function poolForTab(tab) {
    if (tab === "foryou") return allCards;
    return allCards.filter(function (c) { return (c.tab || []).indexOf(tab) >= 0; });
  }

  /* ---------------- feed ---------------- */

  function loadMore() {
    if (state.loading || state.exhausted) return;
    state.loading = true;
    var pool = poolForTab(state.tab);
    // For You balances across card types; a single tab already is one type
    // family, so it uses the plain weighted draw.
    var batch = state.tab === "foryou" ? E.sampleMixed(pool, BATCH) : E.sample(pool, BATCH);
    if (!batch.length) {
      state.exhausted = true;
      state.loading = false;
      if (!feedEl.children.length) feedEl.innerHTML = '<div class="feed-msg">Nothing here yet.</div>';
      return;
    }
    var frag = document.createElement("div");
    frag.innerHTML = batch.map(C.render).join("");
    while (frag.firstChild) {
      var node = frag.firstChild;
      if (node.nodeType === 1) { decorate(node); watchCard(node); }
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

  function watchCard(el) { skimObserver.observe(el); }

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
    }
  });

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
    E.quizAnswered(card);
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
    E.quizAnswered(card);
  }

  /* ---------------- share ---------------- */

  function cardUrl(card) {
    var u = new URL(window.location.href);
    u.search = "";
    u.searchParams.set("tab", state.tab);
    u.searchParams.set("card", card.id);
    return u.toString();
  }

  function shareCard(card) {
    var url = cardUrl(card);
    if (navigator.share) {
      navigator.share({ title: "NBA Doomscroll — HoopsMatic", url: url }).catch(function () {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(function () { toast("Link copied"); });
    } else {
      window.prompt("Copy this link:", url);
    }
    // Shareable image render lands in step 6.
  }

  function handleShareLink() {
    var params = new URLSearchParams(window.location.search);
    var id = params.get("card");
    var tab = params.get("tab");
    if (tab && TABS.some(function (t) { return t.key === tab; })) { state.tab = tab; renderTabs(); }
    if (!id || !byId[id]) return false;
    var holder = document.createElement("div");
    holder.innerHTML = C.render(byId[id]);
    var el = holder.firstChild;
    el.classList.add("pinned");
    decorate(el);
    watchCard(el);
    var note = document.createElement("div");
    note.className = "pinned-note mono";
    note.textContent = "shared card";
    feedEl.appendChild(note);
    feedEl.appendChild(el);
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

  function showOnboarding() {
    var m = document.getElementById("onboard");
    m.querySelector(".ob-teams").innerHTML = TEAM_LIST.map(function (t) {
      return '<button class="ob-pick" data-key="team:' + t + '"><img loading="lazy" src="' + LOGO + t.toLowerCase() + '.svg" alt=""><span>' + t + "</span></button>";
    }).join("");
    m.querySelector(".ob-eras").innerHTML = ERA_LIST.map(function (e2) {
      return '<button class="ob-pick era" data-key="era:' + e2 + '">' + e2 + "</button>";
    }).join("");
    m.hidden = false;
    document.body.classList.add("modal-open");
  }

  document.getElementById("onboard").addEventListener("click", function (ev) {
    var pick = ev.target.closest(".ob-pick");
    if (pick) { pick.classList.toggle("on"); return; }
    if (ev.target.closest("[data-ob=start]")) {
      var keys = Array.prototype.map.call(this.querySelectorAll(".ob-pick.on"), function (b) { return b.dataset.key; });
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
      case "salary": return p.player + ", " + p.year;
      case "otd": return p.away + " @ " + p.home + ", " + p.year;
      case "race": return p.title;
      default: return c.id;
    }
  }

  /* ---------------- privacy badge ---------------- */

  document.getElementById("privacyBadge").addEventListener("click", function () {
    document.getElementById("privacyPop").hidden ^= 1;
  });
})();
