/* NBA Doomscroll — shared VS scorer
 *
 * Replays the award rules of performComparison() (js/compare-core.js) over
 * PRE-RESOLVED metric values instead of the raw ~27MB stat tables.
 *
 * Used by both sides so a pre-generated card and a live in-browser matchup can
 * never disagree:
 *   - tools/build_data.mjs when generating data/vs-pool.json
 *   - js/live-vs.js for the "Random matchup" button
 *
 * tools/build_data.mjs verifies this against the real CompareCore on a random
 * sample every build and fails the build on any mismatch, so the shortcut
 * stays honest if the comparison tool's logic ever changes.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.VsScore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var ALWAYS_AWARD = ["ACCOLADES", "BEST AWARDS RANKING", "YEARS RECEIVING VOTES", "SIGNATURE SHOES", "PLAYOFF SUCCESS"];
  var REQUIRE_BOTH = ["SALARIES", "NBA 2K"];
  var EXCLUDE_OVERALL = ["DRAFT COMBINE"];
  var UNTRACKED_SECTIONS = ["NBA CAREER AVERAGES", "NBA CAREER TOTALS", "NBA SEASON PEAK"];
  var UNTRACKED_CATS = ["steals", "steal", "blocks", "block", "turnovers", "turnover", "three", "3p", "stl", "blk", "tov"];

  var MAIN_SECTIONS = [
    ["ACCOLADES", "Accolades"],
    ["NBA CAREER AVERAGES", "Career averages"],
    ["NBA CAREER TOTALS", "Career totals"],
    ["NBA SEASON PEAK", "Season peaks"]
  ];

  /* Headline metrics for "biggest wins", keyed SECTION::metric. Section
   * scoping matters: "Most Valuable Player" is an award count in ACCOLADES
   * but a vote RANK in BEST AWARDS RANKING. */
  var HEADLINE = {
    "ACCOLADES::NBA Champion": "championships",
    "ACCOLADES::Most Valuable Player": "MVPs",
    "ACCOLADES::Finals MVP": "Finals MVPs",
    "ACCOLADES::All-NBA Selections": "All-NBA selections",
    "ACCOLADES::All-Star": "All-Star selections",
    "ACCOLADES::Defensive Player of the Year": "DPOY awards",
    "ACCOLADES::All-Defensive Team Selections": "All-Defensive selections",
    "NBA CAREER AVERAGES::Points per game": "career PPG",
    "NBA CAREER AVERAGES::Rebounds per game": "career RPG",
    "NBA CAREER AVERAGES::Assists per game": "career APG",
    "NBA CAREER TOTALS::Points": "career points",
    "NBA CAREER TOTALS::Rebounds": "career rebounds",
    "NBA CAREER TOTALS::Assists": "career assists",
    "NBA CAREER TOTALS::Games": "career games",
    "NBA SEASON PEAK::Points per game peak": "peak PPG",
    "NBA SEASON PEAK::Rebounds per game peak": "peak RPG",
    "NBA SEASON PEAK::Assists per game peak": "peak APG",
    "SALARIES::Career earnings": "career earnings",
    "SALARIES::Highest salary": "top salary"
  };

  // identical to parseNumericValue() in compare-core.js
  function parseNum(value) {
    if (!value) return NaN;
    var s = String(value);
    var fi = s.match(/(\d+)'\s*([\d.]+)['"]+/);
    if (fi) return parseFloat(fi[1]) * 12 + parseFloat(fi[2]);
    return parseFloat(s.replace(/[$,]/g, ""));
  }

  function isZero(raw, n) {
    if (n === 0) return true;
    var s = String(raw).trim();
    if (s === "0" || s === "0.0" || s === "0.00") return true;
    return parseFloat(s) === 0;
  }

  function fmt(v) {
    if (v === null || v === undefined) return "0";
    var s = String(v);
    if (s.charAt(0) === "$") return s;
    var n = parseFloat(s.replace(/[$,%]/g, ""));
    if (isNaN(n)) return s;
    if (Math.abs(n) >= 10000) return Math.round(n).toLocaleString("en-US");
    return s;
  }

  /* metrics: [{sec, cat, win, src}] in comparisons.json order
   * A / B: { metricIndex: value } maps produced by CompareCore.getPlayerStat
   * sink: OPTIONAL array. Every metric that awards a point is pushed onto it as
   *   {sec, cat, a, b, winner}, in comparisons.json order.
   *
   * The sink exists so the Comparison card can reveal the scoreline being built
   * one metric at a time and still end on the number this function returns.
   * Deriving those rows separately would mean a second copy of the award rules
   * above — the untracked-stat guard, the always-award sections, the
   * require-both ones — and two copies drift. Callers passing three arguments
   * are unaffected. */
  function score(metrics, A, B, sink) {
    var p1 = 0, p2 = 0, sections = {}, wins = { player1: [], player2: [] };

    for (var i = 0; i < metrics.length; i++) {
      var m = metrics[i];
      if (!sections[m.sec]) sections[m.sec] = { player1: 0, player2: 0 };
      var av = A[i] === undefined ? null : A[i];
      var bv = B[i] === undefined ? null : B[i];
      var alwaysAward = ALWAYS_AWARD.indexOf(m.sec) >= 0;
      var requireBoth = REQUIRE_BOTH.indexOf(m.sec) >= 0 || EXCLUDE_OVERALL.indexOf(m.sec) >= 0;
      var winner = "tie", award = false;

      if (av !== null && bv !== null) {
        var an = parseNum(av), bn = parseNum(bv);
        if (!isNaN(an) && !isNaN(bn)) {
          if (m.win === "Most") {
            if (an > bn) { winner = "player1"; award = true; }
            else if (bn > an) { winner = "player2"; award = true; }
          } else if (m.win === "Least") {
            if (an < bn) { winner = "player1"; award = true; }
            else if (bn < an) { winner = "player2"; award = true; }
          }
          if (award && UNTRACKED_SECTIONS.indexOf(m.sec) >= 0) {
            var cat = String(m.cat).toLowerCase();
            var untracked = UNTRACKED_CATS.some(function (c) { return cat.indexOf(c) >= 0; });
            if (untracked && (isZero(av, an) || isZero(bv, bn))) { award = false; winner = "tie"; }
          }
        }
      } else if (alwaysAward && !requireBoth) {
        if (av !== null && bv === null && parseNum(av) > 0) { winner = "player1"; award = true; }
        else if (bv !== null && av === null && parseNum(bv) > 0) { winner = "player2"; award = true; }
      }

      if (!award) continue;
      sections[m.sec][winner]++;
      if (EXCLUDE_OVERALL.indexOf(m.sec) < 0) { if (winner === "player1") p1++; else p2++; }
      if (sink) {
        sink.push({
          sec: m.sec, cat: m.cat, winner: winner,
          a: av === null ? null : fmt(av),
          b: bv === null ? null : fmt(bv),
          /* DRAFT COMBINE awards a section point but not an overall one, so a
           * reveal that counted it would outrun the final score. */
          counts: EXCLUDE_OVERALL.indexOf(m.sec) < 0
        });
      }

      var label = HEADLINE[m.sec + "::" + m.cat];
      if (label && m.win === "Most") {
        var wRaw = winner === "player1" ? av : bv;
        var lRaw = winner === "player1" ? bv : av;
        var wv = parseNum(wRaw);
        var lv = lRaw === null ? 0 : (parseNum(lRaw) || 0);
        if (wv > 0) {
          wins[winner].push({
            stat: label,
            val: fmt(wRaw) + " vs " + fmt(lRaw === null ? 0 : lRaw),
            margin: lv > 0 ? wv / lv : wv + 1
          });
        }
      }
    }

    return { p1: p1, p2: p2, sections: sections, wins: wins };
  }

  function topWins(list, who) {
    return list.slice().sort(function (a, b) { return b.margin - a.margin; }).slice(0, 2)
      .map(function (w) { return { who: who, stat: w.stat, val: w.val }; });
  }

  /* Build the card payload shared by pre-generated and live matchups. */
  function payload(nameA, nameB, metaA, metaB, r) {
    var winner = r.p1 >= r.p2 ? nameA : nameB;
    return {
      p1: { name: nameA, img: metaA.img, team: metaA.team, score: r.p1 },
      p2: { name: nameB, img: metaB.img, team: metaB.team, score: r.p2 },
      headline: winner + " takes it " + Math.max(r.p1, r.p2) + "-" + Math.min(r.p1, r.p2),
      sections: MAIN_SECTIONS.map(function (s) {
        var sc = r.sections[s[0]] || { player1: 0, player2: 0 };
        return { label: s[1], p1: sc.player1, p2: sc.player2 };
      }),
      biggest_wins: topWins(r.wins.player1, "p1").concat(topWins(r.wins.player2, "p2")),
      compare_url: "https://hoopsmatic.com/compare?p1=" + encodeURIComponent(nameA) +
                   "&p2=" + encodeURIComponent(nameB)
    };
  }

  return { score: score, payload: payload, MAIN_SECTIONS: MAIN_SECTIONS };
});
