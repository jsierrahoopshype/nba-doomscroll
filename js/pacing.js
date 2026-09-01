/* NBA Doomscroll — animation pacing
 *
 * One place that decides how long an animation should run, for all five kinds
 * of animated card. Every player used to carry its own TARGET_MS constant, and
 * the result was that a 23-frame Hornets scoring race and an 80-frame all-time
 * race took the same time on screen: the short one crawled, the long one
 * flickered. Replacing one constant with a different constant does not fix
 * that, because the problem is that a constant cannot know how much there is
 * to show.
 *
 * So a duration is derived from the amount of content, inside a band:
 *
 *     target = clamp(min, max, centre * (FLOOR + (1 - FLOOR) * units / ref))
 *
 * `ref` is the median unit count actually measured in this repo's data, so a
 * typical card of each kind lands on its centre and the outliers move toward
 * the edges of the band rather than off a cliff. FLOOR keeps the shortest card
 * from collapsing: at 0.55 a card with no content at all would still ask for
 * 55% of the centre, which the per-step clamp then turns into something
 * readable.
 *
 * The per-step clamp wins over the target, always. If honouring the target
 * would mean 90ms a row, the rows get their minimum instead and the card runs
 * short. Nothing here is allowed to make an animation unreadable in order to
 * hit a number.
 *
 * PRECEDENCE, most specific first:
 *   1. an explicit target_ms on the card or in the data file
 *   2. a named pace profile on the card or in the data file
 *   3. the profile for the player kind
 *
 * That ordering is why award ballot races do not inherit bar-race timing even
 * though they are drawn by the bar-race renderer: they carry pace "ballot".
 */
(function (global) {
  "use strict";

  /* centre  — where a typical card of this kind should land
   * min/max — the band a card may move inside as content grows or shrinks
   * ref     — median units measured across this repo's data on 2026-08-30
   * minStep — the shortest a single unit may be shown and still read
   * maxStep — the longest, before a sparse card feels like it has stalled */
  var PROFILES = {
    /* 65s centre. An all-time race (80 frames) reaches the top of the band;
     * a 23-frame single-franchise race sits near the bottom. */
    race:     { centre: 65000, min: 50000, max: 78000, ref: 52, minStep: 600, maxStep: 3000 },

    /* Award ballot races run on the same renderer and must NOT inherit the
     * above. A ballot race is one number climbing to a known result, not
     * eighty years of history, and 65 seconds of it is a test of patience. */
    ballot:   { centre: 30000, min: 24000, max: 38000, ref: 52, minStep: 200, maxStep: 1200 },

    /* 40-45s. Rows are read one at a time, so a 106-row comparison genuinely
     * needs longer than a 37-row one. maxStep is generous enough that the
     * shortest comparison still clears the bottom of the band. */
    compare:  { centre: 42500, min: 34000, max: 54000, ref: 76, minStep: 260, maxStep: 950 },

    /* 35-45s. Careers with many moves take longer than careers with few. The
     * maxStep deliberately does not stretch far enough to drag an 8-step
     * career up to 35s: four seconds of hold on a two-name scoreboard reads as
     * a stall, and a simple one being shorter is the correct outcome. */
    mates:    { centre: 40000, min: 32000, max: 50000, ref: 17, minStep: 800, maxStep: 3200 },

    /* 30s, same family as the ballot races: this is ballot data too. */
    lean:     { centre: 30000, min: 24000, max: 38000, ref: 25, minStep: 220, maxStep: 1400 }
  };

  var FLOOR = 0.55;

  function clamp(lo, hi, v) { return Math.max(lo, Math.min(hi, v)); }

  function profileFor(name) {
    return PROFILES[name] || PROFILES.race;
  }

  /* units: how many things the reader has to look at — frames, rows, steps.
   * over:  { targetMs, pace } from the card, the data file or mount options.
   *
   * Returns the target it aimed for, the step length it will actually use, and
   * the duration that combination produces, so a test can assert on all three
   * and a caller can tell when the clamp overrode the target. */
  function plan(kind, units, over) {
    over = over || {};
    var name = over.pace || kind;
    var p = profileFor(name);
    var n = Math.max(1, units | 0);

    var target = over.targetMs > 0
      ? over.targetMs
      : clamp(p.min, p.max, Math.round(p.centre * (FLOOR + (1 - FLOOR) * (n / p.ref))));

    var raw = Math.round(target / n);
    var step = clamp(p.minStep, p.maxStep, raw);

    return {
      profile: name,
      units: n,
      targetMs: target,
      stepMs: step,
      durationMs: step * n,
      // true when readability overrode the target, which is expected on the
      // extremes and is the thing a pacing test should report rather than fail
      clamped: step !== raw
    };
  }

  /* Pull pacing hints out of a data file or a card payload without either of
   * them having to know this module exists. Both spellings are accepted
   * because the builders write snake_case into JSON and the DOM hands back
   * camelCase from dataset. */
  function hints(src) {
    if (!src) return {};
    var t = src.target_ms || src.targetMs;
    var pace = src.pace || src.pace_profile || src.paceProfile;
    var out = {};
    if (t && +t > 0) out.targetMs = +t;
    if (pace) out.pace = String(pace);
    return out;
  }

  /* Merge hints, most specific last: profile default < data file < card/mount. */
  function merge() {
    var out = {};
    for (var i = 0; i < arguments.length; i++) {
      var h = hints(arguments[i]);
      if (h.targetMs) out.targetMs = h.targetMs;
      if (h.pace) out.pace = h.pace;
    }
    return out;
  }

  global.Pacing = { plan: plan, hints: hints, merge: merge, profiles: PROFILES };
})(window);
