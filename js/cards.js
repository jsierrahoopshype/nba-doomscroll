/* NBA Doomscroll — card renderers
 * One renderer per card type. Each returns inner HTML for the card body.
 * All dynamic strings pass through esc(). Interactions are wired in app.js
 * via event delegation (data-action attributes).
 */
(function (root) {
  "use strict";

  var SILHOUETTE = "https://jsierrahoopshype.github.io/nba-headshots/fallbacks/player_silhouette.svg";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function escAttr(s) { return esc(s); }

  function face(src, alt, cls) {
    return '<img class="' + (cls || "face") + '" loading="lazy" src="' + escAttr(src || SILHOUETTE) +
      '" alt="' + escAttr(alt || "") + '" onerror="this.onerror=null;this.src=\'' + SILHOUETTE + '\'">';
  }

  var TYPE_META = {
    trade:  { chip: "TRADE",   cls: "t-trade" },
    rumor:  { chip: "RUMOR",   cls: "t-rumor" },
    vs:     { chip: "VS",      cls: "t-vs" },
    trivia: { chip: "TRIVIA",  cls: "t-vs" },
    quiz:   { chip: "QUIZ",    cls: "t-quiz" },
    ballot: { chip: "BALLOT",  cls: "t-quiz" },
    salary: { chip: "VAULT",   cls: "t-vault" },
    otd:    { chip: "ON THIS DAY", cls: "t-vault" },
    race:   { chip: "RACE",    cls: "t-vault" }
  };

  /* ---------------- renderers ---------------- */

  function renderTrade(c) {
    var p = c.payload;
    var sides = p.sides.map(function (s) {
      var players = s.gets.map(function (pl) {
        return '<div class="trade-player">' + face(pl.img, pl.name) +
          '<div class="tp-text"><span class="tp-name">' + esc(pl.name) + '</span>' +
          '<span class="tp-sal mono">$' + esc(pl.salary) + 'M</span></div></div>';
      }).join("");
      return '<div class="trade-side">' +
        '<div class="trade-side-head"><img class="team-logo" loading="lazy" src="' + escAttr(s.logo) + '" alt="">' +
        '<span class="trade-team">' + esc(s.team) + ' get</span></div>' + players + '</div>';
    }).join('<div class="trade-arrows" aria-hidden="true">&#8646;</div>');
    var balCls = p.balance_pct >= 95 ? "ok" : p.balance_pct >= 85 ? "warn" : "bad";
    return '<div class="trade-grid">' + sides + '</div>' +
      '<div class="trade-verdict ' + balCls + '"><span class="mono">' + esc(p.balance_pct) + '% balanced</span> — ' +
      esc(p.verdict) + '</div>' +
      '<div class="card-sub">Built by a Trade Machine user ' + esc(p.built_ago || "recently") + '</div>';
  }

  function renderRumor(c) {
    var p = c.payload;
    var head = p.on_this_day
      ? '<div class="rumor-otd mono">' + esc(p.years_ago) + ' year' + (p.years_ago === 1 ? "" : "s") + ' ago today</div>'
      : "";
    var quote = p.quote ? '<blockquote class="rumor-quote">&ldquo;' + esc(p.quote) + '&rdquo;</blockquote>' : "";
    return head +
      '<p class="rumor-text">' + esc(p.text) + '</p>' + quote +
      '<div class="card-sub">' + esc(p.outlet) + ' · <span class="mono">' + esc(p.archive_date) + '</span></div>';
  }

  function renderVs(c) {
    var p = c.payload;
    var rows = (p.sections || []).map(function (s) {
      var w1 = s.p1 >= s.p2;
      return '<div class="vs-row"><span class="vs-cat">' + esc(s.label) + '</span>' +
        '<span class="vs-nums mono"><b class="' + (w1 ? "win" : "") + '">' + esc(s.p1) + '</b>' +
        '<span class="vs-dash">–</span><b class="' + (!w1 ? "win" : "") + '">' + esc(s.p2) + '</b></span></div>';
    }).join("");
    var wins = (p.biggest_wins || []).map(function (w) {
      var who = w.who === "p1" ? p.p1.name : p.p2.name;
      return '<div class="vs-bigwin"><span class="vs-bigwin-name">' + esc(who) + '</span> ' +
        esc(w.stat) + ' <span class="mono">' + esc(w.val) + '</span></div>';
    }).join("");
    return '<div class="vs-head">' +
      '<div class="vs-player">' + face(p.p1.img, p.p1.name, "face lg") + '<span>' + esc(p.p1.name) + '</span>' +
      '<b class="vs-score mono">' + esc(p.p1.score) + '</b></div>' +
      '<div class="vs-mid">VS</div>' +
      '<div class="vs-player">' + face(p.p2.img, p.p2.name, "face lg") + '<span>' + esc(p.p2.name) + '</span>' +
      '<b class="vs-score mono">' + esc(p.p2.score) + '</b></div></div>' +
      '<div class="vs-headline">' + esc(p.headline) + '</div>' +
      '<div class="vs-rows">' + rows + '</div>' + wins;
  }

  function renderTrivia(c) {
    var p = c.payload;
    function opt(key, pl) {
      return '<button class="trivia-opt" data-action="trivia" data-pick="' + key + '">' +
        face(pl.img, pl.name) + '<span>' + esc(pl.name) + '</span>' +
        '<span class="trivia-val mono" data-val="' + key + '">' + Number(pl.value).toLocaleString("en-US") + '</span>' +
        '</button>';
    }
    return '<div class="trivia-q">' + esc(p.question) + '</div>' +
      '<div class="trivia-opts" data-answer="' + escAttr(p.answer) + '">' +
      opt("a", p.a) + opt("b", p.b) + '</div>' +
      '<div class="quiz-result" hidden></div>';
  }

  function renderQuiz(c) {
    var p = c.payload;
    var opts = p.options.map(function (o) {
      return '<button class="quiz-opt" data-action="quiz" data-pick="' + escAttr(o) + '">' + esc(o) + '</button>';
    }).join("");
    return '<div class="quiz-diff mono ' + esc(p.difficulty) + '">' + esc(p.difficulty) + '</div>' +
      '<div class="quiz-sil-wrap" data-action="reveal">' + face(p.img, "Mystery player", "quiz-sil") +
      '<span class="quiz-sil-hint">who is this?</span></div>' +
      '<div class="quiz-opts" data-answer="' + escAttr(p.answer) + '">' + opts + '</div>' +
      '<div class="quiz-result" hidden></div>';
  }

  function renderBallot(c) {
    var p = c.payload;
    var opts = p.options.map(function (o, i) {
      return '<button class="quiz-opt" data-action="ballot" data-pick="' + i + '">' + esc(o) + '</button>';
    }).join("");
    return '<div class="quiz-diff mono">' + esc(p.season || "") + '</div>' +
      '<div class="trivia-q">' + esc(p.question) + '</div>' +
      '<div class="quiz-opts" data-answer-idx="' + escAttr(p.answer_idx) + '">' + opts + '</div>' +
      '<div class="quiz-result" hidden></div>';
  }

  function renderSalary(c) {
    var p = c.payload;
    return '<div class="sal-head">' + face(p.img, p.player, "face lg") +
      '<div><div class="sal-name">' + esc(p.player) + '</div>' +
      '<div class="card-sub">' + esc(p.team) + ' · <span class="mono">' + esc(p.year) + '</span></div></div></div>' +
      '<div class="sal-line">made <b class="mono">' + esc(p.salary) + '</b>' +
      '<span class="sal-today">that&rsquo;s <b class="mono">' + esc(p.today) + '</b> today</span></div>' +
      '<p class="rumor-text">' + esc(p.blurb) + '</p>';
  }

  function renderOtd(c) {
    var p = c.payload;
    var homeWin = p.home_score > p.away_score;
    return '<div class="otd-label mono">' + esc(p.year) + ' · ' + esc(p.label) + '</div>' +
      '<div class="otd-score">' +
      '<div class="otd-team"><img class="team-logo lg" loading="lazy" src="' + escAttr(p.away_logo) + '" alt="">' +
      '<span>' + esc(p.away) + '</span><b class="mono ' + (!homeWin ? "win" : "") + '">' + esc(p.away_score) + '</b></div>' +
      '<div class="otd-at mono">@</div>' +
      '<div class="otd-team"><img class="team-logo lg" loading="lazy" src="' + escAttr(p.home_logo) + '" alt="">' +
      '<span>' + esc(p.home) + '</span><b class="mono ' + (homeWin ? "win" : "") + '">' + esc(p.home_score) + '</b></div>' +
      '</div>' +
      '<p class="rumor-text">' + esc(p.story) + '</p>' +
      '<div class="card-sub">' + esc(p.arena) + '</div>';
  }

  function renderRace(c) {
    var p = c.payload;
    var media = p.mp4
      ? '<video class="race-video" src="' + escAttr(p.mp4) + '" muted loop playsinline autoplay></video>'
      : '<div class="race-placeholder"><span class="mono">MP4 pending</span><p>' + esc(p.note || "") + '</p></div>';
    return '<div class="vs-headline">' + esc(p.title) + '</div>' + media;
  }

  var RENDERERS = {
    trade: renderTrade, rumor: renderRumor, vs: renderVs, trivia: renderTrivia,
    quiz: renderQuiz, ballot: renderBallot, salary: renderSalary, otd: renderOtd, race: renderRace
  };

  /* ---------------- card frame ---------------- */

  function tapTarget(c) {
    // Where tap-through goes, per type. Dummy-safe defaults for step 2.
    switch (c.type) {
      case "trade": return { url: "https://hoopsmatic.com/transactionmaster", label: "Open Trade Machine" };
      case "rumor": return { url: c.payload.source_url || "https://hoopshype.com/rumors/", label: "Read on HoopsHype" };
      case "vs":    return { url: c.payload.compare_url, label: "Full comparison" };
      case "salary": return { url: "https://hoopsmatic.com/salary-season-finder", label: "Salary Season Finder" };
      case "race":  return { url: "https://hoopsmatic.com", label: "HoopsMatic tools" };
      default: return null;
    }
  }

  function render(c) {
    var meta = TYPE_META[c.type] || { chip: c.type, cls: "" };
    var body = (RENDERERS[c.type] || function () { return ""; })(c);
    var tap = tapTarget(c);
    var tapBtn = tap && tap.url
      ? '<a class="act tap" data-action="tap" href="' + escAttr(tap.url) + '" target="_blank" rel="noopener">' +
        esc(tap.label) + ' <span aria-hidden="true">&#8599;</span></a>'
      : "";
    return '<article class="card ' + meta.cls + '" data-id="' + escAttr(c.id) + '" tabindex="-1">' +
      '<header class="card-head"><span class="chip">' + esc(meta.chip) + '</span>' +
      (c.dummy ? '<span class="chip dummy">SAMPLE</span>' : "") +
      '</header>' +
      '<div class="card-body">' + body + '</div>' +
      '<footer class="card-actions">' +
      '<button class="act like" data-action="like" aria-label="Like"><span class="ico">&#9829;</span><span class="act-label">Like</span></button>' +
      '<button class="act save" data-action="save" aria-label="Save"><span class="ico">&#9873;</span><span class="act-label">Save</span></button>' +
      '<button class="act share" data-action="share" aria-label="Share"><span class="ico">&#8631;</span><span class="act-label">Share</span></button>' +
      tapBtn +
      '</footer></article>';
  }

  root.DoomCards = { render: render, esc: esc };
})(window);
