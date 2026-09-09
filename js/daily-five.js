/* NBA Doomscroll — the Daily Five.
 *
 * Five questions a day, the same five for everyone, so two people can compare.
 * The result posts as a spoiler-free emoji grid.
 *
 * THAT GRID IS THE POINT. Wordle did not spread because the game was good — it
 * spread because the result was postable without ruining it for the reader.
 * Everything else here is in service of producing five squares that say how you
 * did and nothing about what the questions were.
 *
 * THE FIVE ARE CHOSEN FROM THE DATE ALONE. A hash of "day + card id" ranks
 * every eligible card and the five lowest win, so every device computes the
 * same five without a server, a build step or a schedule file. It also means
 * yesterday's five can shift if the pools are rebuilt between then and now —
 * true, and it does not matter: the Daily Five is a today thing, shared the day
 * it is played. What must never shift is TODAY's five between opening the tab
 * in the morning and finishing at night, and a pool rebuild is a deploy, which
 * is a reload, which is a fresh set only if Jorge ships mid-play.
 *
 * WHAT IT DOES NOT DO: score anything itself. The five are ordinary quiz,
 * trivia and ballot cards from the ordinary pools, answered through the
 * ordinary handlers, and js/scoreboard.js counts them like any other answer.
 * This only remembers WHICH cards today asked and how each went.
 */
(function (root) {
  "use strict";

  var KEY = "doom.daily.v1";
  var SIZE = 5;
  /* Quiz, trivia and ballot: the three pools that already take an answer and
   * know whether it was right. Guess-the-year and the trade verdict slot in
   * here when they exist, without anything else changing. */
  var TYPES = { quiz: 1, trivia: 1, ballot: 1 };

  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" +
      ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
      ("0" + d.getDate()).slice(-2);
  }

  /* FNV-1a, 32-bit. Small, dependency-free, and identical in every browser —
   * which is the whole requirement, since two people must derive the same five
   * from the same string. Math.random with a seed would not be: the seeding is
   * not part of the language. */
  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /** Today's five, from a pool of candidate cards.
   *
   * Sorted by hash, then by id as a tie-break so the order cannot depend on the
   * order the pools happened to load in.
   *
   * ONE OF EACH TYPE FIRST, then the best of the rest. Five quiz cards would be
   * a quiz, not a mix, and the mix is what makes the grid worth reading.
   */
  function pick(cards, day, size) {
    var n = size || SIZE;
    var d = day || dayKey();
    var eligible = (cards || []).filter(function (c) {
      return c && c.id && TYPES[c.type] && !c.dummy;
    });
    if (!eligible.length) return [];

    var ranked = eligible.map(function (c) {
      return { card: c, h: hash(d + "|" + c.id) };
    }).sort(function (a, b) {
      return (a.h - b.h) || (a.card.id < b.card.id ? -1 : 1);
    });

    var out = [], taken = {}, seenType = {};
    var i;
    for (i = 0; i < ranked.length && out.length < n; i++) {
      var c = ranked[i].card;
      if (seenType[c.type]) continue;
      seenType[c.type] = 1; taken[c.id] = 1; out.push(c);
    }
    for (i = 0; i < ranked.length && out.length < n; i++) {
      if (!taken[ranked[i].card.id]) { taken[ranked[i].card.id] = 1; out.push(ranked[i].card); }
    }
    return out;
  }

  /* ---------------- what the reader has done today ---------------- */

  function read() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      var d = raw ? JSON.parse(raw) : null;
      if (!d || typeof d !== "object" || !d.day) return null;
      return d;
    } catch (e) { return null; }
  }

  function write(d) {
    try { root.localStorage.setItem(KEY, JSON.stringify(d)); return true; }
    catch (e) { return false; }
  }

  /** The run for `day`, starting a fresh one when the stored run is older.
   *  Only ever one day is kept: yesterday's result is not something anyone
   *  comes back to, and the grid was already shared or it was not. */
  function state(ids, day) {
    var d = day || dayKey();
    var s = read();
    if (!s || s.day !== d) s = { day: d, ids: ids || [], results: [] };
    if (ids && ids.length && s.ids.join() !== ids.join() && !s.results.length) {
      // Same day, but the pool changed before a single answer. Adopt the new set.
      s.ids = ids;
    }
    return s;
  }

  /** Record how one of today's cards went. Ignores anything not in today's set,
   *  and ignores a repeat — the feed loops, and a second pass at the same card
   *  must not overwrite the first result or extend the run past five. */
  function answered(id, correct, ids, day) {
    var s = state(ids, day);
    if (s.ids.indexOf(id) < 0) return s;
    if (s.results.some(function (r) { return r.id === id; })) return s;
    s.results.push({ id: id, correct: !!correct });
    write(s);
    return s;
  }

  function done(s) { return !!s && s.results.length >= s.ids.length && s.ids.length > 0; }

  function score(s) {
    return (s && s.results || []).filter(function (r) { return r.correct; }).length;
  }

  /** The next unanswered card in today's order, or null when the run is over.
   *  Order follows `ids`, not the order they were answered, so the grid always
   *  reads left to right as the questions were posed. */
  function current(s) {
    if (!s) return null;
    for (var i = 0; i < s.ids.length; i++) {
      var id = s.ids[i];
      if (!s.results.some(function (r) { return r.id === id; })) return { id: id, index: i };
    }
    return null;
  }

  /** The grid. Five squares in the order the questions were asked, and NOTHING
   *  else — no answers, no player names, no question text. That is what makes
   *  it postable the day it is played. */
  function grid(s) {
    if (!s) return "";
    var by = {};
    (s.results || []).forEach(function (r) { by[r.id] = r.correct; });
    return (s.ids || []).map(function (id) {
      if (!(id in by)) return "⬜";
      return by[id] ? "🟩" : "🟥";
    }).join("");
  }

  /** What gets posted. Deliberately carries the DATE, so a grid in a timeline
   *  is anchored to the day it belongs to rather than floating. */
  function shareText(s) {
    if (!s) return "";
    return "NBA Doomscroll · Daily Five · " + s.day + "\n" +
      grid(s) + "  " + score(s) + "/" + (s.ids.length || SIZE);
  }

  function reset() {
    try { root.localStorage.removeItem(KEY); return true; } catch (e) { return false; }
  }

  root.DailyFive = {
    pick: pick, state: state, answered: answered, done: done, score: score,
    current: current, grid: grid, shareText: shareText, reset: reset,
    dayKey: dayKey, hash: hash, SIZE: SIZE, TYPES: TYPES, KEY: KEY
  };
})(typeof window !== "undefined" ? window : this);
