/* NBA Doomscroll — Bluesky video autoplay
 *
 * A Bluesky video post publishes an HLS playlist. Safari plays HLS natively;
 * Chrome and Firefox do not, so hls.js (Apache-2.0, vendored in js/vendor,
 * licence alongside it) is loaded — ONCE, and only when a video card is
 * actually about to be seen. A reader who never scrolls past one never pays
 * the 376KB.
 *
 * Rules this follows, in the order they matter:
 *
 *  1. Muted, inline, looping. Sound that starts on its own in a scroll feed is
 *     hostile, and every mobile browser blocks unmuted autoplay anyway.
 *  2. One at a time. The clip nearest the middle of the screen plays; every
 *     other one stops and releases its buffer. Four clips streaming at once on
 *     a phone is somebody's data plan.
 *  3. It stops when it leaves the screen, and the poster comes back.
 *  4. prefers-reduced-motion and prefers-reduced-data both switch it off
 *     entirely. So does Save-Data. The card keeps the poster and the tap.
 *  5. Nothing here is required for the card to work. If hls.js fails to load,
 *     if the playlist 404s, if the browser refuses to play — the poster stays
 *     and tapping still opens the post on Bluesky.
 */
(function (root) {
  "use strict";

  var HLS_SRC = "js/vendor/hls.light.min.js";
  var VISIBLE = 0.6;          // fraction on screen before a clip earns playback
  var hlsPromise = null;

  function prefersQuiet() {
    var mq = root.matchMedia;
    if (!mq) return false;
    if (mq("(prefers-reduced-motion: reduce)").matches) return true;
    // Not universally supported; false when the browser has no opinion.
    if (mq("(prefers-reduced-data: reduce)").matches) return true;
    var c = root.navigator && root.navigator.connection;
    return !!(c && c.saveData);
  }

  function loadHls() {
    if (hlsPromise) return hlsPromise;
    hlsPromise = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = HLS_SRC;
      s.async = true;
      s.onload = function () {
        if (root.Hls && root.Hls.isSupported()) resolve(root.Hls);
        else reject(new Error("hls.js cannot play here"));
      };
      s.onerror = function () { reject(new Error("hls.js failed to load")); };
      document.head.appendChild(s);
    }).catch(function (e) {
      // Remember the failure so every later card fails fast instead of
      // re-fetching 376KB per scroll. The stored rejection gets a no-op
      // handler of its own: without one it surfaces as an unhandled rejection
      // the moment it is created, which is a page error for a condition this
      // code is deliberately tolerating.
      console.warn("[doomscroll] " + e.message + " — video posters stay posters");
      var failed = Promise.reject(e);
      failed.catch(function () {});
      hlsPromise = failed;
      throw e;
    });
    return hlsPromise;
  }

  var current = null;   // the <a.bsky-video> currently playing

  function stop(anchor) {
    if (!anchor) return;
    var v = anchor.querySelector("video");
    if (!v) return;
    try { v.pause(); } catch (e) { /* already gone */ }
    if (v._hls) { try { v._hls.destroy(); } catch (e) { /* ignore */ } v._hls = null; }
    v.removeAttribute("src");
    try { v.load(); } catch (e) { /* ignore */ }
    v.remove();
    anchor.classList.remove("playing");
    if (current === anchor) current = null;
  }

  function play(anchor) {
    if (current === anchor) return;
    stop(current);
    current = anchor;

    var url = anchor.dataset.playlist;
    if (!url) { current = null; return; }

    var v = document.createElement("video");
    v.muted = true;            // set before play() or mobile blocks it outright
    v.defaultMuted = true;
    v.loop = true;
    v.playsInline = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("webkit-playsinline", "");
    v.preload = "none";
    v.tabIndex = -1;
    v.setAttribute("aria-hidden", "true");   // the poster's alt text is the label
    anchor.appendChild(v);
    anchor.classList.add("playing");

    function start() {
      var p = v.play();
      if (p && p.catch) p.catch(function () { stop(anchor); });
    }

    // Safari and iOS play HLS from a plain src; everyone else needs hls.js.
    if (v.canPlayType("application/vnd.apple.mpegurl")) {
      v.src = url;
      start();
      return;
    }
    loadHls().then(function (Hls) {
      // The card may have scrolled away while the library was loading.
      if (current !== anchor || !anchor.isConnected) { stop(anchor); return; }
      var hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 10 });
      v._hls = hls;
      hls.on(Hls.Events.ERROR, function (evt, data) {
        if (data && data.fatal) stop(anchor);
      });
      hls.loadSource(url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, start);
    }).catch(function () { stop(anchor); });
  }

  /* Plays whichever eligible clip is nearest the middle of the viewport, so a
   * feed scrolled to a stop resumes on the card the reader is actually looking
   * at rather than whichever one crossed a threshold last. */
  var candidates = new Map();   // anchor -> intersectionRatio

  function settle() {
    var best = null, bestDist = Infinity;
    var mid = root.innerHeight / 2;
    candidates.forEach(function (ratio, anchor) {
      if (ratio < VISIBLE || !anchor.isConnected) return;
      var box = anchor.getBoundingClientRect();
      var dist = Math.abs((box.top + box.bottom) / 2 - mid);
      if (dist < bestDist) { bestDist = dist; best = anchor; }
    });
    if (best) play(best);
    else stop(current);
  }

  var observer = null;
  function observerFor() {
    if (observer) return observer;
    observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) candidates.set(en.target, en.intersectionRatio);
        else candidates.delete(en.target);
      });
      settle();
    }, { threshold: [0, 0.25, VISIBLE, 0.9] });
    return observer;
  }

  /* Called by app.js for every card as it enters the feed. Safe to call twice
   * on the same element. */
  function watch(cardEl) {
    if (!root.IntersectionObserver || prefersQuiet()) return;
    var vids = cardEl.querySelectorAll ? cardEl.querySelectorAll(".bsky-video[data-playlist]") : [];
    for (var i = 0; i < vids.length; i++) {
      if (vids[i].dataset.watched) continue;
      vids[i].dataset.watched = "1";
      observerFor().observe(vids[i]);
    }
  }

  /* Clearing the feed removes the elements out from under the observer, and a
   * playing <video> inside a detached node keeps its buffer alive. */
  function releaseAll(container) {
    if (current && (!container || container.contains(current))) stop(current);
    candidates.forEach(function (_, anchor) {
      if (!container || container.contains(anchor)) {
        if (observer) observer.unobserve(anchor);
        candidates.delete(anchor);
      }
    });
  }

  root.BskyVideo = { watch: watch, releaseAll: releaseAll };
})(window);
