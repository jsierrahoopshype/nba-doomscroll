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

  /* No photograph draws initials, not the generic silhouette.
   *
   * The VS, quiz and trivia pools are now built only from players who have one,
   * so nothing there reaches this branch. Trade and History cards can: a trade
   * card is whatever a reader traded, and a 1950s salary record is nobody the
   * NBA's CDN ever photographed. A grey outline of nobody is worse than useless
   * on those — two initials at least say who this is — which is the same call
   * the Teammates scoreboard already makes below.
   *
   * The onerror path keeps the silhouette: an image that was supposed to load
   * and did not is a different thing from a player with no photograph, and
   * swapping in initials there would quietly hide a broken source. */
  function face(src, alt, cls) {
    if (!src || src === SILHOUETTE) {
      return '<span class="' + (cls || "face") + ' mt-ini" title="' + escAttr(alt || "") + '">' +
        esc(initials(alt)) + '</span>';
    }
    return '<img class="' + (cls || "face") + '" loading="lazy" src="' + escAttr(src) +
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
    buzz:   { chip: "BUZZ",    cls: "t-buzz",  tab: "buzz" },
    tradetrend: { chip: "TRADE TRENDS", cls: "t-trade", tab: "trades" },
    tradedigest: { chip: "DAILY DIGEST", cls: "t-trade", tab: "trades" },
    mates:  { chip: "TEAMMATES", cls: "t-vs", tab: "vs" },
    compare: { chip: "HEAD TO HEAD", cls: "t-vs", tab: "vs" },
    lean:   { chip: "MEDIA LEAN", cls: "t-quiz", tab: "vault" }
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

  /* Who the Trade Machine is moving. A leaderboard of players by how many
   * distinct deals people built around them, with where those deals sent them.
   * Every row opens the machine's trade-loop generator for that player. */
  function renderTradeTrend(c) {
    var p = c.payload;
    var rows = (p.players || []).map(function (pl, i) {
      var dests = (pl.dests || []).map(function (d) {
        return '<span class="tt-dest">' + ent(d.team, "team") +
          '<span class="tt-dest-n mono">' + d.n + '</span></span>';
      }).join("");
      return '<a class="tt-row" href="' + escAttr(pl.url) + '" target="_blank" rel="noopener">' +
        '<span class="tt-rank mono">' + (i + 1) + '</span>' +
        face(pl.img, pl.name) +
        '<span class="tt-main">' +
          '<span class="tt-name">' + esc(pl.name) + '</span>' +
          '<span class="tt-dests">' + (dests || '<span class="tt-dest-none">no clear destination</span>') + '</span>' +
        '</span>' +
        '<span class="tt-builds mono"><b>' + pl.builds + '</b>' +
          '<span>build' + (pl.builds === 1 ? "" : "s") + '</span></span>' +
      '</a>';
    }).join("");
    return '<div class="vs-headline">' + esc(p.headline) + '</div>' +
      '<div class="card-sub">Across <span class="mono">' + esc(String(p.deals)) +
        '</span> trades readers built ' + esc(p.span) + ' · the number is how many of them included that player</div>' +
      '<div class="tt-list">' + rows + '</div>';
  }

  /* The Trade Machine's own daily digest — the same numbers, from the same
   * endpoint, as the card that goes out on social. Computed server-side over
   * the whole log, which is why it can say "the last 24 hours" and mean it. */
  function renderTradeDigest(c) {
    var p = c.payload;
    /* Every row is a link that builds the trade it describes: a destination
     * row opens the machine with him already on his way there, a return-piece
     * row opens it with both players in. Nothing here asks the reader to type
     * a name into a search box. */
    function bars(list, kind) {
      var top = list[0] ? list[0].pct : 100;
      return list.map(function (x) {
        var w = Math.max(6, Math.round(x.pct / (top || 1) * 100));
        return '<a class="td-row" href="' + escAttr(x.url) + '" target="_blank" rel="noopener" ' +
          'title="' + escAttr(kind === "dest"
            ? "Build " + p.player + " to " + x.name + " in the Trade Machine"
            : "Build " + p.player + " for " + x.name + " in the Trade Machine") + '">' +
          '<span class="td-fill" style="width:' + w + '%"></span>' +
          (kind === "dest"
            ? '<img class="team-logo" loading="lazy" src="' + escAttr(x.logo) + '" alt="" ' +
              'onerror="this.style.visibility=\'hidden\'">'
            : face(x.img, x.name)) +
          '<span class="td-name">' + esc(x.name) + '</span>' +
          '<span class="td-pct mono">' + esc(x.pct.toFixed(1)) + '%</span>' +
        '</a>';
      }).join("");
    }
    var rank = p.rank || 1;
    return '<div class="td-rank mono">No. ' + esc(String(rank)) +
        ' most-traded player · ' + esc(p.period) + '</div>' +
      '<div class="td-hero">' + face(p.img, p.player, "face lg") +
      '<div class="td-hero-text">' +
        '<div class="td-name-big">' + ent(p.player, "player") + '</div>' +
        '<div class="td-share"><b class="mono">' + esc(p.share.toFixed(1)) + '%</b>' +
          ' of every trade built in ' + esc(p.period) + '</div>' +
      '</div></div>' +
      (p.dests.length ? '<div class="td-label mono">Most common destinations</div>' +
        '<div class="td-list">' + bars(p.dests, "dest") + '</div>' : "") +
      (p.back.length ? '<div class="td-label mono">Most traded for</div>' +
        '<div class="td-list">' + bars(p.back, "back") + '</div>' : "");
  }

  /* Teammates Score: who had the better help, season by season. The canvas is
   * mounted by app.js when the card scrolls into view — same lifecycle as a bar
   * chart race, same controls — so the ~6KB of season detail is only fetched
   * for a matchup somebody actually looks at. */
  function renderMates(c) {
    var p = c.payload;
    /* Initials rather than the generic silhouette when a player has no face
     * tile. 30 of the players here have only an NBA-CDN placeholder upstream,
     * which is a grey outline of nobody; two initials at least say who this is,
     * and it matches what the canvas draws two inches below. */
    function side(x, cls) {
      var head = x.img
        ? face(x.img, x.name, "face lg")
        : '<span class="face lg mt-ini" aria-hidden="true">' +
          esc(x.name.split(/\s+/).map(function (w) { return w[0] || ""; }).join("").slice(0, 2).toUpperCase()) +
          '</span>';
      return '<div class="mt-side ' + cls + '">' + head +
        '<span class="mt-name">' + ent(x.name, "player") + '</span>' +
        '<b class="mt-score mono">' + esc(String(x.score)) + '</b>' +
        '<span class="mt-sub mono">' + esc(x.span) + ' · ' + esc(String(x.seasons)) + ' seasons</span>' +
      '</div>';
    }
    var alt = p.a.name + " " + p.a.score + ", " + p.b.name + " " + p.b.score +
      ". Teammate accolade score, season by season.";
    return '<div class="vs-headline">' + esc(p.headline) + '</div>' +
      '<div class="mt-head">' + side(p.a, "a") + '<div class="vs-mid">VS</div>' + side(p.b, "b") + '</div>' +
      '<div class="card-sub mt-verdict">' + ent(p.lead, "player") + ' had the better help by ' +
        '<span class="mono">' + esc(String(p.gap)) + '</span></div>' +
      '<div class="race-wrap">' +
        '<canvas class="race-canvas" data-player="mates" data-race="' + escAttr(p.file) +
          '" role="img" aria-label="' + escAttr(alt) + '"></canvas>' +
        '<div class="race-status mono" data-race-status>loading the seasons…</div>' +
      '</div>' +
      '<div class="race-bar">' +
        '<button class="race-btn" type="button" data-race-toggle aria-label="Play or pause">Play</button>' +
        '<input class="race-scrub" type="range" min="0" max="1000" value="0" step="1" ' +
          'data-race-scrub aria-label="Scrub through the seasons">' +
        '<button class="race-btn race-speed" type="button" data-race-speed ' +
          'aria-label="Playback speed">1&times;</button>' +
      '</div>' +
      '<p class="race-note">' + esc(p.note) + '</p>';
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

  /* Head to head: the VS scoreline being built rather than declared. The canvas
   * is mounted lazily by app.js when the card reaches the viewport, so a feed
   * full of these downloads only the rows of the ones actually looked at. The
   * markup above it stands on its own if the canvas never loads. */
  function renderCompare(c) {
    var p = c.payload;
    /* No headline and no static scores, unlike the VS card. "Tyson Chandler
     * takes it 38-35" printed above a ten-second reveal of how he got there
     * gives away the only thing the card has to say. The scoreboard inside the
     * canvas is where the numbers live; out here it is just who is playing. */
    function side(x, cls) {
      return '<div class="mt-side ' + cls + '">' + face(x.img, x.name, "face lg") +
        '<span class="mt-name">' + ent(x.name, "player") + '</span></div>';
    }
    var alt = p.a.name + " " + p.a.score + ", " + p.b.name + " " + p.b.score +
      ". The comparison scored one metric at a time.";
    return '<div class="mt-head">' + side(p.a, "a") + '<div class="vs-mid">VS</div>' + side(p.b, "b") + '</div>' +
      '<div class="card-sub cmp-tease">' + esc(String(p.metrics)) +
        ' metrics, one at a time. Who wins?</div>' +
      '<div class="race-wrap">' +
        '<canvas class="race-canvas" data-player="compare" data-race="' + escAttr(p.file) +
          '" role="img" aria-label="' + escAttr(alt) + '"></canvas>' +
        '<div class="race-status mono" data-race-status>loading the metrics…</div>' +
      '</div>' +
      '<div class="race-bar">' +
        '<button class="race-btn" type="button" data-race-toggle aria-label="Play or pause">Play</button>' +
        '<input class="race-scrub" type="range" min="0" max="1000" value="0" step="1" ' +
          'data-race-scrub aria-label="Scrub through the metrics">' +
        '<button class="race-btn race-speed" type="button" data-race-speed ' +
          'aria-label="Playback speed">1&times;</button>' +
      '</div>' +
      '<p class="race-note">' + esc(p.note) + '</p>';
  }

  /* Who in the media is high on a player, and who is low: a port of the
   * HoopsHype media-vote video, three acts on a canvas.
   *
   * The one card in the app that is about the voters rather than the players,
   * so it prints real journalists' names against a number. The note under it
   * says what the number is — an average gap against the rest of the panel —
   * because a bare "-5.1" beside a byline invites a reading it has not earned. */
  function renderLean(c) {
    var p = c.payload;
    var a0 = (p.acts && p.acts[0]) || { hi: [], lo: [] };
    var alt = p.player + ": " +
      (a0.hi || []).slice(0, 3).map(function (r) { return r.label + " " + (r.diff > 0 ? "+" : "") + r.diff; }).join(", ") +
      " highest; " +
      (a0.lo || []).slice(0, 3).map(function (r) { return r.label + " " + r.diff; }).join(", ") + " lowest.";
    return '<div class="race-wrap ln-wrap">' +
        '<canvas class="race-canvas" data-player="lean" data-race="' + escAttr(p.file) +
          '" role="img" aria-label="' + escAttr(alt) + '"></canvas>' +
        '<div class="race-status mono" data-race-status>loading the ballots…</div>' +
      '</div>' +
      '<div class="race-bar">' +
        '<button class="race-btn" type="button" data-race-toggle aria-label="Play or pause">Play</button>' +
        '<input class="race-scrub" type="range" min="0" max="1000" value="0" step="1" ' +
          'data-race-scrub aria-label="Scrub through the acts">' +
        '<button class="race-btn race-speed" type="button" data-race-speed ' +
          'aria-label="Playback speed">1&times;</button>' +
      '</div>' +
      '<p class="race-note">' + esc(p.note) + '</p>';
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

  /* Initials stand in for the avatar. Content Stream fetches Bluesky avatars
   * live from the AppView; this app has no such call and is not adding one, so
   * the circle carries initials instead of a face. */
  function initials(name) {
    var t = String(name || "").replace(/[^\w\s]/g, " ").trim().split(/\s+/).filter(Boolean);
    if (!t.length) return "·";
    return (t.length === 1 ? t[0].slice(0, 2) : t[0][0] + t[t.length - 1][0]).toUpperCase();
  }

  var URL_RE = /https?:\/\/[^\s<>"']+/g;
  var MENTION_RE = /@([a-z0-9](?:[a-z0-9.\-]*[a-z0-9])?\.[a-z][a-z0-9.\-]*[a-z])/gi;

  /* Post text with URLs and @mentions made clickable, escaped first. The index
   * carries no facets (those come from the live API), so this is the regex
   * fallback Content Stream uses for its own archive cards. */
  function richText(s) {
    var html = esc(s).replace(URL_RE, function (m) {
      return '<a class="inline-url" href="' + m + '" target="_blank" rel="noopener noreferrer">' +
        m + '</a>';
    });
    // Only rewrite the segments that are not already inside an anchor, so an
    // @ inside a URL's query string is left alone.
    return html.replace(/(<a [^>]*>[\s\S]*?<\/a>)|([^<]+)/g, function (_, anchor, plain) {
      if (anchor) return anchor;
      return plain.replace(MENTION_RE, function (full, handle) {
        return '<a class="inline-mention" href="https://bsky.app/profile/' + handle +
          '" target="_blank" rel="noopener noreferrer">@' + handle + '</a>';
      });
    });
  }

  function safeHref(u) {
    return /^https?:\/\//i.test(String(u || "")) ? String(u) : "";
  }

  /* Bluesky rich text, using the post's own facets when the AppView supplied
   * them. Facet offsets are UTF-8 BYTE positions, not JS string indices, so
   * the text is walked as bytes — with an emoji in the post the two disagree
   * and every link lands in the wrong place.
   *
   * This is what turns "www.si.com/nba/76ers/on..." back into a link: Bluesky
   * stores the shortened label in the text and the real URL in the facet.
   * Without facets the regex fallback still catches full http links. */
  function facetText(text, facets) {
    if (!facets || !facets.length || typeof TextEncoder === "undefined") return richText(text);
    var enc, dec;
    try { enc = new TextEncoder(); dec = new TextDecoder(); }
    catch (e) { return richText(text); }
    var bytes = enc.encode(text);
    var spans = [];
    facets.forEach(function (f) {
      var ix = f.index || {}, ft = (f.features || [])[0];
      if (!ft || typeof ix.byteStart !== "number") return;
      var t = ft.$type || "", href = "";
      if (t.indexOf("#link") >= 0) href = safeHref(ft.uri);
      else if (t.indexOf("#mention") >= 0 && ft.did) href = "https://bsky.app/profile/" + ft.did;
      else if (t.indexOf("#tag") >= 0 && ft.tag) href = "https://bsky.app/hashtag/" + encodeURIComponent(ft.tag);
      if (href) spans.push({ start: ix.byteStart, end: ix.byteEnd, href: href });
    });
    if (!spans.length) return richText(text);
    spans.sort(function (a, b) { return a.start - b.start; });
    var out = "", pos = 0;
    spans.forEach(function (s) {
      if (s.start < pos || s.end > bytes.length) return;
      out += esc(dec.decode(bytes.slice(pos, s.start)));
      out += '<a class="inline-url" href="' + escAttr(s.href) +
        '" target="_blank" rel="noopener noreferrer">' +
        esc(dec.decode(bytes.slice(s.start, s.end))) + '</a>';
      pos = s.end;
    });
    return out + esc(dec.decode(bytes.slice(pos)));
  }

  /* The other half of a quote post. Without it "A splash of Leandro Barbosa,
   * a dash of Jamal Crawford . . . Good pickup" is a comment on nothing. */
  function quoteBlock(q) {
    if (!q) return "";
    if (q.missing) {
      return '<div class="bsky-quoted bsky-quoted-missing">[quoted post unavailable]</div>';
    }
    var av = q.avatar
      ? '<img class="bsky-quoted-avatar" loading="lazy" src="' + escAttr(q.avatar) +
        '" alt="" onerror="this.style.display=\'none\'">'
      : '<span class="bsky-quoted-avatar" aria-hidden="true"></span>';
    var media = "";
    var m = q.media;
    if (m && m.type === "image" && m.images && m.images.length) {
      var shown = m.images.slice(0, 4);
      media = '<div class="bsky-quoted-images' + (shown.length > 1 ? " grid" : "") + '">' +
        shown.map(function (i) {
          return '<img loading="lazy" src="' + escAttr(i.url) + '" alt="' + escAttr(i.alt || "") +
            '" onerror="this.style.display=\'none\'">';
        }).join("") + '</div>';
    } else if (m && m.type === "video" && m.thumbnail) {
      media = '<div class="bsky-quoted-video"><img loading="lazy" src="' + escAttr(m.thumbnail) +
        '" alt="" onerror="this.style.display=\'none\'">' +
        '<span class="bsky-quoted-video-hint">VIDEO · play on Bluesky</span></div>';
    } else if (m && m.type === "link" && m.uri) {
      media = '<div class="bsky-quoted-linkcard">' +
        '<span class="qlc-title">' + esc(m.title || m.uri) + '</span>' +
        '<span class="qlc-host mono">' + esc(host(m.uri)) + '</span></div>';
    }
    var open = q.url
      ? '<a class="bsky-quoted" href="' + escAttr(q.url) + '" target="_blank" rel="noopener noreferrer">'
      : '<div class="bsky-quoted">';
    return open +
      '<div class="bsky-quoted-head">' + av +
        '<span class="bsky-quoted-author">' + esc(q.author) + '</span>' +
        (q.handle ? '<span class="bsky-quoted-handle mono">@' + esc(q.handle) + '</span>' : "") +
      '</div>' +
      '<div class="bsky-quoted-text">' + facetText(q.text || "", q.facets) + '</div>' +
      media +
      (q.url ? '</a>' : '</div>');
  }

  function host(u) {
    var m = /^https?:\/\/([^/?#]+)/.exec(String(u || ""));
    return m ? m[1].replace(/^www\./, "") : "";
  }

  /* The post's own attachment, in the shapes nba-content-stream publishes:
   * an image set, a video (poster only — the stream is HLS and plays on
   * Bluesky), or a link preview card. */
  function bskyMedia(m, postUrl) {
    if (!m) return "";
    if (m.type === "image" && m.images && m.images.length) {
      var shown = m.images.slice(0, 4);
      return '<div class="bsky-images' + (shown.length > 1 ? " grid" : "") + '">' +
        shown.map(function (img) {
          return '<a href="' + escAttr(postUrl) + '" target="_blank" rel="noopener">' +
            '<img loading="lazy" src="' + escAttr(img.url) + '" alt="' + escAttr(img.alt || "") +
            '" onerror="this.closest(\'a\').remove()"></a>';
        }).join("") + '</div>';
    }
    if (m.type === "video" && m.thumbnail) {
      /* The poster is the card until it scrolls into view; app.js then swaps a
       * muted, looping <video> in over the top of it (js/bsky-video.js). The
       * anchor stays exactly what it was, so with no autoplay — reduced motion,
       * reduced data, a browser that will not play HLS — tapping still opens
       * the post on Bluesky, which is the behaviour this shipped with. */
      return '<a class="bsky-video" href="' + escAttr(postUrl) + '" target="_blank" rel="noopener"' +
        (m.playlist ? ' data-playlist="' + escAttr(m.playlist) + '"' : "") + '>' +
        '<img loading="lazy" src="' + escAttr(m.thumbnail) + '" alt="" ' +
        'onerror="this.closest(\'.bsky-video\').remove()">' +
        '<span class="play-hint">&#9654; Play on Bluesky</span></a>';
    }
    if (m.type === "link" && m.uri) {
      return '<a class="bsky-extcard" href="' + escAttr(m.uri) + '" target="_blank" rel="noopener">' +
        (m.thumb ? '<img loading="lazy" src="' + escAttr(m.thumb) + '" alt="" ' +
          'onerror="this.style.display=\'none\'">' : "") +
        '<div class="ext-meta">' +
          '<div class="ext-title">' + esc(m.title || m.uri) + '</div>' +
          (m.description ? '<div class="ext-desc">' + esc(m.description) + '</div>' : "") +
          '<div class="ext-host mono">' + esc(host(m.uri)) + '</div>' +
        '</div></a>';
    }
    return "";
  }

  function renderBuzz(c) {
    var p = c.payload;
    var ents = (p.teams || []).map(function (t) { return ent(t, "team", "", TEAM_NAME[t] || t); })
      .concat((p.players || []).map(function (n) { return ent(n, "player"); }));
    var entsHtml = ents.length ? '<div class="buzz-ents">' + ents.join("") + '</div>' : "";
    var when = ago(p.published_at);
    // A Reddit post is by a person, not an outlet, so the poster belongs in
    // the meta row where a handle reads as attribution rather than a byline.
    var poster = p.source === "reddit" && p.author
      ? '<span class="buzz-poster">u/' + esc(p.author) + '</span>' : "";
    var meta = '<div class="buzz-meta mono">' +
        '<span class="buzz-src">' + esc(p.source_label) + '</span>' +
        poster +
        (p.trending ? '<span class="buzz-hot">TRENDING</span>' : "") +
        (when ? '<span class="buzz-time">' + esc(when) + '</span>' : "") +
      '</div>';

    /* A Bluesky item reads as the post it is — avatar, author, the text as
     * written, then whatever was attached — the way Content Stream renders it.
     * A headline-and-link treatment turned a post into a truncated first line
     * and lost the point of it. */
    if (p.post) {
      // The avatar comes from the Bluesky AppView when it answered; initials
      // stand in when it did not, so the card never waits on a face.
      var av = p.post.avatar
        ? '<img class="bsky-avatar" loading="lazy" src="' + escAttr(p.post.avatar) + '" alt="" ' +
          'onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),' +
          '{className:\'bsky-avatar\',textContent:this.dataset.ini}))" data-ini="' +
          escAttr(initials(p.author)) + '">'
        : '<span class="bsky-avatar" aria-hidden="true">' + esc(initials(p.author)) + '</span>';
      return meta +
        '<div class="bsky-body">' +
          '<a class="bsky-avatar-link" href="' + escAttr(p.post.profile) +
            '" target="_blank" rel="noopener noreferrer">' + av + '</a>' +
          '<div class="bsky-body-text">' +
            '<a class="bsky-author" href="' + escAttr(p.post.profile) +
              '" target="_blank" rel="noopener noreferrer">' + esc(p.author) + '</a>' +
            '<span class="bsky-author-sep">:</span>' +
            '<span class="bsky-text">' + facetText(p.post.text, p.post.facets) + '</span>' +
          '</div>' +
        '</div>' +
        bskyMedia(p.post.media, p.url) +
        quoteBlock(p.post.quote) +
        entsHtml;
    }

    // The thumbnail is a third-party image on a third-party host. If it 404s or
    // is blocked, the card still reads — the headline is the card.
    var thumb = p.thumbnail
      ? '<div class="buzz-thumb' + (p.is_video ? " is-video" : "") + '">' +
        '<img loading="lazy" src="' + escAttr(p.thumbnail) + '" alt="" ' +
        'onerror="this.closest(\'.buzz-thumb\').remove()">' +
        (p.is_video ? '<span class="buzz-play" aria-hidden="true">&#9654;</span>' : "") +
        '</div>'
      : "";
    // Reddit and Substack bodies are written text with paragraphs in them —
    // an opening paragraph, a stat table — so their line breaks are kept.
    var asWritten = p.source === "reddit" || p.source === "substack";
    return meta + thumb +
      '<h3 class="buzz-title">' + esc(p.title) + '</h3>' +
      (p.excerpt ? '<p class="buzz-excerpt' + (asWritten ? " as-written" : "") + '">' +
        esc(p.excerpt) + '</p>' : "") +
      entsHtml +
      (p.author && !poster ? '<div class="card-sub">' + esc(p.author) + '</div>' : "");
  }

  var RENDERERS = {
    trade: renderTrade, rumor: renderRumor, vs: renderVs, trivia: renderTrivia,
    quiz: renderQuiz, ballot: renderBallot, salary: renderSalary, otd: renderOtd,
    race: renderRace, oddity: renderOddity, buzz: renderBuzz,
    tradetrend: renderTradeTrend, tradedigest: renderTradeDigest,
    mates: renderMates, compare: renderCompare, lean: renderLean
  };

  /* ---------------- card frame ---------------- */

  function tapTarget(c) {
    // Where tap-through goes, per type. Dummy-safe defaults for step 2.
    switch (c.type) {
      // A reader's trade opens as THAT trade in the machine when the log holds
      // enough to rebuild it; a trade with picks in it cannot be rebuilt from
      // the log, so it falls back to the empty tool rather than a wrong trade.
      case "trade": return c.payload.machine_url
        ? { url: c.payload.machine_url, label: "Open this trade" }
        : { url: "https://hoopsmatic.com/transactionmaster", label: "Open Trade Machine" };
      case "tradetrend": return { url: c.payload.machine_url, label: "Build one yourself" };
      case "tradedigest": return { url: c.payload.machine_url, label: "Trade " + c.payload.player.split(" ").pop() };
      case "rumor": return { url: c.payload.source_url || "https://hoopshype.com/rumors/", label: "Read on HoopsHype" };
      case "vs":    return { url: c.payload.compare_url, label: "Full comparison" };
      case "salary": return { url: "https://hoopsmatic.com/salary-season-finder", label: "Salary Season Finder" };
      case "oddity": return { url: "https://jsierrahoopshype.github.io/media-vote-tracker/", label: "Media Vote Tracker" };
      // No tap-through. The race IS the destination; sending someone to the
      // HoopsMatic homepage from it added nothing.
      case "race":  return null;
      // Same reasoning as a race: the card IS the destination.
      case "mates": return null;
      // Unlike a race, this one has somewhere to go: the card is an
      // argument about two careers, and the comparison tool is where you
      // go to see the rows it did not have room to dwell on.
      case "compare": return { url: c.payload.compare_url, label: "Full comparison" };
      // The tracker holds every ballot behind these six rows, which is more
      // than a card can carry and exactly what someone who cares will want.
      case "lean":  return { url: c.payload.url, label: "Every ballot" };
      // The item lives somewhere else and that is the point: Buzz is a pointer
      // to the source, never a replacement for it.
      case "buzz":  return { url: c.payload.url, label: c.payload.cta || "Open" };
      default: return null;
    }
  }

  function render(c) {
    var meta = TYPE_META[c.type] || { chip: c.type, cls: "" };
    if (c.type === "tradedigest" && c.payload && c.payload.period_chip) {
      meta = { chip: c.payload.period_chip, cls: meta.cls, tab: meta.tab };
    }
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
