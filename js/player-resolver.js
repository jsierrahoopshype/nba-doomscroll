/* NBA Doomscroll — does this text actually name this player?
 *
 * ONE implementation, used by the browser (js/buzz.js) and by the Node
 * builders through tools/lib/players.mjs, which loads this very file rather
 * than reimplementing it. Two copies of a rule like this drift, and the drift
 * is invisible until a card goes out with the wrong man's name under a quote.
 *
 * WHY THIS EXISTS
 *
 * Upstream feeds tag entities by loose name match. A post about Jamal CRAWFORD
 * arrived tagged Jamal Murray and the card printed Murray's name under a quote
 * he never said. A Matt Bonner story containing "a paint-ball outing" was
 * tagged LaMelo Ball and asked readers which player it was about, with Bonner's
 * name sitting unredacted in the excerpt.
 *
 * The old guard in js/buzz.js was "the surname appears somewhere in the text",
 * which passes "Thompson" for Klay when the story is about Amen, passes both
 * Gary Paytons, and passes Jaylen Brown for a story about Kobe Brown. In the
 * 607-player roster this ships with, 57 surnames are shared by two or more
 * players. That is not an edge case, it is one name in nine.
 *
 * THE RULE, IN ONE LINE: a name that is not certainly right is not printed.
 *
 * False negatives cost a chip on a card. False positives put a real person's
 * name on words he never said, on a page carrying HoopsHype's name. Those are
 * not comparable, so every ambiguity below resolves toward saying nothing.
 */
