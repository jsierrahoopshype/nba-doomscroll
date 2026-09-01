/* NBA Doomscroll — media coordinator
 *
 * One arbiter for everything that moves: the four canvas players (bar races,
 * Teammates, Comparison, Media Lean) and the video sources (Bluesky today,
 * YouTube and Reddit when they land).
 *
 * WHY THIS EXISTS
 *
 * Each of those had its own IntersectionObserver and its own idea of what
 * should be playing, and neither knew the other existed. Scroll to a point
 * where a race card and a Bluesky clip are both on screen and both ran: two
 * things animating at once, one of them pulling video down a mobile
 * connection. Neither observer was wrong on its own terms; there was simply
 * nobody deciding between them.
 *
 * So registration is the contract, not playback. A card hands over a handle
 * and says how visible it is; this decides which single handle is allowed to
 * move. Callers never call play() on their own except when a person asked.
 *
 * THE RULES, in the order they are applied
 *
 *  1. A person's decision outranks the algorithm, in both directions. Pausing
 *     something means it stays paused: scrolling away and back must not undo a
 *     deliberate pause, which is the behaviour that makes autoplay feel like it
 *     is arguing with you. Starting something means it keeps playing while it
 *     is on screen at all, even if something better centred appears.
 *  2. Only one thing moves. Ever.
 *  3. The winner is the eligible item nearest the middle of the viewport,
 *     because that is the one being looked at — not whichever crossed a
 *     threshold most recently.
 *  4. Eligible means at least VISIBLE of it is on screen. Below that it pauses
 *     and keeps its position, so scrolling back resumes rather than restarts.
 *  5. Reduced motion or reduced data means nothing autoplays at all. Both are
 *     requests to stop moving things without being asked, and a muted video is
 *     still both motion and megabytes. A person can still press play.
 */
(function (global) {
  "use strict";

  /* 0.6 rather than something lower: at 0.35 a card only a third on screen
   * could take playback from the one filling the middle of it. */
  var VISIBLE = 0.6;

  function mq(q) {
    try { return global.matchMedia ? global.matchMedia(q) : { matches: false }; }
    catch (e) { return { matches: false }; }
  }

  /* Checked at decision time rather than once at load: a person can change the
   * OS setting with the tab open, and Save-Data can flip when a phone moves on
   * to a metered connection. */
  function prefersQuiet() {
    if (mq("(prefers-reduced-motion: reduce)").matches) return true;
    if (mq("(prefers-reduced-data: reduce)").matches) return true;
    var c = global.navigator && global.navigator.connection;
    return !!(c && c.saveData);
  }

  /* el -> {
   *   handle: { kind, play(), pause(), isPlaying() },
   *   ratio:  how much of it is on screen, 0-1
   *   intent: "" | "play" | "pause"   what the person asked for, if anything
   * } */
  var items = new Map();
  var active = null;             // the one element allowed to move
  var scheduled = false;

  function entry(el) { return items.get(el); }

  function pauseEl(el) {
    var it = items.get(el);
    if (!it) return;
    try { it.handle.pause(); } catch (e) { /* teardown races */ }
  }

  function playEl(el) {
    var it = items.get(el);
    if (!it) return false;
    try { it.handle.play(); return true; } catch (e) { return false; }
  }

  function centreDistance(el) {
    var box = el.getBoundingClientRect();
    return Math.abs((box.top + box.bottom) / 2 - global.innerHeight / 2);
  }

  /* Deferred to a frame so a burst of IntersectionObserver entries - which is
   * what a fast scroll produces - resolves to one decision rather than one per
   * entry, each of which would start and immediately stop a player. */
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    var run = global.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
    run(function () { scheduled = false; settle(); });
  }

  function settle() {
    // Drop anything the feed has removed from under us.
    items.forEach(function (it, el) { if (!el.isConnected) items.delete(el); });
    if (active && !items.has(active)) active = null;

    var quiet = prefersQuiet();
    var best = null, bestDist = Infinity, held = null;

    items.forEach(function (it, el) {
      if (it.intent === "pause") return;              // rule 1: stays paused
      var onScreen = it.ratio > 0;
      // Rule 1 again, the other way: something a person started keeps playing
      // while any of it is visible, even off-centre.
      if (it.intent === "play" && onScreen) { held = el; return; }
      if (quiet) return;                              // rule 5
      if (it.ratio < VISIBLE) return;                 // rule 4
      var d = centreDistance(el);
      if (d < bestDist) { bestDist = d; best = el; }
    });

    var want = held || best;                          // a held item outranks the centred one

    if (active && active !== want) { pauseEl(active); active = null; }
    if (want && active !== want) { if (playEl(want)) active = want; }
  }

  /* handle: { kind, play, pause, isPlaying }
   * Registering does not start anything. Callers that used to call play()
   * themselves on intersect should now register and report visibility. */
  function register(el, handle) {
    if (!el || !handle) return;
    var prev = items.get(el);
    items.set(el, { handle: handle, ratio: prev ? prev.ratio : 0, intent: prev ? prev.intent : "" });
  }

  function unregister(el) {
    if (active === el) { pauseEl(el); active = null; }
    items.delete(el);
  }

  // Visibility report from whatever observer the caller already runs.
  function note(el, ratio) {
    var it = items.get(el);
    if (!it) return;
    it.ratio = ratio;
    // Leaving the screen entirely also releases a manual play: a person who
    // started something and scrolled past it has not asked for it to be
    // playing when they come back an hour later. A manual PAUSE is stickier
    // and survives, because undoing one is the annoying failure.
    if (ratio === 0 && it.intent === "play") it.intent = "";
    schedule();
  }

  /* A person pressed play. Gives this item priority and clears any earlier
   * pause on it. */
  function manualPlay(el) {
    var it = items.get(el);
    if (!it) return;
    it.intent = "play";
    if (active && active !== el) { pauseEl(active); active = null; }
    if (playEl(el)) active = el;
  }

  /* A person pressed pause. Nothing may restart this until they say so. */
  function manualPause(el) {
    var it = items.get(el);
    if (!it) return;
    it.intent = "pause";
    pauseEl(el);
    if (active === el) active = null;
    schedule();
  }

  // For a toggle control that does not know which way it is going.
  function manualToggle(el) {
    var it = items.get(el);
    if (!it) return;
    var playing = false;
    try { playing = !!it.handle.isPlaying(); } catch (e) { /* assume stopped */ }
    if (playing) manualPause(el); else manualPlay(el);
  }

  // Clearing the feed detaches elements; anything inside goes with it.
  function releaseIn(container) {
    items.forEach(function (it, el) {
      if (!container || container.contains(el) || !el.isConnected) unregister(el);
    });
  }

  function activeEl() { return active; }
  function count() { return items.size; }

  global.MediaCoordinator = {
    register: register, unregister: unregister, note: note,
    manualPlay: manualPlay, manualPause: manualPause, manualToggle: manualToggle,
    releaseIn: releaseIn, settle: settle, prefersQuiet: prefersQuiet,
    activeEl: activeEl, count: count, VISIBLE: VISIBLE
  };
})(window);
