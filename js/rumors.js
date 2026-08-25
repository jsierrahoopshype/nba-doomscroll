/* NBA Doomscroll — live rumors
 *
 * Fetches on-this-day and random rumors from the archive Worker, in the
 * READER's browser. Nothing is baked into this repo: data/dummy-cards.json
 * holds invented placeholder text only, and is what shows if the endpoints are
 * not reachable.
 *
 * Endpoints (see proposals/rumors-endpoints/ for the Worker side):
 *   GET /api/rumors/on-this-day?md=MM-DD&limit=20
 *   GET /api/rumors/random?limit=25
 *
 * Every entry arrives as a <=280-char excerpt carrying a source_url, and every
 * card links back to hoopshype.com — the same constraint the Content Stream
 * design doc sets for third-party content.
 *
 * The editorial blocklist is applied by the index builder AND again here, so a
 * blocked topic has to get past two independent passes to reach a reader.
 */
(function (root) {
  "use strict";

  var API = "https://hoopshype-rumors-api.thejorgesierra.workers.dev";
  var OTD_URL = API + "/api/rumors/on-this-day";
  var RANDOM_URL = API + "/api/rumors/random";
  var BLOCKLIST_URL = "data/rumor-blocklist.json";

  var blocklist = null;

  function loadBlocklist() {
    if (blocklist) return Promise.resolve(blocklist);
    return fetch(BLOCKLIST_URL).then(function (r) { return r.json(); }).then(function (d) {
      var terms = (d.blocked_keywords || []).map(function (t) { return t.toLowerCase(); });
      var whole = {};
      (d.whole_word_only || []).forEach(function (t) { whole[t.toLowerCase()] = 1; });
      blocklist = { terms: terms, whole: whole };
      return blocklist;
    }).catch(function () {
      // No blocklist means no editorial filter. Fail closed: with an empty
      // term list every entry would pass, so signal it and let callers bail.
      blocklist = null;
      throw new Error("blocklist unavailable");
    });
  }

  function isBlocked(entry, bl) {
    var hay = [entry.text, entry.quote, entry.outlet].filter(Boolean).join(" ");
    if (Array.isArray(entry.tags)) hay += " " + entry.tags.join(" ");
    hay = hay.toLowerCase();
    var padded = " " + hay.replace(/[^a-z0-9]+/g, " ") + " ";
    for (var i = 0; i < bl.terms.length; i++) {
      var t = bl.terms[i];
      if (bl.whole[t]) { if (padded.indexOf(" " + t + " ") >= 0) return true; }
      else if (hay.indexOf(t) >= 0) return true;
    }
    return false;
  }

  function era(dateStr) {
    var y = parseInt(String(dateStr).slice(0, 4), 10);
    return isNaN(y) ? "2020s" : (y - (y % 10)) + "s";
  }

  function toCard(entry, idx, onThisDay) {
    var year = parseInt(String(entry.archive_date).slice(0, 4), 10);
    var thisYear = new Date().getFullYear();
    return {
      id: "rumor-" + (onThisDay ? "otd-" : "rnd-") + idx + "-" +
          String(entry.archive_date || "").replace(/\D/g, ""),
      type: "rumor",
      tab: ["rumors"],
      live: true,
      tags: {
        content_type: "rumor",
        players: Array.isArray(entry.tags) ? entry.tags.slice(0, 4) : [],
        teams: [],
        era: era(entry.archive_date),
        category: onThisDay ? "rumor-history" : "rumor-random"
      },
      payload: {
        archive_date: entry.archive_date,
        outlet: entry.outlet || "HoopsHype",
        source_url: entry.source_url,
        text: entry.text,
        quote: entry.quote || null,
        on_this_day: !!onThisDay,
        years_ago: onThisDay && year ? Math.max(0, thisYear - year) : 0
      }
    };
  }

  // Local date, deliberately: the Worker accepts any date within a day of its
  // own UTC date, so a reader west of UTC still gets "today" rather than an
  // empty file.
  function todayMd() {
    var d = new Date();
    return ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  function fetchJson(url) {
    return fetch(url, { credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error(url.split("/").pop() + " " + r.status);
      return r.json();
    });
  }

  /* Returns rumor cards, or an empty array if the endpoints are not live yet.
   * Never throws: the Rumors tab keeps its sample cards on any failure. */
  function load() {
    return loadBlocklist().then(function (bl) {
      return Promise.all([
        fetchJson(OTD_URL + "?md=" + todayMd() + "&limit=20").catch(function (e) {
          console.warn("[doomscroll] on-this-day unavailable:", e.message); return null;
        }),
        fetchJson(RANDOM_URL + "?limit=25").catch(function (e) {
          console.warn("[doomscroll] random rumors unavailable:", e.message); return null;
        })
      ]).then(function (res) {
        var cards = [];
        (((res[0] || {}).entries) || []).forEach(function (e, i) {
          if (e && e.source_url && !isBlocked(e, bl)) cards.push(toCard(e, i, true));
        });
        (((res[1] || {}).entries) || []).forEach(function (e, i) {
          if (e && e.source_url && !isBlocked(e, bl)) cards.push(toCard(e, i, false));
        });
        return cards;
      });
    }).catch(function (e) {
      console.warn("[doomscroll] live rumors skipped:", e.message);
      return [];
    });
  }

  /* The Buzz tab carries third-party headlines and post text, which needs the
   * same editorial filter these rumors get. Exposed rather than copied so the
   * two cannot drift apart: one blocklist, one matcher, two callers.
   *
   * Resolves to a predicate over free text; rejects when the blocklist is
   * unreachable, so a caller fails closed the way load() already does. */
  function editorialFilter() {
    return loadBlocklist().then(function (bl) {
      return function (text) { return isBlocked({ text: String(text || "") }, bl); };
    });
  }

  root.LiveRumors = { load: load, apiBase: API, editorialFilter: editorialFilter };
})(window);