(function (root) {
  "use strict";

  /* Surnames that are also ordinary words, especially in basketball prose.
   * "green light", "young players", "rose to the occasion", "out west", "day to
   * day" all match a surname while saying nothing about anybody. For a name on
   * this list the FULL name has to appear.
   *
   * Carried over from tools/build_frivolities.mjs, which learned it the hard
   * way. The length filter it used to rely on said "Ball, Bol collide too
   * easily" and then tested >= 4, which let "ball" straight through. */
  var WORD_SURNAMES = [
    "ball", "banks", "bell", "best", "bird", "black", "brooks", "brown",
    "cook", "cross", "day", "east", "fields", "ford", "gold", "green", "hill",
    "hood", "king", "land", "lane", "little", "long", "love", "may", "moon",
    "north", "price", "reed", "rice", "rivers", "rose", "sharp", "short",
    "small", "snow", "star", "strong", "swift", "wall", "waters", "wells",
    "west", "white", "wise", "wood", "young"
  ];

  var SUFFIX = /^(jr|sr|ii|iii|iv|v)$/;

  function fold(s) {
    s = String(s == null ? "" : s);
    if (s.normalize) s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
    return s;
  }

  function words(name) {
    return fold(name).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
      .filter(function (w) { return w && !SUFFIX.test(w); });
  }

  function surnameOf(name) {
    var w = words(name);
    return w.length ? w[w.length - 1] : "";
  }

  function firstOf(name) {
    var w = words(name);
    return w.length ? w[0] : "";
  }

  /* The haystack, folded and padded so a whole-word test is an indexOf on
   * spaces. Kept separate from the original text because the ORIGINAL is still
   * needed to tell "Green" from "green" - capitalisation is the only signal
   * separating a surname from an adjective. */
  function hay(text) {
    return " " + fold(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() + " ";
  }

  function has(h, term) {
    return !!term && h.indexOf(" " + term + " ") >= 0;
  }

  /** An index over the WHOLE roster, not over one card's candidates.
   *
   * Ambiguity is a property of the league, not of the tags that happened to
   * arrive. If only Klay is tagged, "Thompson" is still ambiguous, because Amen
   * and Ausar exist and the text may be about either. Building this from the
   * candidate list instead would call every collision unique and defeat the
   * whole exercise.
   */
  function buildIndex(roster) {
    var counts = {}, wordSur = {};
    var i;
    for (i = 0; i < WORD_SURNAMES.length; i++) wordSur[WORD_SURNAMES[i]] = 1;
    var names = roster || [];
    for (i = 0; i < names.length; i++) {
      var s = surnameOf(names[i]);
      if (s) counts[s] = (counts[s] || 0) + 1;
    }
    return { counts: counts, wordSurnames: wordSur, size: names.length };
  }

  /* Every capitalised word sitting directly before the surname, in the ORIGINAL
   * text. "Eiza González and Ben Simmons enjoyed dinner" tagged Hugo Gonzalez,
   * because an actress shares his surname; the same rule separates Jeff Green
   * from Draymond Green and Seth from Steph, which no amount of surname
   * matching ever could.
   *
   * Returns what was seen before it: a bare occurrence, his own first name, or
   * somebody else's. */
  function beforeSurname(text, sur, first) {
    var src = fold(text);
    var re = new RegExp("(^|[^A-Za-z0-9'’-])([A-Za-z'’.-]+)?\\s*" + sur + "(?![A-Za-z0-9])", "gi");
    var m, sawBare = false, sawHis = false, sawOther = false;
    while ((m = re.exec(src))) {
      var before = m[2];
      if (!before) { sawBare = true; continue; }
      if (!/^[A-Z]/.test(before)) { sawBare = true; continue; }   // "with Green"
      var w = before.toLowerCase().replace(/[^a-z]/g, "");
      if (!w || SUFFIX.test(w)) { sawBare = true; continue; }
      if (w === first) sawHis = true; else sawOther = true;
    }
    return { bare: sawBare, his: sawHis, other: sawOther };
  }

  /* Years the text commits to. "2019-20" counts as both 2019 and 2020, because
   * a season spans them and a reader means either. */
  function yearsIn(text) {
    var out = [], m;
    var re = /\b(19|20)(\d{2})\b(?:\s*[-–/]\s*(\d{2,4}))?/g;
    var src = String(text || "");
    while ((m = re.exec(src))) {
      var y = parseInt(m[1] + m[2], 10);
      out.push(y);
      if (m[3]) {
        var tail = m[3].length === 2 ? Math.floor(y / 100) * 100 + parseInt(m[3], 10) : parseInt(m[3], 10);
        if (tail > y && tail - y < 30) out.push(tail);
      }
    }
    return out;
  }

  /** Resolve which of `candidates` this text actually names.
   *
   * @param {string} text        the post, headline or excerpt
   * @param {string[]} candidates names the upstream feed proposed
   * @param {object} index        from buildIndex(wholeRoster)
   * @param {object} [opts]       { careers: { "Name": [firstYear, lastYear] } }
   * @returns {{players: string[], rejected: {name: string, why: string}[]}}
   *
   * `rejected` carries the reason so a builder can log what it dropped and why.
   * A filter that silently removes things is a filter nobody can tune.
   */
  function resolve(text, candidates, index, opts) {
    var o = opts || {};
    var careers = o.careers || null;
    var h = hay(text);
    var years = careers ? yearsIn(text) : [];
    var idx = index || buildIndex([]);
    var kept = [], rejected = [];

    (candidates || []).forEach(function (name) {
      if (!name) return;
      var full = words(name).join(" ");
      var sur = surnameOf(name);
      var first = firstOf(name);
      var drop = function (why) { rejected.push({ name: name, why: why }); };

      if (!sur) return drop("no usable surname");

      /* CAREER COMPATIBILITY, before anything else: a text pinned to a year the
       * player never played in is about somebody else however well the letters
       * line up. Only applied when a span is actually known - an absent career
       * must not silently reject everyone. */
      if (careers && years.length && careers[name]) {
        var span = careers[name];
        var ok = years.some(function (y) { return y >= span[0] - 1 && y <= span[1] + 1; });
        if (!ok) return drop("text is dated " + years.join("/") + ", career " + span[0] + "-" + span[1]);
      }

      /* RULE 1: the full name, whole-word. Always enough, and it is the only
       * thing that is enough for an ambiguous or word-like surname. */
      if (has(h, full)) { kept.push(name); return; }

      if (!has(h, sur)) return drop("surname not in the text");

      /* RULE 2: a surname two players share proves nothing on its own. */
      if ((idx.counts[sur] || 0) > 1) return drop("surname shared by " + idx.counts[sur] + " players");

      /* RULE 3: a surname that is also an ordinary word proves nothing either. */
      if (idx.wordSurnames[sur]) return drop("surname is an ordinary word");

      /* RULE 4: a surname that only ever follows somebody else's first name
       * belongs to somebody else. A bare occurrence is how reporters write and
       * still counts. */
      var seen = beforeSurname(text, sur, first);
      if (seen.other && !seen.his && !seen.bare) return drop("surname only ever follows another first name");

      kept.push(name);
    });

    return { players: kept, rejected: rejected };
  }

  root.PlayerResolve = {
    resolve: resolve,
    buildIndex: buildIndex,
    surnameOf: surnameOf,
    fold: fold,
    yearsIn: yearsIn,
    WORD_SURNAMES: WORD_SURNAMES
  };
})(typeof window !== "undefined" ? window : this);
