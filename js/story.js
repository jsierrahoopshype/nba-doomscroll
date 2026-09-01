/* NBA Doomscroll — story keys and quality, for the pools that carry neither.
 *
 * The engine already knows how to space a feed out: js/engine.js demotes a card
 * whose `story_key` was just shown (0.06x), one from the same `story_family`
 * (0.45x), and weights by `quality_score`. Only the oddity, salary and
 * frivolities builders emit any of that, so five card types out of nine were
 * weighted at parity and spaced by their player tags alone.
 *
 * WHY THIS RUNS IN THE BROWSER RATHER THAN IN THE BUILDERS
 *
 * Three of these pools (VS, quiz, trivia, ballot) are rewritten by a weekly job
 * that knows nothing about this file, and the rest are rebuilt from local
 * sources on Jorge's machine. Anything written into the JSON by a builder is
 * one refresh away from being dropped. Deriving it at load time costs a few
 * milliseconds over ~7,000 cards, cannot be lost, and keeps one implementation
 * instead of six.
 *
 * A value a builder DID set always wins. This only fills gaps.
 *
 * THE POINT OF story_key: the same subject reaches the feed through several
 * formats. An award-season is a race, a ballot oddity AND a trivia question, so
 * all three are keyed into one namespace - "ballot|MVP|2015-16|Stephen Curry" -
 * and the feed stops telling one story three ways in a screen. The award
 * vocabularies disagreed (ALL_DEF vs alldef vs nothing), so they are normalised
 * onto the one the oddity builder already ships, which is live and must not
 * change.
 *
 * QUALITY IS ONLY SET WHERE A DEFENSIBLE SIGNAL EXISTS. Types with no honest
 * measure of "is this card interesting" are left alone rather than given an
 * invented number: an absent quality_score means the engine applies no
 * multiplier, which is the neutral, correct answer for "we do not know".
 */
