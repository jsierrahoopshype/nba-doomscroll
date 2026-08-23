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
      sides: names.map(function (city, i) {
        return { team: abbrev(city), team_name: city, logo: logoFor(city), gets: gets(i) };
      })
    };
  }

  function verdict(balance) {
    if (balance >= 98) return "Salaries match almost to the dollar.";
    if (balance >= 95) return "Money lines up cleanly.";
    if (balance >= 90) return "Close enough to work under the rules.";
    return "Tight, but it fits inside the 15% rule.";
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
        built_ago: ago(t.ts)
      }
    };
  }

  /* ---------------- public ---------------- */

  /** Resolves to trade cards, or [] if the log is unreachable. Never throws:
   *  the Trades tab keeps its sample cards on any failure. */
  function load() {
    return loadHeadshots().then(function () {
      return fetch(TRADE_LOG_URL, { credentials: "omit" });
    }).then(function (r) {
      if (!r.ok) throw new Error("trade-log " + r.status);
      return r.json();
    }).then(function (json) {
      var rows = json && (json.rows || json.trades);
      if (!Array.isArray(rows)) throw new Error("unexpected shape: " + Object.keys(json || {}).join(","));

      var byTs = groupByTs(rows);
      var seen = {}, cards = [], stats = { total: 0, dup: 0, multi: 0, unbalanced: 0 };

      Object.keys(byTs).sort().reverse().forEach(function (ts) {  // newest first
        if (cards.length >= MAX_CARDS) return;
        stats.total++;
        var legs = byTs[ts];
        var key = dealKey(legs);
        if (seen[key]) { stats.dup++; return; }
        seen[key] = 1;
        var t = buildTrade(ts, legs);
        if (!t) {
          var teams = {};
          legs.forEach(function (l) { teams[l.from_team] = 1; teams[l.to_team] = 1; });
          if (Object.keys(teams).length !== 2) stats.multi++; else stats.unbalanced++;
          return;
        }
        cards.push(toCard(t, cards.length + 1));
      });

      console.info("[doomscroll] trades: " + cards.length + " cards from " + stats.total +
        " logged deals (" + stats.dup + " duplicates, " + stats.multi +
        " multi-team, " + stats.unbalanced + " failed the balance filter)");
      return cards;
    }).catch(function (e) {
      console.warn("[doomscroll] trade log unavailable:", e.message);
      return [];
    });
  }

  root.DoomTrades = { load: load, _buildTrade: buildTrade, _dealKey: dealKey, _groupByTs: groupByTs };
})(window);
