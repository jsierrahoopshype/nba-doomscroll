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

  function logo(src, name, cls) {
    if (!src) return '<span class="team-logo lg logo-none" title="' + escAttr(name || "") + '"></span>';
    return '<img class="' + (cls || "team-logo lg") + '" loading="lazy" src="' + escAttr(src) +
      '" alt="" onerror="this.style.visibility=\'hidden\'">';
  }

  var TYPE_META = {
    trade:  { chip: "TRADE",   cls: "t-trade" },
    rumor:  { chip: "RUMOR",   cls: "t-rumor" },
    vs:     { chip: "VS",      cls: "t-vs" },
    trivia: { chip: "TRIVIA",  cls: "t-vs" },
    quiz:   { chip: "QUIZ",    cls: "t-quiz" },
    ballot: { chip: "BALLOT",  cls: "t-quiz" },
    salary: { chip: "VAULT",   cls: "t-vault" },
    oddity: { chip: "BALLOT ODDITY", cls: "t-vault" },
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
    // Cap share rather than a CPI "worth $Y today" figure: it comes straight
    // from the same salary data plus the cap table, so nothing is estimated.
    var pctLine = p.bargain
      ? '<span class="sal-today">just <b class="mono">' + esc(p.cap_pct) + '%</b> of that season&rsquo;s cap</span>'
      : '<span class="sal-today"><b class="mono">' + esc(p.cap_pct) + '%</b> of the entire salary cap</span>';
    return '<div class="sal-head">' + face(p.img, p.player, "face lg") +
      '<div><div class="sal-name">' + esc(p.player) + '</div>' +
      '<div class="card-sub">' + esc(p.team) + ' · <span class="mono">' + esc(p.season) + '</span></div></div></div>' +
      '<div class="sal-line">made <b class="mono">' + esc(p.salary) + '</b>' + pctLine + '</div>' +
      (p.note ? '<p class="rumor-text sal-note">' + esc(p.note) + '</p>' : "") +
      '<div class="card-sub">Cap that season: <span class="mono">' + esc(p.cap) + '</span></div>';
  }

  function renderOddity(c) {
    var p = c.payload;
    return '<div class="quiz-diff mono">' + esc(p.season) + ' · ' + esc(p.award) + '</div>' +
      '<div class="trivia-q">' + esc(p.headline) + '</div>' +
      '<p class="oddity-detail">' + esc(p.detail) + '</p>' +
      '<div class="card-sub">' + esc(p.scope) + '</div>';
  }

  function renderOtd(c) {
    var p = c.payload;
    var homeWin = p.home_score > p.away_score;
    // arena + attendance exist only on the 2024-25 and 2025-26 rows of the
    // source data, so the sub-line is built from whatever is actually there.
    var bits = [];
    if (p.arena) bits.push(esc(p.arena));
    if (p.attendance) bits.push('<span class="mono">' + esc(p.attendance) + '</span> in the building');
    return '<div class="otd-label mono">' + esc(p.year) + ' · ' + esc(p.label) + '</div>' +
      '<div class="otd-score">' +
      '<div class="otd-team">' + logo(p.away_logo, p.away_name) +
      '<span>' + esc(p.away) + '</span><b class="mono ' + (!homeWin ? "win" : "") + '">' + esc(p.away_score) + '</b></div>' +
      '<div class="otd-at mono">@</div>' +
      '<div class="otd-team">' + logo(p.home_logo, p.home_name) +
      '<span>' + esc(p.home) + '</span><b class="mono ' + (homeWin ? "win" : "") + '">' + esc(p.home_score) + '</b></div>' +
      '</div>' +
      '<p class="rumor-text otd-story">' + esc(p.story) + '</p>' +
      (bits.length ? '<div class="card-sub">' + bits.join(" · ") + '</div>' : "");
  }

  function renderRace(c) {
    var p = c.payload;
    // Muted, looping and autoplaying: a feed card should never make noise, and
    // playsinline keeps iOS from taking over the screen.
    // No autoplay attribute and preload="none": app.js starts a clip when it
    // scrolls into view and pauses it when it leaves, so a feed with a dozen
    // clips downloads only the one being watched.
    var media = p.mp4
      ? '<video class="race-video" src="' + escAttr(p.mp4) + '" muted loop playsinline preload="none"></video>'
      : '<div class="race-placeholder"><span class="mono">clip pending</span><p>' + esc(p.note || "") + '</p></div>';
    return '<div class="vs-headline race-title">' + esc(p.title) + '</div>' +
      (p.subtitle ? '<div class="card-sub race-sub">' + esc(p.subtitle) +
        (p.span ? ' · <span class="mono">' + esc(p.span) + '</span>' : "") + '</div>' : "") +
      media;
  }

  var RENDERERS = {
    trade: renderTrade, rumor: renderRumor, vs: renderVs, trivia: renderTrivia,
    quiz: renderQuiz, ballot: renderBallot, salary: renderSalary, otd: renderOtd,
    race: renderRace, oddity: renderOddity
  };

  /* ---------------- card frame ---------------- */

  function tapTarget(c) {
    // Where tap-through goes, per type. Dummy-safe defaults for step 2.
    switch (c.type) {
      case "trade": return { url: "https://hoopsmatic.com/transactionmaster", label: "Open Trade Machine" };
      case "rumor": return { url: c.payload.source_url || "https://hoopshype.com/rumors/", label: "Read on HoopsHype" };
      case "vs":    return { url: c.payload.compare_url, label: "Full comparison" };
      case "salary": return { url: "https://hoopsmatic.com/salary-season-finder", label: "Salary Season Finder" };
      case "oddity": return { url: "https://jsierrahoopshype.github.io/media-vote-tracker/", label: "Media Vote Tracker" };
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
      (c.live ? '<span class="chip live">LIVE</span>' : "") +
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
