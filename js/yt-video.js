/* NBA Doomscroll — YouTube playback in the feed.
 *
 * A YouTube buzz card was a title and a thumbnail that sent you to youtube.com.
 * This plays it in place, through the same coordinator that governs the canvas
 * players and Bluesky clips, so one thing moves at a time.
 *
 * NO PLAYER LOADS UNTIL SOMEONE PLAYS
 *
 * The card renders as its own thumbnail with a play button: no iframe, no
 * YouTube script, nothing from youtube.com. The iframe is built on the first
 * play and reused after that.
 *
 * Stated precisely, because the looser version is wrong: the THUMBNAIL is
 * served from i.ytimg.com, which is Google's, and it loads with the card the
 * same as it did before any of this existed. What this avoids is the player -
 * the iframe, its scripts and its cookies - which is the part that profiles
 * the reader. Verified in a browser with request interception: before a click,
 * the only Google-owned request the page makes is the fonts stylesheet it
 * already made.
 *
 * WHY CLICK TO PLAY, NOT AUTOPLAY, BY DEFAULT
 *
 * The coordinator can autoplay this - it is registered the same way a Bluesky
 * clip is, and flipping `youtube.autoplay` in data/buzz-sources.json turns it
 * on. It is off by default because embedding YouTube's player is not like
 * playing a Bluesky clip: it loads a third-party player that profiles the
 * reader, and doing that automatically, before anyone asked for a video, is a
 * consent question rather than a playback one. On a page adjacent to
 * HoopsHype, with European readers, that is Jorge's call to make deliberately
 * rather than mine to inherit from how Bluesky video happens to behave.
 *
 * Either way the domain is youtube-nocookie.com, which holds off on the
 * tracking cookies until playback actually starts.
 *
 * PAUSING KEEPS THE POSITION. The iframe is asked to pause over postMessage
 * (enablejsapi=1) rather than being torn down, so the coordinator's rule that
 * scrolling back resumes rather than restarts holds here too. That costs no
 * script: the message format is stable and the YouTube IFrame API library is
 * never loaded.
 */
