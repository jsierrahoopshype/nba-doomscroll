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

  /* A player name or team that filters the whole feed to that entity when
   * tapped. Rendered as a button so it is reachable by keyboard and announced
   * as interactive; app.js reads data-entity / data-entity-kind. */
  /* `label` overrides what is printed without changing what is filtered on: a
   * card that has room for "Cleveland Cavaliers" should not print CLE just
   * because the filter value is an abbreviation. */
  function ent(name, kind, cls, label) {
    if (!name) return "";
    return '<button class="ent" type="button" data-entity="' + escAttr(name) +
      '" data-entity-kind="' + escAttr(kind) + '"' +
      (cls ? ' data-cls="' + escAttr(cls) + '"' : "") +
      ' title="Show everything about ' + escAttr(label || name) + '">' +
      esc(label || name) + '</button>';
  }

  /* Cards carry team abbreviations because that is what the data files use.
   * Lives here rather than in app.js so both the cards and the filter bar read
   * one list. Current franchises only; anything else prints as-is. */
  var TEAM_NAME = {
    ATL: "Atlanta Hawks", BOS: "Boston Celtics", BKN: "Brooklyn Nets",
    CHA: "Charlotte Hornets", CHI: "Chicago Bulls", CLE: "Cleveland Cavaliers",
    DAL: "Dallas Mavericks", DEN: "Denver Nuggets", DET: "Detroit Pistons",
    GSW: "Golden State Warriors", HOU: "Houston Rockets", IND: "Indiana Pacers",
    LAC: "LA Clippers", LAL: "Los Angeles Lakers", MEM: "Memphis Grizzlies",
    MIA: "Miami Heat", MIL: "Milwaukee Bucks", MIN: "Minnesota Timberwolves",
    NOP: "New Orleans Pelicans", NYK: "New York Knicks",
    OKC: "Oklahoma City Thunder", ORL: "Orlando Magic",
    PHI: "Philadelphia 76ers", PHX: "Phoenix Suns", POR: "Portland Trail Blazers",
    SAC: "Sacramento Kings", SAS: "San Antonio Spurs", TOR: "Toronto Raptors",
    UTA: "Utah Jazz", WAS: "Washington Wizards"
  };

  function logo(src, name, cls) {
    if (!src) return '<span class="team-logo lg logo-none" title="' + escAttr(name || "") + '"></span>';
    return '<img class="' + (cls || "team-logo lg") + '" loading="lazy" src="' + escAttr(src) +
      '" alt="" onerror="this.style.visibility=\'hidden\'">';
  }

  /* `tab` is where the chip takes you when tapped. A card announcing itself as
   * BALLOT ODDITY that could not take you to the section holding ballot
   * oddities was a dead label. */
  var TYPE_META = {
    trade:  { chip: "TRADE",   cls: "t-trade", tab: "trades" },
    rumor:  { chip: "RUMOR",   cls: "t-rumor", tab: "rumors" },
    vs:     { chip: "VS",      cls: "t-vs",    tab: "vs" },
    trivia: { chip: "TRIVIA",  cls: "t-vs",    tab: "quiz" },
    quiz:   { chip: "QUIZ",    cls: "t-quiz",  tab: "quiz" },
    ballot: { chip: "BALLOT",  cls: "t-quiz",  tab: "quiz" },
    salary: { chip: "SALARY",  cls: "t-vault", tab: "vault" },
    oddity: { chip: "BALLOT ODDITY", cls: "t-vault", tab: "vault" },
    otd:    { chip: "ON THIS DAY", cls: "t-vault", tab: "vault" },
    race:   { chip: "RACE",    cls: "t-vault", tab: "races" },
    buzz:   { chip: "BUZZ",    cls: "t-buzz",  tab: "buzz" }
  };

  /* ---------------- renderers ---------------- */

  function renderTrade(c) {
    var p = c.payload;
    var sides = p.sides.map(function (s) {
      var players = s.gets.map(function (pl) {
        return '<div class="trade-player">' + face(pl.img, pl.name) +
          '<div class="tp-text"><span class="tp-name">' + ent(pl.name, "player") + '</span>' +
          '<span class="tp-sal mono">$' + esc(pl.salary) + 'M</span></div></div>';
      }).join("");
      return '<div class="trade-side">' +
        '<div class="trade-side-head"><img class="team-logo" loading="lazy" src="' + escAttr(s.logo) + '" alt="">' +
        '<span class="trade-team">' + ent(s.team, "team") + ' get</span></div>' + players + '</div>';
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
      '<div class="vs-player">' + face(p.p1.img, p.p1.name, "face lg") + '<span>' + ent(p.p1.name, "player") + '</span>' +
      '<b class="vs-score mono">' + esc(p.p1.score) + '</b></div>' +
      '<div class="vs-mid">VS</div>' +
      '<div class="vs-player">' + face(p.p2.img, p.p2.name, "face lg") + '<span>' + ent(p.p2.name, "player") + '</span>' +
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
    // Hints are revealed one at a time rather than all at once: a single hint
    // was either useless or handed over the answer. Older cached cards only
    // carry the one `hint` string, so fall back to it.
    var hints = p.hints && p.hints.length ? p.hints : (p.hint ? [p.hint] : []);
    var hintUi = hints.length
      ? '<div class="quiz-hints" data-hints="' + escAttr(JSON.stringify(hints)) + '" data-shown="0">' +
          '<button class="quiz-hint-btn" type="button" data-action="hint">Need a hint?</button>' +
          '<ol class="quiz-hint-list"></ol>' +
        '</div>'
      : "";
    return '<div class="quiz-diff mono ' + esc(p.difficulty) + '">' + esc(p.difficulty) + '</div>' +
      '<div class="quiz-sil-wrap" data-action="reveal">' + face(p.img, "Mystery player", "quiz-sil") +
      '<span class="quiz-sil-hint">who is this?</span></div>' +
      hintUi +
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
      '<div><div class="sal-name">' + ent(p.player, "player") + '</div>' +
      '<div class="card-sub">' + ent(p.team, "team") + ' · <span class="mono">' + esc(p.season) + '</span></div></div></div>' +
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
    return '<div class="otd-label mono">' +
      (p.approx ? "Around this date in " + esc(p.year) : esc(p.year)) +
      ' · ' + esc(p.label) + '</div>' +
      '<div class="otd-score">' +
      '<div class="otd-team">' + logo(p.away_logo, p.away_name) +
      '<span>' + ent(p.away, "team") + '</span><b class="mono ' + (!homeWin ? "win" : "") + '">' + esc(p.away_score) + '</b></div>' +
      '<div class="otd-at mono">@</div>' +
      '<div class="otd-team">' + logo(p.home_logo, p.home_name) +
      '<span>' + ent(p.home, "team") + '</span><b class="mono ' + (homeWin ? "win" : "") + '">' + esc(p.home_score) + '</b></div>' +
      '</div>' +
      '<p class="rumor-text otd-story">' + esc(p.story) + '</p>' +
      (bits.length ? '<div class="card-sub">' + bits.join(" · ") + '</div>' : "");
  }

  function renderRace(c) {
    var p = c.payload;
    // The race is drawn on a canvas by js/race-player.js, not played as video.
    // app.js loads the race JSON and mounts a player when the card scrolls into
    // view, so a feed of race cards downloads only the ones actually watched —
    // the same contract the old <video preload="none"> had, at ~11KB a race
    // instead of ~2MB a clip.
    if (!p.file) {
      return '<div class="vs-headline race-title">' + esc(p.title || "Bar chart race") + '</div>' +
        '<div class="race-placeholder"><span class="mono">race pending</span><p>' +
        esc(p.note || "Run tools/build_races.mjs to generate this race.") + '</p></div>';
    }
    var alt = p.title + ", " + (p.span || "") +
      (p.leader ? ". Finishing leader: " + p.leader + "." : ".");
    return '<div class="vs-headline race-title">' + esc(p.title) + '</div>' +
      '<div class="card-sub race-sub">' + esc(p.subtitle || "") +
        (p.span ? ' · <span class="mono">' + esc(p.span) + '</span>' : "") + '</div>' +
      '<div class="race-wrap">' +
        '<canvas class="race-canvas" data-race="' + escAttr(p.file) + '" role="img" aria-label="' +
          escAttr(alt) + '"></canvas>' +
        '<div class="race-status mono" data-race-status>loading race…</div>' +
      '</div>' +
      '<div class="race-bar">' +
        '<button class="race-btn" type="button" data-race-toggle aria-label="Play or pause the race">Play</button>' +
        '<input class="race-scrub" type="range" min="0" max="1000" value="0" step="1" ' +
          'data-race-scrub aria-label="Scrub through the seasons">' +
        '<button class="race-btn race-speed" type="button" data-race-speed ' +
          'aria-label="Playback speed">1&times;</button>' +
      '</div>' +
      (p.note ? '<p class="race-note">' + esc(p.note) + '</p>' : "");
  }

  /* "4h ago" beats a timestamp on a card whose whole point is recency. Computed
   * at render time, not at load time, because a tab left open for an hour would
   * otherwise keep claiming its cards are a minute old. */
  function ago(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return "";
    var mins = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + "h ago";
    var days = Math.round(hrs / 24);
    return days + "d ago";
  }

  function renderBuzz(c) {
    var p = c.payload;
    // The thumbnail is a third-party image on a third-party host. If it 404s or
    // is blocked, the card still reads — the headline is the card.
    var thumb = p.thumbnail
      ? '<div class="buzz-thumb' + (p.is_video ? " is-video" : "") + '">' +
        '<img loading="lazy" src="' + escAttr(p.thumbnail) + '" alt="" ' +
        'onerror="this.closest(\'.buzz-thumb\').remove()">' +
        (p.is_video ? '<span class="buzz-play" aria-hidden="true">&#9654;</span>' : "") +
        '</div>'
      : "";
    var ents = (p.teams || []).map(function (t) { return ent(t, "team", "", TEAM_NAME[t] || t); })
      .concat((p.players || []).map(function (n) { return ent(n, "player"); }));
    var when = ago(p.published_at);
    return '<div class="buzz-meta mono">' +
        '<span class="buzz-src">' + esc(p.source_label) + '</span>' +
        (p.trending ? '<span class="buzz-hot">TRENDING</span>' : "") +
        (when ? '<span class="buzz-time">' + esc(when) + '</span>' : "") +
      '</div>' +
      thumb +
      '<h3 class="buzz-title">' + esc(p.title) + '</h3>' +
      (p.excerpt ? '<p class="buzz-excerpt">' + esc(p.excerpt) + '</p>' : "") +
      (ents.length ? '<div class="buzz-ents">' + ents.join("") + '</div>' : "") +
      (p.author ? '<div class="card-sub">' + esc(p.author) + '</div>' : "");
  }

  var RENDERERS = {
    trade: renderTrade, rumor: renderRumor, vs: renderVs, trivia: renderTrivia,
    quiz: renderQuiz, ballot: renderBallot, salary: renderSalary, otd: renderOtd,
    race: renderRace, oddity: renderOddity, buzz: renderBuzz
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
      // No tap-through. The race IS the destination; sending someone to the
      // HoopsMatic homepage from it added nothing.
      case "race":  return null;
      // The item lives somewhere else and that is the point: Buzz is a pointer
      // to the source, never a replacement for it.
      case "buzz":  return { url: c.payload.url, label: c.payload.cta || "Open" };
      default: return null;
    }
  }

  function render(c) {
    var meta = TYPE_META[c.type] || { chip: c.type, cls: "" };
    if (c.type === "otd" && c.payload && c.payload.approx) {
      meta = { chip: "AROUND THIS DATE", cls: meta.cls, tab: meta.tab };
    }
    var body = (RENDERERS[c.type] || function () { return ""; })(c);
    var tap = tapTarget(c);
    var tapBtn = tap && tap.url
      ? '<a class="act tap" data-action="tap" href="' + escAttr(tap.url) + '" target="_blank" rel="noopener">' +
        esc(tap.label) + ' <span aria-hidden="true">&#8599;</span></a>'
      : "";
    var chipHtml = meta.tab
      ? '<button class="chip chip-link" type="button" data-goto="' + escAttr(meta.tab) +
        '" title="Show the ' + escAttr(meta.chip.toLowerCase()) + ' section">' + esc(meta.chip) + '</button>'
      : '<span class="chip">' + esc(meta.chip) + '</span>';
    return '<article class="card ' + meta.cls + '" data-id="' + escAttr(c.id) + '" tabindex="-1">' +
      '<header class="card-head">' + chipHtml +
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

  root.DoomCards = {
    ent: ent, render: render, esc: esc, TEAM_NAME: TEAM_NAME };
})(window);
