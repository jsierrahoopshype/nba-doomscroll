/* NBA Doomscroll — the editorial blocklist
 *
 * THE RUMORS ARE GONE (Oct 2026). This file used to fetch live rumors and the
 * "on this day" rumor picks from the rumors archive API in the reader's
 * browser. That code, the API address and the Rumors tab were removed: the
 * page makes no calls to the rumors API. (Before that, Sept 2026, they were
 * only switched off by RUMORS_ON in js/app.js.)
 *
 * What stays is the editorial blocklist (data/rumor-blocklist.json) and its
 * matcher, because the Buzz tab filters third-party headlines through it
 * (js/buzz.js, LiveRumors.editorialFilter). load() is kept and resolves to no
 * cards without fetching anything, so nothing that still names it breaks.
 */
(function (root) {
  "use strict";

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

  /* The Buzz tab carries third-party headlines and post text, which needs the
   * same editorial filter the rumors had. Exposed rather than copied so the
   * two cannot drift apart: one blocklist, one matcher, two callers.
   *
   * Resolves to a predicate over free text; rejects when the blocklist is
   * unreachable, so a caller fails closed. */
  function editorialFilter() {
    return loadBlocklist().then(function (bl) {
      return function (text) { return isBlocked({ text: String(text || "") }, bl); };
    });
  }

  /* No rumors are loaded any more: see the top of this file. */
  function load() { return Promise.resolve([]); }

  root.LiveRumors = { load: load, editorialFilter: editorialFilter };
})(window);
