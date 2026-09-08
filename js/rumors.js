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
  var ON_THIS_DAY_URL = API + "/api/rumors/on-this-day";
  var BLOCKLIST_URL = "data/rumor-blocklist.json";

  var blocklist = null;

  /* Faces for the tagged players.
   *
   * data/faces/index.json is the same 1,231-tile index js/trades.js already
   * reads, baked by tools/build_data.mjs. Reading it here rather than asking
   * trades.js for it keeps the two tabs independent - the Rumors tab must not
   * start depending on the Trades tab having been opened - and the browser
   * caches the 44 KB either way.
   *
   * Best effort by design: a rumor about a front office, a draft class or a
   * player the tile set never had resolves to nothing, and the card renders
   * without a face rather than with a grey outline of nobody. */
  var FACES_URL = "data/faces/index.json";
  var faceIndex = null;   // exact name -> filename
  var faceFolded = null;  // normalised name -> filename

  /* Tags come from the archive and the tile index carries plain ASCII names, so
   * "Nikola Jokic" spelled with its accent has to land on the same tile. Accents
   * and punctuation go, which is the same fold tools/lib/faces.mjs applies on
   * the build side - the two ends agree on what counts as the same name.
   *
   * THE GENERATIONAL SUFFIX STAYS. Stripping "Jr", "Sr" and "II" looks like it
   * would help and does the opposite: 15 names in the index carry one, and
   * folding it away collapses two of them onto their fathers - the index holds
   * both halves of the Gerald Henderson and Gary Payton pairs, and whichever
   * was read first would answer for both. Keeping the suffix leaves the fold
   * collision-free across all 1,231 names, and "Jr." with a period still folds
   * to the same key as one written without it. */
  function fold(name) {
    var s = String(name || "");
    if (s.normalize) s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  }

  function loadFaces() {
    if (faceIndex) return Promise.resolve();
    return fetch(FACES_URL)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        faceIndex = (j && j.faces) || {};
        faceFolded = {};
        Object.keys(faceIndex).forEach(function (n) {
          var k = fold(n);
          if (k && !faceFolded[k]) faceFolded[k] = faceIndex[n];
        });
      })
      .catch(function () { faceIndex = {}; faceFolded = {}; });
  }

  /* The first tagged player who has a tile. Rumors are often tagged with four
   * names; the card has room for one, and the first tag is the one HoopsHype's
   * own entry leads with. */
  function faceFor(tags) {
    if (!Array.isArray(tags) || !faceIndex) return null;
    for (var i = 0; i < tags.length; i++) {
      var n = String(tags[i] || "").trim();
      if (!n) continue;
      var f = faceIndex[n] || faceFolded[fold(n)];
      if (f) return { name: n, url: "data/faces/" + f };
    }
    return null;
  }

  /* How many of the hundred reach the feed. The whole set would swamp a tab
   * that also carries archive cards, and the engine spaces them out anyway. */
  var MAX_CARDS = 25;

  /* How many of those 25 come from the archive rather than the last hundred.
   * Roughly half: recent rumors are why someone opens the tab, and the ones
   * from ten years ago are why they keep scrolling. Either source can come
   * back empty and the other fills the gap. */
  var OTD_CARDS = 12;

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
    var who = faceFor(entry.tags);
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
        years_ago: onThisDay && year ? Math.max(0, thisYear - year) : 0,
        /* Both undefined when no tag resolved. cards.js reads p.face as the
         * whole test for whether the card gets a face column at all. */
        player: who ? who.name : null,
        face: who ? who.url : null
      }
    };
  }

  /* LOCAL date, not UTC, and the endpoint is asked for it explicitly.
   *
   * The Worker defaults to the UTC day when no date is given, which is wrong
   * for a reader west of UTC: at 8pm in Los Angeles it is already tomorrow in
   * UTC, and they would be shown a day they have not reached. Sending the
   * browser's own month and day costs one query parameter and makes "on this
   * day" mean the reader's day.
   *
   * This function was written months ago and left unused while the feature was
   * deferred, with a note saying it encoded a decision worth not making twice.
   * That turned out to be right. */
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

  /* One source, filtered and shuffled. Used for both endpoints, which answer
   * with the same shape: a bare array of entries. */
  function usableFrom(rows, bl, label) {
    if (!Array.isArray(rows)) {
      /* Anything but an array means the Worker changed shape, and rendering
       * nothing is better than rendering whatever a changed payload happens
       * to contain. */
      console.warn("[doomscroll] rumors " + label + ": expected an array, got " +
        (rows && typeof rows === "object" ? Object.keys(rows).join(",") : typeof rows));
      return [];
    }
    var usable = rows.filter(function (e) {
      return e && e.source_url && e.text && !isBlocked(e, bl);
    });
    /* SHUFFLED, because both endpoints return the same entries to everyone
     * until the archive updates - and the on-this-day bucket does not change
     * at all for a whole day. Without this the tab is identical on every
     * visit, which is the opposite of what a feed is for. Fisher-Yates over a
     * copy: the caller's array is not ours. */
    var pool = usable.slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    return pool;
  }

  /* Returns rumor cards, or an empty array if the archive is not reachable.
   * Never throws: the Rumors tab keeps its sample cards on any failure.
   *
   * TWO SOURCES, INDEPENDENTLY FALLIBLE. /latest is the last hundred entries;
   * /on-this-day is up to thirty from this calendar day across every year of
   * the archive. They are fetched separately and each failure is caught on its
   * own, so a broken on-this-day leaves the tab exactly as it was before this
   * existed rather than emptying it. */
  function load() {
    /* The face index is fetched alongside the blocklist, not after it, and its
     * failure is already swallowed inside loadFaces - a missing tile set costs
     * the cards their headshots, never their content. */
    return Promise.all([loadBlocklist(), loadFaces()]).then(function (got) {
      var bl = got[0];
      var day = todayMd();

      var recent = fetchJson(LATEST_URL).then(function (rows) {
        return usableFrom(rows, bl, "latest");
      }).catch(function (e) {
        console.warn("[doomscroll] recent rumors unavailable:", e.message);
        return [];
      });

      var archive = fetchJson(ON_THIS_DAY_URL + "?date=" + day).then(function (rows) {
        return usableFrom(rows, bl, "on-this-day");
      }).catch(function (e) {
        console.warn("[doomscroll] on-this-day unavailable:", e.message);
        return [];
      });

      return Promise.all([recent, archive]).then(function (both) {
        var recentPool = both[0], archivePool = both[1];

        var fromArchive = archivePool.slice(0, OTD_CARDS).map(function (e, i) {
          return toCard(e, "otd" + i, true);
        });
        /* Whatever the archive did not fill comes from the recent set, so a
         * thin day still returns a full tab. */
        var want = MAX_CARDS - fromArchive.length;
        var fromRecent = recentPool.slice(0, want).map(function (e, i) {
          return toCard(e, i, false);
        });

        var cards = fromRecent.concat(fromArchive);
        console.info("[doomscroll] rumors: " + cards.length + " cards - " +
          fromRecent.length + " recent, " + fromArchive.length +
          " from " + day + " across the archive");
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
