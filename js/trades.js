/* NBA Doomscroll — live Trade Machine feed
 *
 * Reads the public trade log behind the Trade Machine and turns the good ones
 * into cards. The endpoint returns flat legs, one row per outgoing player:
 *
 *   { ts, from_team, player, salary, to_team }
 *
 * Rows sharing a `ts` are one trade. Confirmed field set — no usernames, IPs or
 * any other identifier, so nothing here can tie a trade back to a person.
 *
 * The log is what people actually built, which means most of it is noise: the
 * same deal re-logged a dozen times seconds apart while someone tweaks it, and
 * a great many "Jokic for Zeke Nnaji" fantasies. Three filters earn a card:
 *
 *   1. dedupe   identical player/team sets collapse to their newest version
 *   2. two-team the card format shows two columns; 3+ team deals are skipped
 *   3. balance  the 15% rule from nba-trade-video — the lighter side must be
 *               at least 85% of the heavier one, or it is not a real trade
 */
(function (root) {
  "use strict";

  var TRADE_LOG_URL = "https://nba-trade-calculator.thejorgesierra.workers.dev/api/trade-log";
  // The log holds ~446K rows. If the endpoint ever returns all of them that is
  // tens of MB over a phone connection, so ask for a slice. The param is
  // harmless if the Worker ignores it — but then the full payload arrives, and
  // the size check below says so loudly instead of silently costing readers
  // their data. Only the newest rows matter: this is a "what are people
  // building right now" feed.
  var WANT_ROWS = 600;
  var ROWS_WARN_AT = 20000;
  var MACHINE_URL = "https://hoopsmatic.com/transactionmaster";
  var LOGO_BASE = "https://jsierrahoopshype.github.io/nba-headshots/teams/logos/current/svg/";
  var HEADSHOT_BASE = "https://jsierrahoopshype.github.io/nba-headshots/players/headshots/face/";

  // Same tolerance the video generator uses: TRADE_QUALITY_TOLERANCE = 0.15.
  var MIN_BALANCE_PCT = 85;
  var MAX_CARDS = 60;

  // The log stores city names, not abbreviations.
  var TEAM_BY_CITY = {
    "Atlanta": "ATL", "Boston": "BOS", "Brooklyn": "BKN", "Charlotte": "CHA",
    "Chicago": "CHI", "Cleveland": "CLE", "Dallas": "DAL", "Denver": "DEN",
    "Detroit": "DET", "Golden State": "GSW", "Houston": "HOU", "Indiana": "IND",
    "LA Clippers": "LAC", "LA Lakers": "LAL", "Los Angeles Lakers": "LAL",
    "Memphis": "MEM", "Miami": "MIA", "Milwaukee": "MIL", "Minnesota": "MIN",
    "New Orleans": "NOP", "New York": "NYK", "Oklahoma City": "OKC",
    "Orlando": "ORL", "Philadelphia": "PHI", "Phoenix": "PHX", "Portland": "POR",
    "Sacramento": "SAC", "San Antonio": "SAS", "Toronto": "TOR", "Utah": "UTA",
    "Washington": "WAS"
  };

  var headshotByName = null; // filled from nba-headshots metadata, best effort

  function abbrev(city) { return TEAM_BY_CITY[String(city || "").trim()] || null; }
  function logoFor(city) {
    var a = abbrev(city);
    return a ? LOGO_BASE + a.toLowerCase() + ".svg" : "";
  }

  function isPick(name) { return /^\d{4}\s*#\d+\s*pick$/i.test(String(name || "").trim()); }

  function faceFor(name) {
    if (!headshotByName || isPick(name)) return null;
    var f = headshotByName[name];
    return f ? HEADSHOT_BASE + f : null;
  }

  function loadHeadshots() {
    return fetch("https://jsierrahoopshype.github.io/nba-headshots/players/metadata/players.json")
      .then(function (r) { return r.json(); })
      .then(function (d) {
        headshotByName = {};
        (d.players || []).forEach(function (p) {
          if (p.headshot && p.headshot.face && p.headshot.filename) {
            headshotByName[p.full_name] = p.headshot.filename;
          }
        });
      })
      .catch(function () { headshotByName = {}; }); // cards still render, silhouettes only
  }

  /* ---------------- shaping ---------------- */

  function groupByTs(rows) {
    var byTs = {};
    rows.forEach(function (r) {
      if (!r || !r.ts || !r.player || !r.from_team || !r.to_team) return;
      (byTs[r.ts] || (byTs[r.ts] = [])).push(r);
    });
    return byTs;
  }

  /** Identity of a deal regardless of when it was logged, so the same trade
   *  saved twelve times while someone tweaked it collapses to one card. */
  function dealKey(legs) {
    return legs.map(function (l) { return l.from_team + ">" + l.player + ">" + l.to_team; })
      .sort().join("|");
  }

  /* A link that opens THIS trade in the Trade Machine, not the empty tool.
   *
   * The machine reads its own share format: t=<abbrevs in team order>,
   * p=<player slugs>, pd=<fromTeamIdx-destIdx per player, in p's order>. Player
   * ids are preferred there but a name slug is an accepted fallback, and the
   * trade log only carries names, so slugs it is.
   *
   * Trades containing draft picks get no deep link. The pick format needs the
   * originating team, year and round, and the log records only "2027 #14 pick".
   * Opening a trade that silently dropped its picks would be a different trade,
   * and a wrong trade is worse than the generic link.
   */
  function machineUrl(names, legs) {
    if (legs.some(function (l) { return isPick(l.player); })) return null;
    var idx = {};
    idx[names[0]] = 0; idx[names[1]] = 1;
    var p = [], pd = [];
    for (var i = 0; i < legs.length && p.length < 8; i++) {
      var l = legs[i];
      if (!(l.from_team in idx) || !(l.to_team in idx)) return null;
      p.push(String(l.player).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, ""));
      pd.push(idx[l.from_team] + "-" + idx[l.to_team]);
    }
    if (p.length !== legs.length) return null;   // truncated is a different trade
    return MACHINE_URL + "?t=" + abbrev(names[0]) + "," + abbrev(names[1]) +
      "&p=" + p.map(encodeURIComponent).join(",") + "&pd=" + pd.join(",");
  }

  function buildTrade(ts, legs) {
    var teams = {};
    legs.forEach(function (l) { teams[l.from_team] = 1; teams[l.to_team] = 1; });
    var names = Object.keys(teams);
    if (names.length !== 2) return null;              // two-column card format
    if (!abbrev(names[0]) || !abbrev(names[1])) return null;

    var out = {};
    out[names[0]] = []; out[names[1]] = [];
    legs.forEach(function (l) { if (out[l.from_team]) out[l.from_team].push(l); });
    if (!out[names[0]].length || !out[names[1]].length) return null;  // one-way dump

    var totalA = out[names[0]].reduce(function (s, l) { return s + (+l.salary || 0); }, 0);
    var totalB = out[names[1]].reduce(function (s, l) { return s + (+l.salary || 0); }, 0);
    if (!totalA || !totalB) return null;
    var balance = Math.round(Math.min(totalA, totalB) / Math.max(totalA, totalB) * 100);
    if (balance < MIN_BALANCE_PCT) return null;

    // Each side's card column lists what that team RECEIVES.
    function gets(receiverIdx) {
      var senderCity = names[1 - receiverIdx];
      return out[senderCity].map(function (l) {
        return {
          name: l.player,
          img: faceFor(l.player),
          salary: Math.round((+l.salary || 0) / 100000) / 10,   // millions, 1dp
          pick: isPick(l.player)
        };
      }).sort(function (a, b) { return b.salary - a.salary; });
    }

    return {
      ts: ts,
      balance_pct: balance,
      machine_url: machineUrl(names, legs),
      sides: names.map(function (city, i) {
        return { team: abbrev(city), team_name: city, logo: logoFor(city), gets: gets(i) };
      })
    };
  }

  /* Describes the salary match and nothing more. An earlier version said
   * things like "close enough to work under the rules", which is a claim about
   * CBA legality that a salary ratio cannot support: real matching depends on
   * apron status, exceptions, aggregation limits and more. The Trade Machine
   * itself has that logic; this feed does not, so it does not pretend to. */
  function verdict(balance) {
    if (balance >= 99) return "Salaries match almost to the dollar.";
    if (balance >= 95) return "Salaries within " + (100 - balance) + "%.";
    return "Salaries within " + (100 - balance) + "% — inside the 15% band.";
  }

  function ago(ts) {
    var mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
    if (!isFinite(mins) || mins < 0) return "recently";
    if (mins < 60) return mins + "m ago";
    var h = Math.round(mins / 60);
    if (h < 24) return h + "h ago";
    var d = Math.round(h / 24);
    return d === 1 ? "yesterday" : d + " days ago";
  }

  function toCard(t, idx) {
    var players = [];
    t.sides.forEach(function (s) { s.gets.forEach(function (p) { players.push(p.name); }); });
    return {
      id: "trade-" + idx + "-" + String(t.ts).replace(/\D/g, "").slice(-12),
      type: "trade",
      tab: ["trades"],
      live: true,
      tags: {
        content_type: "trade",
        players: players.filter(function (n) { return !isPick(n); }).slice(0, 6),
        teams: t.sides.map(function (s) { return s.team; }),
        era: "2020s",
        category: "trade-machine"
      },
      payload: {
        sides: t.sides,
        balance_pct: t.balance_pct,
        verdict: verdict(t.balance_pct),
        built_ago: ago(t.ts),
        machine_url: t.machine_url
      }
    };
  }

  /* ---------------- trade trends ----------------
   *
   * The individual cards answer "what did someone just build". This answers
   * "who is the whole Trade Machine moving this week, and where to" — which is
   * the one thing a trade log can say that no single trade can.
   *
   * It counts DEALS, not log rows: the same deal re-saved twelve times while
   * someone tweaks it is one build, or the leaderboard would just rank whoever
   * had the most patient tinkerer. And it counts every deal in the window, not
   * only the ones that earned a card — a three-team blockbuster and a wildly
   * unbalanced fantasy are still people telling you who they are thinking
   * about.
   */
  var TREND_PLAYERS = 6;
  var TREND_MIN_BUILDS = 2;

  function playerSlug(name) {
    return String(name).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function buildTrends(deals, span) {
    var byPlayer = {};
    deals.forEach(function (legs) {
      var seenHere = {};
      legs.forEach(function (l) {
        if (isPick(l.player)) return;
        var to = abbrev(l.to_team), from = abbrev(l.from_team);
        if (!to || !from) return;
        // One deal counts once per player even if the log repeats the leg.
        var k = l.player + ">" + to;
        if (seenHere[k]) return;
        seenHere[k] = 1;
        var e = byPlayer[l.player] || (byPlayer[l.player] = { name: l.player, builds: 0, to: {}, from: {} });
        e.builds++;
        e.to[to] = (e.to[to] || 0) + 1;
        e.from[from] = (e.from[from] || 0) + 1;
      });
    });
    var ranked = Object.keys(byPlayer).map(function (n) { return byPlayer[n]; })
      .filter(function (e) { return e.builds >= TREND_MIN_BUILDS; })
      .sort(function (a, b) { return b.builds - a.builds || a.name.localeCompare(b.name); })
      .slice(0, TREND_PLAYERS);
    if (ranked.length < 3) return null;   // too thin to be a leaderboard

    var players = ranked.map(function (e) {
      var dests = Object.keys(e.to).map(function (t) { return { team: t, n: e.to[t] }; })
        .sort(function (a, b) { return b.n - a.n; }).slice(0, 3);
      var homes = Object.keys(e.from).map(function (t) { return { team: t, n: e.from[t] }; })
        .sort(function (a, b) { return b.n - a.n; });
      return {
        name: e.name,
        img: faceFor(e.name),
        builds: e.builds,
        from: homes.length ? homes[0].team : null,
        dests: dests,
        // ?player= opens the machine's trade-loop generator for that player.
        url: MACHINE_URL + "?player=" + encodeURIComponent(playerSlug(e.name))
      };
    });
    return {
      id: "trade-trends",
      type: "tradetrend",
      tab: ["trades"],
      live: true,
      tags: {
        content_type: "tradetrend",
        players: players.map(function (p) { return p.name; }),
        teams: players.reduce(function (acc, p) {
          p.dests.forEach(function (d) { if (acc.indexOf(d.team) < 0) acc.push(d.team); });
          return acc;
        }, []).slice(0, 8),
        era: "2020s",
        category: "trade-machine"
      },
      payload: {
        headline: "Who the Trade Machine is moving",
        span: span,
        deals: deals.length,
        players: players,
        machine_url: MACHINE_URL
      }
    };
  }

  /* "over the last 3 days", from the timestamps actually in the slice — the
   * window is however far back the newest rows reach, not a fixed week. */
  function spanOf(tsList) {
    if (!tsList.length) return "recently";
    var times = tsList.map(function (t) { return new Date(t).getTime(); })
      .filter(function (n) { return isFinite(n); });
    if (!times.length) return "recently";
    var hours = (Math.max.apply(null, times) - Math.min.apply(null, times)) / 3600000;
    if (hours < 2) return "in the last couple of hours";
    if (hours < 36) return "in the last " + Math.round(hours) + " hours";
    return "over the last " + Math.round(hours / 24) + " days";
  }

  /* ---------------- daily digest ----------------
   *
   * The trends card above is computed here from the newest slice of the log,
   * which is honest but shallow — a few hundred deals, however far back that
   * reaches. The Trade Machine already publishes a proper one: the same Worker
   * that feeds nba-trade-card computes, server-side and over the whole log,
   * who appeared in the most trades in the last 24 hours, where those trades
   * sent them, and who came back the other way.
   *
   * Same endpoint, same shape, same numbers as the card Jorge posts to social.
   * If it is unreachable the tab simply does not get this card; the locally
   * computed trends card is unaffected.
   */
  var DIGEST_URL = "https://nba-trade-daily-digest.thejorgesierra.workers.dev/digest";

  function pairs(list) {
    return (list || []).filter(function (e) { return e && e.length >= 2; })
      .slice(0, 3)
      .map(function (e) { return { name: String(e[0]), n: +e[1] || 0 }; });
  }

  function digestCard(d) {
    if (!d || !d.hasTrades || !d.topPlayer || !d.tradeCount) return null;
    var dests = pairs(d.topDestinations), back = pairs(d.topTradedForPlayers);
    if (!dests.length && !back.length) return null;
    var share = Math.round(d.topCount / d.tradeCount * 1000) / 10;
    return {
      id: "trade-digest",
      type: "tradedigest",
      tab: ["trades"],
      live: true,
      tags: {
        content_type: "tradedigest",
        players: [d.topPlayer].concat(back.map(function (b) { return b.name; })).slice(0, 5),
        teams: dests.map(function (x) { return abbrev(x.name) || x.name; }).filter(Boolean),
        era: "2020s",
        category: "trade-machine"
      },
      payload: {
        player: d.topPlayer,
        img: faceFor(d.topPlayer),
        share: share,
        count: d.topCount,
        trades: d.tradeCount,
        dests: dests.map(function (x) {
          return { name: x.name, abbr: abbrev(x.name) || x.name, logo: logoFor(x.name),
                   pct: Math.round(x.n / d.topCount * 1000) / 10 };
        }),
        back: back.map(function (x) {
          return { name: x.name, img: faceFor(x.name),
                   pct: Math.round(x.n / d.topCount * 1000) / 10 };
        }),
        machine_url: MACHINE_URL + "?player=" + encodeURIComponent(playerSlug(d.topPlayer))
      }
    };
  }

  function loadDigest() {
    return fetch(DIGEST_URL, { credentials: "omit" })
      .then(function (r) {
        if (!r.ok) throw new Error("digest " + r.status);
        return r.json();
      })
      .then(function (j) { return digestCard(j && j.digest); })
      .catch(function (e) {
        console.warn("[doomscroll] trade digest unavailable:", e.message);
        return null;
      });
  }

  /* ---------------- public ---------------- */

  /** Resolves to trade cards, or [] if the log is unreachable. Never throws:
   *  the Trades tab keeps its sample cards on any failure. */
  function load() {
    // The digest is independent of the log: it is fetched alongside it and
    // simply absent if it fails.
    var digest = loadHeadshots().then(loadDigest);
    return loadHeadshots().then(function () {
      var sep = TRADE_LOG_URL.indexOf("?") >= 0 ? "&" : "?";
      return fetch(TRADE_LOG_URL + sep + "limit=" + WANT_ROWS, { credentials: "omit" });
    }).then(function (r) {
      if (!r.ok) throw new Error("trade-log " + r.status);
      var len = r.headers.get("content-length");
      if (len && +len > 2000000) {
        console.warn("[doomscroll] trade log returned " + Math.round(+len / 1048576) +
          "MB — the endpoint appears to ignore ?limit, which is a lot to send a phone.");
      }
      return r.json();
    }).then(function (json) {
      var rows = json && (json.rows || json.trades);
      if (!Array.isArray(rows)) throw new Error("unexpected shape: " + Object.keys(json || {}).join(","));
      if (rows.length > ROWS_WARN_AT) {
        console.warn("[doomscroll] trade log returned " + rows.length.toLocaleString() +
          " rows; using the newest " + WANT_ROWS + ".");
      }
      // Newest first, then trim. Sorting before the cut matters: the log is not
      // guaranteed to arrive ordered, and a feed of "what people built" is
      // worthless if it silently keeps the oldest rows in the payload.
      if (rows.length > WANT_ROWS) {
        rows = rows.slice().sort(function (a, b) {
          return String(b.ts).localeCompare(String(a.ts));
        }).slice(0, WANT_ROWS * 4);   // *4: one trade spans several leg rows
        // The cut lands mid-trade whenever the boundary falls inside a ts
        // group, which would render a card missing a player — a wrong trade is
        // worse than one fewer trade. Drop the trailing group entirely.
        if (rows.length) {
          var lastTs = rows[rows.length - 1].ts;
          while (rows.length && rows[rows.length - 1].ts === lastTs) rows.pop();
        }
      }

      var byTs = groupByTs(rows);
      var seen = {}, cards = [], stats = { total: 0, dup: 0, multi: 0, unbalanced: 0 };
      var deals = [], tsSeen = [];

      Object.keys(byTs).sort().reverse().forEach(function (ts) {  // newest first
        stats.total++;
        var legs = byTs[ts];
        var key = dealKey(legs);
        if (seen[key]) { stats.dup++; return; }
        seen[key] = 1;
        // Every deduped deal feeds the trends card, including the ones that do
        // not survive the card filters below.
        deals.push(legs);
        tsSeen.push(ts);
        if (cards.length >= MAX_CARDS) return;
        var t = buildTrade(ts, legs);
        if (!t) {
          var teams = {};
          legs.forEach(function (l) { teams[l.from_team] = 1; teams[l.to_team] = 1; });
          if (Object.keys(teams).length !== 2) stats.multi++; else stats.unbalanced++;
          return;
        }
        cards.push(toCard(t, cards.length + 1));
      });

      var trends = buildTrends(deals, spanOf(tsSeen));
      if (trends) cards.unshift(trends);

      console.info("[doomscroll] trades: " + cards.length + " cards from " + stats.total +
        " logged deals (" + stats.dup + " duplicates, " + stats.multi +
        " multi-team, " + stats.unbalanced + " failed the balance filter)" +
        (trends ? "; trends over " + deals.length + " deals" : "; too few deals for a trends card"));
      return digest.then(function (dc) {
        if (dc) cards.unshift(dc);
        return cards;
      });
    }).catch(function (e) {
      console.warn("[doomscroll] trade log unavailable:", e.message);
      // The digest stands on its own: if the log is down but the digest is up,
      // the Trades tab still has something real to say.
      return digest.then(function (dc) { return dc ? [dc] : []; }).catch(function () { return []; });
    });
  }

  root.DoomTrades = { load: load, _buildTrade: buildTrade, _dealKey: dealKey, _groupByTs: groupByTs };
})(window);
