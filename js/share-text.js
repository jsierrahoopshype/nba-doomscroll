/* NBA Doomscroll — what a shared card says, and where it can be posted.
 *
 * Its own file rather than a corner of app.js because app.js touches the DOM on
 * load and so cannot be run by a test. These two functions are pure, and the
 * whole risk in them is editorial rather than technical: what text leaves this
 * site and lands in someone's timeline. tools/test_share_text.mjs pins that
 * down against the real file.
 */
(function (root) {
  "use strict";

  var MAX = 160;   // both networks count it, and a long post reads as a dump

  /* RUMOR AND BUZZ CARDS DELIBERATELY DO NOT QUOTE THEMSELVES.
   *
   * The excerpt on a rumor card is HoopsHype archive content, shown under a
   * link back to whoever reported it. Pasting those words into a post
   * republishes them somewhere the attribution does not travel with them. Buzz
   * carries other people's Bluesky and Reddit posts and has the same problem
   * twice over. Both share a neutral line and let the URL do the work.
   *
   * Every other card type is HoopsMatic's own output and can say what it is. */
  var NEUTRAL = {
    rumor: "A rumor from the HoopsHype archive",
    buzz: "From today's NBA conversation"
  };

  function pair(a, b) {
    return a && b && a.name && b.name ? a.name + " vs " + b.name : null;
  }

  function line(card) {
    var p = (card && card.payload) || {};
    if (NEUTRAL[card && card.type]) return NEUTRAL[card.type];
    switch (card && card.type) {
      case "vs":
      case "compare":
        return pair(p.a, p.b) || pair(p.p1, p.p2) || "Head to head";
      case "mates":  return "Who had the better teammates?";
      case "trade":  return "A trade someone built in the HoopsMatic Trade Machine";
      case "race":   return p.note || p.title || "An NBA bar chart race";
      case "quiz":
      case "trivia":
      case "capcall":
      case "ballot": return p.question || p.prompt || "Can you get this one?";
      default:       return p.headline || p.story || p.note || p.player || "";
    }
  }

  /* THE ACCOUNT HANDLE, PER NETWORK.
   *
   * Jorge's call: a card shared out of the feed should tag HoopsHype, so the
   * post is attributable and the reply lands somewhere. The handles differ by
   * network and are not interchangeable - "@hoopshype" on Bluesky is not the
   * HoopsHype account, it is nobody - so this is a table rather than one
   * string.
   *
   * Bluesky handles are full domains and are what its intent composer expects;
   * X wants the short form. */
  var HANDLE = {
    bsky: "@hoopshypeofficial.bsky.social",
    x: "@hoopshype"
  };

  /** The post body, above the link. Never empty: a post with no words at all
   *  reads as a bot.
   *
   *  `kind` adds the network's own handle. It is optional so any existing
   *  caller asking for plain text still gets what it always did. */
  function text(card, kind) {
    var tag = HANDLE[kind] ? " " + HANDLE[kind] : "";
    /* The suffix is measured against the cap, not added after it. Otherwise a
     * long headline plus " — NBA Doomscroll @hoopshypeofficial.bsky.social"
     * runs past what the composer accepts and the handle is what gets cut -
     * which is the one part of the line that has a job to do. */
    var suffix = " — NBA Doomscroll" + tag;
    var room = MAX - suffix.length;
    var s = String(line(card) || "").replace(/\s+/g, " ").trim();
    if (room < 12) return ("NBA Doomscroll" + tag).trim();
    if (s.length > room) s = s.slice(0, room - 1).replace(/\s+\S*$/, "") + "…";
    return (s ? s + suffix : ("NBA Doomscroll" + tag)).trim();
  }

  /** A compose URL, not a share widget. Nothing is loaded from either network,
   *  so no third-party script and no tracking pixel enters the page.
   *
   *  Bluesky's intent takes one text field, so the link rides inside it. X takes
   *  the URL separately and appends it itself, which is why it must NOT also be
   *  in the text - it would appear twice. */
  function composeUrl(kind, card, url) {
    var body = text(card, kind === "bsky" ? "bsky" : "x");
    var href = String(url || "");
    if (kind === "bsky") {
      return "https://bsky.app/intent/compose?text=" +
        encodeURIComponent(body + (href ? "\n\n" + href : ""));
    }
    return "https://x.com/intent/post?text=" + encodeURIComponent(body) +
      (href ? "&url=" + encodeURIComponent(href) : "");
  }

  /* A RUN IS THE ONE THING HERE WORTH BRAGGING ABOUT.
   *
   * Every other share posts a card: a question, a comparison, a race. This
   * posts what the reader did, which is the only output of this feed that is
   * about them. It is also the cheapest distribution this app has - a streak
   * badge that can be posted costs one button and needs no image, no canvas and
   * no third-party script.
   *
   * No number is claimed that the run does not support, and nothing about the
   * reader leaves the browser except the count they chose to post. */
  function runPost(kind, run, best) {
    var tag = HANDLE[kind] ? " " + HANDLE[kind] : "";
    var n = Math.max(0, Math.floor(Number(run) || 0));
    var b = Math.max(0, Math.floor(Number(best) || 0));
    if (!n) return ("NBA Doomscroll" + tag).trim();
    var s = n + " NBA questions right in a row on Doomscroll";
    /* Only when the best is genuinely better than this run. On a personal best
     * the run IS the best and saying both is a repeat. */
    if (b > n) s += " (best: " + b + ")";
    var suffix = " — HoopsMatic" + tag;
    if (s.length + suffix.length > MAX) s = n + " in a row on NBA Doomscroll";
    return (s + suffix).trim();
  }

  /** The composer URL for a run. Same two-network split as composeUrl: Bluesky
   *  takes one text field so the link rides inside it, X takes the URL on its
   *  own parameter and would print it twice if it were in both. */
  function runComposeUrl(kind, run, best, url) {
    var body = runPost(kind === "bsky" ? "bsky" : "x", run, best);
    var href = String(url || "");
    if (kind === "bsky") {
      return "https://bsky.app/intent/compose?text=" +
        encodeURIComponent(body + (href ? "\n\n" + href : ""));
    }
    return "https://x.com/intent/post?text=" + encodeURIComponent(body) +
      (href ? "&url=" + encodeURIComponent(href) : "");
  }

  root.ShareText = { text: text, composeUrl: composeUrl, MAX: MAX, HANDLE: HANDLE,
                     runPost: runPost, runComposeUrl: runComposeUrl };
})(window);
