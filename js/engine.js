/* NBA Doomscroll — personalization engine
 *
 * Simple, transparent, non-ML. Every card carries tags (content_type, players,
 * teams, era, category). User actions adjust per-tag weights in localStorage.
 * Feed sampling = weighted random over tag scores with a fixed exploration
 * slice so the feed never tunnels. Nothing ever leaves the browser.
 */
(function (root) {
  "use strict";

  var STORAGE_KEY = "hm_doomscroll_profile_v1";
  var PROFILE_VERSION = 1;

  // Signal strengths (tuning lives here, nowhere else)
  var SIGNALS = {
    like: 3,
    unlike: -3,       // reversing a like
    save: 3,
    unsave: -3,
    tap: 2,           // tap-through to a full tool
    quiz: 1,          // answered a quiz/trivia card
    skim: -0.5        // fast scroll-past
  };
  var WEIGHT_MIN = -12;
  var WEIGHT_MAX = 24;
  var EXPLORATION = 0.25;      // fraction of feed picks that are fully random
  var SESSION_DECAY = 0.985;   // gentle decay applied once per session start

  function now() { return Date.now(); }

  function blankProfile() {
    return {
      v: PROFILE_VERSION,
      created: now(),
      weights: {},          // tagKey -> number
      liked: [],            // card ids (order = recency)
      saved: [],
      seen: {},             // card id -> last impression ts (bounded)
      counts: { like: 0, save: 0, tap: 0, quiz: 0, skim: 0 },
      onboarded: false,
      lastSession: 0
    };
  }

  var profile = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankProfile();
      var p = JSON.parse(raw);
      if (!p || p.v !== PROFILE_VERSION) return blankProfile();
      // fill any missing fields defensively
      var b = blankProfile();
      Object.keys(b).forEach(function (k) { if (p[k] === undefined) p[k] = b[k]; });
      return p;
    } catch (e) {
      return blankProfile();
    }
  }

  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); }
    catch (e) { /* private mode / quota: engine still works in-memory */ }
  }

  // Called once on boot: light decay so ancient obsessions fade slowly.
  function startSession() {
    var t = now();
    if (t - (profile.lastSession || 0) > 6 * 3600 * 1000) {
      Object.keys(profile.weights).forEach(function (k) {
        profile.weights[k] *= SESSION_DECAY;
        if (Math.abs(profile.weights[k]) < 0.05) delete profile.weights[k];
      });
    }
    profile.lastSession = t;
    // bound the seen map so localStorage never bloats
    var ids = Object.keys(profile.seen);
    if (ids.length > 900) {
      ids.sort(function (a, b) { return profile.seen[a] - profile.seen[b]; });
      ids.slice(0, ids.length - 600).forEach(function (id) { delete profile.seen[id]; });
    }
    persist();
  }

  /* ---------------- tags ---------------- */

  function tagKeys(card) {
    var t = card.tags || {};
    var keys = [];
    if (t.content_type) keys.push("type:" + t.content_type);
    (t.players || []).forEach(function (p) { keys.push("player:" + p); });
    (t.teams || []).forEach(function (tm) { keys.push("team:" + tm); });
    if (t.era) keys.push("era:" + t.era);
    if (t.category) keys.push("cat:" + t.category);
    return keys;
  }

  function bump(card, signal) {
    var delta = SIGNALS[signal];
    if (!delta) return;
    tagKeys(card).forEach(function (k) {
      var w = (profile.weights[k] || 0) + delta;
      profile.weights[k] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, w));
    });
    if (profile.counts[signal] !== undefined) profile.counts[signal]++;
    persist();
  }

  function cardScore(card) {
    var s = 0;
    tagKeys(card).forEach(function (k) { s += profile.weights[k] || 0; });
    return s;
  }

  /* ---------------- actions ---------------- */

  function toggleIn(list, id) {
    var i = list.indexOf(id);
    if (i >= 0) { list.splice(i, 1); return false; }
    list.unshift(id);
    if (list.length > 500) list.pop();
    return true;
  }

  var api = {
    startSession: startSession,

    like: function (card) {
      var on = toggleIn(profile.liked, card.id);
      bump(card, on ? "like" : "unlike");
      return on;
    },
    save: function (card) {
      var on = toggleIn(profile.saved, card.id);
      bump(card, on ? "save" : "unsave");
      return on;
    },
    tap: function (card) { bump(card, "tap"); },
    quizAnswered: function (card) { bump(card, "quiz"); },
    skim: function (card) { bump(card, "skim"); },

    isLiked: function (id) { return profile.liked.indexOf(id) >= 0; },
    isSaved: function (id) { return profile.saved.indexOf(id) >= 0; },
    likedIds: function () { return profile.liked.slice(); },
    savedIds: function () { return profile.saved.slice(); },

    markSeen: function (card) { profile.seen[card.id] = now(); /* persisted lazily by other calls */ },

    /* ------------- onboarding seed ------------- */
    seed: function (selections) {
      // selections: array of tagKeys like "team:LAL", "era:1990s", "player:Name"
      selections.forEach(function (k) {
        profile.weights[k] = Math.min(WEIGHT_MAX, (profile.weights[k] || 0) + 4);
      });
      profile.onboarded = true;
      persist();
    },
    needsOnboarding: function () { return !profile.onboarded; },
    skipOnboarding: function () { profile.onboarded = true; persist(); },

    /* ------------- feed sampling ------------- */
    /* Type-balanced sampling for the For You mix.
     * Sampling the whole pool uniformly lets the biggest pools dominate — with
     * ~2,000 VS cards against ~40 trades, a plain draw is nearly all VS. So a
     * content_type is chosen per slot first (weighted by that type's learned
     * score), then a card is drawn from within that type. Types the user
     * dislikes fade out, but nothing disappears entirely.
     */
    sampleMixed: function (pool, n, opts) {
      var caps = (opts && opts.cap) || {};
      var used = {};
      var buckets = {};
      pool.forEach(function (c) {
        var t = (c.tags && c.tags.content_type) || c.type || "other";
        (buckets[t] || (buckets[t] = [])).push(c);
      });
      var types = Object.keys(buckets);
      if (types.length < 2) return api.sample(pool, n);

      var out = [];
      var lastType = null;
      for (var i = 0; i < n && types.length; i++) {
        // weight each type by its learned score, damped so one hot type can't
        // monopolise the feed, and never twice in a row when alternatives exist
        var free = types.filter(function (t) {
          return buckets[t].length && !(caps[t] && (used[t] || 0) >= caps[t]);
        });
        var choices = free.filter(function (t) { return t !== lastType || free.length === 1; });
        if (!choices.length) choices = free;
        if (!choices.length) break;
        var weights = choices.map(function (t) {
          var w = profile.weights["type:" + t] || 0;
          var learned = Math.exp(Math.max(-2, Math.min(2, w / 8)));
          // A type with only a handful of cards cannot carry a full 1/N share
          // without repeating itself, so thin pools are damped until they grow.
          var depth = Math.min(1, buckets[t].length / 12);
          return learned * depth;
        });
        var total = weights.reduce(function (a, b) { return a + b; }, 0);
        var r = Math.random() * total, idx = 0;
        while (idx < choices.length - 1 && (r -= weights[idx]) > 0) idx++;
        var type = choices[idx];
        var picked = api.sample(buckets[type], 1)[0];
        if (!picked) { buckets[type] = []; i--; continue; }
        buckets[type] = buckets[type].filter(function (c) { return c !== picked; });
        out.push(picked);
        used[type] = (used[type] || 0) + 1;
        lastType = type;
      }
      return out;
    },

    // pool: candidate cards. n: how many to return. Weighted random without
    // replacement, EXPLORATION share fully random, recently-seen demoted.
    sample: function (pool, n) {
      var t = now();
      var candidates = pool.slice();
      var picked = [];
      // freshness demotion: seen in last 20 min gets a big penalty
      function effWeight(card) {
        var base = Math.exp(Math.min(6, cardScore(card) / 6)); // soft, bounded
        var last = profile.seen[card.id];
        if (last && t - last < 20 * 60 * 1000) base *= 0.08;
        else if (last) base *= 0.55;
        return base;
      }
      while (picked.length < n && candidates.length) {
        var idx;
        if (Math.random() < EXPLORATION) {
          idx = Math.floor(Math.random() * candidates.length);
        } else {
          var weights = candidates.map(effWeight);
          var total = weights.reduce(function (a, b) { return a + b; }, 0);
          var r = Math.random() * total;
          idx = 0;
          while (idx < candidates.length - 1 && (r -= weights[idx]) > 0) idx++;
        }
        picked.push(candidates.splice(idx, 1)[0]);
      }
      return picked;
    },

    /* ------------- stats panel ------------- */
    stats: function () {
      var entries = Object.keys(profile.weights).map(function (k) {
        return { key: k, w: profile.weights[k] };
      });
      entries.sort(function (a, b) { return b.w - a.w; });
      return {
        top: entries.filter(function (e) { return e.w > 0.2; }).slice(0, 8),
        bottom: entries.filter(function (e) { return e.w < -0.2; }).slice(-8).reverse(),
        counts: profile.counts,
        nLiked: profile.liked.length,
        nSaved: profile.saved.length,
        nTags: entries.length,
        created: profile.created
      };
    },

    /* ------------- data controls ------------- */
    exportProfile: function () {
      return JSON.stringify({ app: "nba-doomscroll", exported: new Date().toISOString(), profile: profile }, null, 2);
    },
    importProfile: function (text) {
      var data = JSON.parse(text); // throws on bad input; caller catches
      var p = data && data.profile;
      if (!p || p.v !== PROFILE_VERSION || typeof p.weights !== "object") {
        throw new Error("Not a valid NBA Doomscroll profile file.");
      }
      profile = p;
      var b = blankProfile();
      Object.keys(b).forEach(function (k) { if (profile[k] === undefined) profile[k] = b[k]; });
      persist();
    },
    resetAlgorithm: function () {
      profile.weights = {};
      profile.seen = {};
      persist();
    },
    deleteAll: function () {
      profile = blankProfile();
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    }
  };

  root.DoomEngine = api;
})(window);