(function (root) {
  "use strict";

  /* The vocabulary the oddity builder already ships. Everything normalises
   * onto this, never the other way round. */
  var AWARD = {
    mvp: "MVP", smoy: "SMOY", roy: "ROY", dpoy: "DPOY", coy: "COY",
    mip: "MIP", cpoy: "CPOY", alldef: "ALL_DEF", allnba: "ALL_NBA",
    allrookie: "ALL_ROOKIE"
  };
  function award(token) {
    var k = String(token || "").toLowerCase().replace(/[^a-z]/g, "");
    return AWARD[k] || String(token || "").toUpperCase();
  }

  function clamp01(n) { return Math.max(0, Math.min(1, n)); }
  /* Maps a value onto 0..1 between two anchors, so a threshold is stated as
   * the two numbers that matter rather than buried in arithmetic. */
  function ramp(v, lo, hi) {
    if (!Number.isFinite(v) || hi === lo) return null;
    return Math.round(clamp01((v - lo) / (hi - lo)) * 100) / 100;
  }

  /* A pair of players in a stable order, so "A vs B" and "B vs A" are one
   * story rather than two. */
  function pair(a, b) {
    return [String(a || ""), String(b || "")].sort().join(" vs ");
  }

  function derive(card) {
    var p = card.payload || {};
    var t = card.tags || {};
    var players = t.players || [];

    switch (card.type) {

      /* Races. Two quite different things share this type: 121 award-vote
       * races, whose subject is an award-season, and 215 statistical races.
       * They need different keys. */
      case "race": {
        var slug = String(p.slug || "");
        var m = /^ballot-([a-z]+)-(\d{4}-\d{2})$/.exec(slug);
        if (m) {
          return {
            // Shares the oddity and ballot-trivia namespace on purpose.
            story_key: ["ballot", award(m[1]), m[2], p.leader || "-"].join("|"),
            story_family: "ballot:race"
            /* No quality: every award race carries 99-130 ballots, a range too
             * narrow to rank one above another honestly. */
          };
        }
        /* 180 of the 215 statistical races are team races. Keyed on the group
         * so a batch cannot serve five of them and call it variety - which is
         * exactly what a single "race" family allowed. */
        return {
          story_key: "race|" + (slug || (p.title || "")),
          story_family: "race:" + (p.group || "other"),
          /* tier is the builder's own editorial judgement about which races
           * carry the section: 45 flagship, 135 ordinary, 35 marginal. Reusing
           * it beats inventing a second opinion from step counts. */
          quality_score: p.tier === 1 ? 0.9 : p.tier === 3 ? 0.35 : 0.55
        };
      }

      /* Ballot trivia. Same namespace as the races and oddities above: the
       * question, the race and the oddity are one award-season. */
      case "ballot": {
        var subj = (p.subjects || [])[0] || players[0] || "-";
        return {
          story_key: ["ballot", award(p.award_key), p.season || "-", subj].join("|"),
          story_family: "ballot:trivia"
        };
      }

      /* The 54 old-style oddity cards still in the vault pool. Same shape as
       * ballot trivia, so they join the same namespace - which is the whole
       * point, since several of them cover award-seasons the newer oddity
       * builder also covers. */
      case "oddity": {
        var os = (p.subjects || [])[0] || players[0] || "-";
        return {
          story_key: ["ballot", award(p.award_key), p.season || "-", os].join("|"),
          story_family: "ballot:vault-oddity"
        };
      }

      /* On this day. 1,069 of them, and they are the reason the vault pool
       * needs spacing at all: without a family they are simply the biggest
       * pool in the feed. */
      case "otd": {
        if (!p.date || !p.year) return null;
        var round = String(p.label || "").split("·")[0].trim() || "Regular season";
        return {
          story_key: ["otd", p.year, p.date, p.home || "-", p.away || "-"].join("|"),
          story_family: "otd:" + round,
          /* The round is an objective statement of what was at stake, and it
           * is the only such signal on the card. Margin is deliberately not
           * used: it runs 1 to 73 and both ends are interesting, so any
           * one-directional ramp would be a preference pretending to be a
           * measurement. */
          quality_score: /Finals/i.test(round) && /NBA/i.test(round) ? 1
            : /Conf\. Finals/i.test(round) ? 0.75
            : /Semifinals/i.test(round) ? 0.55
            : /First Round/i.test(round) ? 0.4
            : /All-Star/i.test(round) ? 0.45
            : /Playoffs/i.test(round) ? 0.5
            : 0.25
        };
      }

      // Head-to-head formats. The pair IS the story, however it is presented.
      case "compare":
        return {
          story_key: "compare|" + pair((p.a || {}).name, (p.b || {}).name),
          story_family: "compare",
          /* A comparison built from 103 metrics has more to say than one built
           * from 37. Measured range across the pool is 37-103, median 76. */
          quality_score: ramp(p.metrics, 45, 95)
        };

      case "vs":
        return {
          story_key: "vs|" + pair((p.p1 || {}).name, (p.p2 || {}).name),
          story_family: "vs"
        };

      case "mates":
        return {
          story_key: "mates|" + pair((p.a || {}).name, (p.b || {}).name),
          story_family: "mates:" + (t.category || "teammates")
          /* No quality. The gap runs 0 to 148 and neither end is the boring
           * one: a dead heat is a good card and a blowout is a good card, so
           * any single-ended ramp would be a guess dressed as a measure. */
        };

      /* Guess the Player. The answer is the story, so the same player cannot
       * be asked about twice in a screen - which matters more now that the
       * pool is weighted toward obscure players and the same journeyman can
       * be the answer to a question and a distractor in the next one. */
      case "quiz":
        if (!p.answer) return null;
        return {
          story_key: "quiz|" + p.answer,
          story_family: "quiz:" + (t.category || "guess-the-player")
          // quality_score comes from the difficulty tier, set in app.js.
        };

      case "trivia":
        return {
          story_key: "trivia|" + (p.stat || "-") + "|" +
            pair((p.a || {}).name, (p.b || {}).name),
          story_family: "trivia:" + (p.stat || "other"),
          /* A close call is a real question; a 3:1 gap answers itself. */
          quality_score: (function () {
            var a = (p.a || {}).value, b = (p.b || {}).value;
            if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
            var hi = Math.max(a, b), lo = Math.min(a, b);
            if (hi <= 0) return null;
            return ramp(lo / hi, 0.3, 0.95);
          })()
        };

      /* Cap-share cards, whose type is "salary" but which are not the salary
       * builder's output - that one sets its own keys and is left alone by the
       * caller below. */
      case "salary":
        if (!p.player || !p.season) return null;
        return {
          story_key: "capshare|" + p.player + "|" + p.season,
          story_family: "salary:cap-share",
          /* Share of the cap is the whole point of the card. Measured: median
           * 5.9%, p75 48%, max 124% - so the interesting tail starts well
           * above the middle of the pool. */
          quality_score: ramp(p.cap_pct, 5, 60)
        };

      case "lean":
        return {
          story_key: "lean|" + (p.player || players[0] || "-"),
          story_family: "lean",
          /* Two signals, both measured across the 99 cards: how far the
           * biggest booster sits from the panel (2.2 to 22.4, median 6.5) and
           * how many voters stand behind it (17 to 275, median 98). A big lean
           * on a thin electorate is the one to be careful with, so the smaller
           * of the two governs. */
          quality_score: (function () {
            var d = ramp(Math.abs(p.lead_diff), 3, 15);
            var v = ramp(p.voters, 30, 150);
            return d === null || v === null ? d : Math.round(Math.min(d, v) * 100) / 100;
          })()
        };

      default:
        return null;
    }
  }

  /* Fills in what a card is missing. Never overwrites: the oddity, salary and
   * frivolities builders compute better keys than anything derivable here,
   * and a null from derive() means "no honest signal", which must not be
   * written as a number. */
  function annotate(card) {
    if (!card || (card.story_key && typeof card.quality_score === "number")) return card;
    var d = derive(card);
    if (!d) return card;
    if (!card.story_key && d.story_key) card.story_key = d.story_key;
    if (!card.story_family && d.story_family) card.story_family = d.story_family;
    if (typeof card.quality_score !== "number" && typeof d.quality_score === "number") {
      card.quality_score = d.quality_score;
    }
    return card;
  }

  root.DoomStory = { annotate: annotate, derive: derive, award: award };
})(typeof window !== "undefined" ? window : globalThis);
