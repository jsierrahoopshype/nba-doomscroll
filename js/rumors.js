/* NBA Doomscroll — live rumors
 *
 * Fetches on-this-day and random rumors from the archive Worker, in the
 * READER's browser. Nothing is baked into this repo: data/dummy-cards.json
 * holds invented placeholder text only, and is what shows if the endpoints are
 * not reachable.
 *
 * Endpoint:
 *   GET /api/rumors/latest    -> array of the 100 most recent entries
 *
 * IT USED TO CALL TWO ENDPOINTS THAT DO NOT EXIST.
 *
 * /api/rumors/on-this-day and /api/rumors/random were written against a Worker
 * design that was never built. The Worker serves /api/rumors/index, /latest
 * and /part/N. Both calls 404'd from the first day, load() caught them, warned
 * to the console and returned [], and the tab fell back to its sample cards
 * looking entirely healthy - so the Rumors tab has never once shown a real
 * rumor. The link registry found it; a reader never could have.
 *
 * ON THIS DAY IS NOT BACK YET, AND CANNOT BE FROM HERE.
 *
 * "On this day" means searching 652,000 entries for a month and day across
 * every year. /latest holds the most recent hundred, so none of them will
 * match today's date from a past year, and the part files are tens of
 * megabytes each - not something to download into a phone to find twenty
 * matches. That feature needs an endpoint on the Worker. Until it exists the
 * tab shows recent rumors, which is real, or nothing.
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
  var LATEST_URL = API + "/api/rumors/latest";
  var BLOCKLIST_URL = "data/rumor-blocklist.json";

  var blocklist = null;

  /* How many of the hundred reach the feed. The whole set would swamp a tab
   * that also carries archive cards, and the engine spaces them out anyway. */
  var MAX_CARDS = 25;

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

  /* UNUSED while on-this-day is deferred, and kept on purpose: it is four
   * lines and it encodes a decision worth not making twice. Local date, not
   * UTC - a reader west of UTC asking for "today" should get their today, and
   * the endpoint that will eventually want this accepts a day either side.
   * Delete it if on-this-day is abandoned rather than deferred. */
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

  /* Returns rumor cards, or an empty array if the archive is not reachable.
   * Never throws: the Rumors tab keeps its sample cards on any failure. */
  function load() {
    return loadBlocklist().then(function (bl) {
      return fetchJson(LATEST_URL).then(function (rows) {
        /* The endpoint answers with a bare array. Anything else means the
         * Worker changed shape, and rendering nothing is better than
         * rendering whatever a changed payload happens to contain. */
        if (!Array.isArray(rows)) {
          console.warn("[doomscroll] rumors: expected an array, got " +
            (rows && typeof rows === "object" ? Object.keys(rows).join(",") : typeof rows));
          return [];
        }
        var usable = rows.filter(function (e) {
          return e && e.source_url && e.text && !isBlocked(e, bl);
        });

        /* SHUFFLED, because the endpoint returns the same hundred entries to
         * everyone until the archive updates. Without this the tab is
         * identical on every visit, which is the opposite of what a feed is
         * for. Fisher-Yates over a copy: the caller's array is not ours. */
        var pool = usable.slice();
        for (var i = pool.length - 1; i > 0; i--) {
          var j = Math.floor(Math.random() * (i + 1));
          var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
        }

        var cards = pool.slice(0, MAX_CARDS).map(function (e, i) {
          return toCard(e, i, false);
        });
        console.info("[doomscroll] rumors: " + cards.length + " cards from " +
          rows.length + " recent entries (" + (rows.length - usable.length) +
          " blocked or incomplete)");
        return cards;
      }).catch(function (e) {
        console.warn("[doomscroll] live rumors unavailable:", e.message);
        return [];
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