(function (root) {
  "use strict";

  var ORIGIN = "https://www.youtube-nocookie.com";

  function coordinator() { return root.MediaCoordinator || null; }

  /* Every shape the Content Stream has produced, plus the ones it might.
   * Returns null rather than guessing: a card with an unrecognisable URL keeps
   * its plain thumbnail and its link out, which is the honest fallback. */
  function videoId(url) {
    var u = String(url || "");
    var m = /[?&]v=([A-Za-z0-9_-]{6,})/.exec(u)
         || /youtu\.be\/([A-Za-z0-9_-]{6,})/.exec(u)
         || /youtube(?:-nocookie)?\.com\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})/.exec(u);
    return m ? m[1] : null;
  }

  function post(frame, func) {
    if (!frame || !frame.contentWindow) return;
    try {
      frame.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: func, args: [] }), ORIGIN);
    } catch (e) { /* not ready yet; the next decision will try again */ }
  }

  /* Built once, on the first play, and never before: the frame only exists
   * because something is about to play, so it always carries autoplay.
   * `mute=1` is what makes a programmatic start permitted at all, and
   * `playsinline=1` stops iOS pulling the video fullscreen out of the feed. */
  function ensureFrame(box) {
    var frame = box.querySelector("iframe");
    if (frame) return frame;
    var id = box.dataset.yt;
    if (!id) return null;
    frame = document.createElement("iframe");
    frame.className = "yt-frame";
    frame.title = box.dataset.ytTitle || "YouTube video";
    frame.allow = "autoplay; encrypted-media; picture-in-picture; web-share";
    frame.setAttribute("allowfullscreen", "");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.src = ORIGIN + "/embed/" + encodeURIComponent(id) +
      "?enablejsapi=1&playsinline=1&modestbranding=1&rel=0&mute=1&autoplay=1";
    box.appendChild(frame);
    return frame;
  }

  var playing = null;

  function play(box) {
    var frame = ensureFrame(box);
    if (!frame) return;
    // Built this instant: the src already carries autoplay, so asking again
    // before it has loaded would be a no-op at best.
    if (box.dataset.started) post(frame, "playVideo");
    box.dataset.started = "1";
    box.classList.add("playing");
    playing = box;
  }

  function pause(box) {
    var frame = box.querySelector("iframe");
    if (frame) post(frame, "pauseVideo");
    box.classList.remove("playing");
    if (playing === box) playing = null;
  }

  /* Off unless data/buzz-sources.json says otherwise - see the header. */
  var autoplay = false;
  function setAutoplay(on) { autoplay = !!on; }

  var observer = null;
  function observerFor() {
    if (observer) return observer;
    var M = coordinator();
    observer = new root.IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (M) M.note(e.target, e.intersectionRatio);
      });
      /* Thresholds bracket the coordinator's own VISIBLE step so it is told
       * about the crossing it actually cares about. */
    }, { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] });
    return observer;
  }

  /* Joining the coordinator is what makes an element eligible to be chosen, so
   * with autoplay off a card does not join until a person presses it. That is
   * the whole gate, and it is one line rather than a rule spread across the
   * observer.
   *
   * An earlier version clamped the visibility it reported instead, to keep the
   * ratio under the coordinator's threshold. Two things were wrong with it: the
   * gate sat in the observer, so any other caller reporting visibility walked
   * straight past it, and once a card had slipped through and built its iframe
   * the click handler saw a player already there and did nothing - so pressing
   * a video no longer paused the race above it. A browser test caught both.
   *
   * Refusing inside play() would have been worse still: the coordinator picks
   * a winner before it calls play(), so a refusing card would have won the
   * round and left the race card frozen behind a video that never started. */
  function join(box) {
    var M = coordinator();
    if (!M || box.dataset.joined) return M;
    box.dataset.joined = "1";
    M.register(box, {
      kind: "yt-video",
      play: function () { play(box); },
      pause: function () { pause(box); },
      isPlaying: function () { return playing === box; }
    });
    if (root.IntersectionObserver) observerFor().observe(box);
    return M;
  }

  /* Called by app.js for every card entering the feed. Safe to call twice. */
  function watch(cardEl) {
    var boxes = cardEl.querySelectorAll ? cardEl.querySelectorAll(".yt-embed[data-yt]") : [];
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      if (box.dataset.watched) continue;
      box.dataset.watched = "1";
      (function (anchor) {
        function start(ev) {
          if (anchor.querySelector("iframe")) return;   // the player owns its own clicks now
          ev.preventDefault();
          /* A person pressing play outranks the algorithm, and telling the
           * coordinator is what stops the race card two rows up. Joining first
           * because with autoplay off this card is not registered until now. */
          var M = join(anchor);
          if (M) M.manualPlay(anchor);
          else play(anchor);
        }
        anchor.addEventListener("click", start);
        /* The box is a button, so it has to answer to a keyboard like one.
         * Space is what people actually press on a video. */
        anchor.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" || ev.key === " " || ev.key === "Spacebar") start(ev);
        });
      })(box);
      if (autoplay) join(box);
    }
  }

  /* Clearing the feed detaches these nodes, and an iframe inside a detached
   * node keeps playing audio in some browsers. */
  function releaseAll(container) {
    if (playing && (!container || container.contains(playing))) pause(playing);
    var M = coordinator();
    if (observer && container) {
      var boxes = container.querySelectorAll(".yt-embed[data-yt]");
      for (var i = 0; i < boxes.length; i++) observer.unobserve(boxes[i]);
    }
    if (M) M.releaseIn(container);
  }

  root.YtVideo = { watch: watch, releaseAll: releaseAll, videoId: videoId, setAutoplay: setAutoplay };
})(window);
