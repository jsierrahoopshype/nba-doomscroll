/* NBA Doomscroll — live random matchup
 *
 * Scores a fresh matchup in the browser without the ~27MB comparison dataset.
 * data/vs-values.json carries pre-resolved metric values per player (produced
 * by tools/build_data.mjs using the exact getPlayerStat logic of the live
 * comparison tool), so this only has to replay the award rules.
 *
 * Those rules and the card payload shape live in js/vs-score.js, shared with
 * the builder so a live matchup and a pre-generated card can never disagree.
 * The builder verifies that shared scorer against the real comparison engine
 * on every build.
 */
(function (root) {
  "use strict";

  var DATA_URL = "data/vs-values.json";
  var V = root.VsScore;

  var data = null, loading = null, counter = 0;

  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    loading = fetch(DATA_URL).then(function (r) {
      if (!r.ok) throw new Error("vs-values " + r.status);
      return r.json();
    }).then(function (d) {
      data = d;
      data.names = Object.keys(d.players);
      // Cumulative notability weights: a random matchup should lean toward
      // players the reader recognises, not two random rotation guys.
      var cum = [], total = 0;
      data.names.forEach(function (n) {
        total += Math.pow(Math.max(1, d.players[n].n || 1), 1.4);
        cum.push(total);
      });
      data.cum = cum;
      data.cumTotal = total;
      return data;
    });
    return loading;
  }

  function weightedName() {
    var r = Math.random() * data.cumTotal;
    var lo = 0, hi = data.cum.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (data.cum[mid] < r) lo = mid + 1; else hi = mid; }
    return data.names[lo];
  }

  function thin(name) {
    var p = data.players[name];
    return !p || Object.keys(p.v).length < 20;
  }

  function score(a, b) {
    return V.score(data.metrics, data.players[a].v, data.players[b].v);
  }

  function buildCard(nameA, nameB) {
    var r = score(nameA, nameB);
    var a = data.players[nameA], b = data.players[nameB];
    return {
      id: "live-vs-" + (++counter) + "-" + Date.now(),
      type: "vs",
      tab: ["vs"],
      live: true,
      tags: {
        content_type: "vs", players: [nameA, nameB],
        teams: [a.team, b.team].filter(Boolean),
        era: a.era === b.era ? a.era : "all-time",
        category: a.era === b.era ? "comparison" : "cross-era"
      },
      payload: V.payload(nameA, nameB, a, b, r)
    };
  }

  root.LiveVs = {
    ready: load,
    random: function () {
      return load().then(function () {
        var best = null;
        for (var i = 0; i < 30; i++) {
          var a = weightedName(), b = weightedName();
          if (a === b || thin(a) || thin(b)) continue;
          if (!best) best = [a, b];
          // Prefer a matchup that is actually close, but keep the first valid
          // pair as a fallback so the button never spins.
          var probe = score(a, b);
          var hi = Math.max(probe.p1, probe.p2), lo = Math.min(probe.p1, probe.p2);
          if (hi && lo / hi >= 0.5) { best = [a, b]; break; }
        }
        if (!best) throw new Error("no eligible players");
        return buildCard(best[0], best[1]);
      });
    }
  };
})(window);
