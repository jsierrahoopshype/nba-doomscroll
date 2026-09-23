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

  /* SAY WHO IT IS ABOUT.
   *
   * Jorge, on sharing a teammates card: the post read "Who had the better
   * teammates? — NBA Doomscroll @hoopshype" and the link was
   * ?card=mates-kyle-lowry-vs-al-horford. "This should be more specific. Show
   * that it's Kyle Lowry or Al Horford in the text."
   *
   * He is right, and the same fault ran through half the card types: the
   * question was posted without its subject, so every teammates card, every
   * trivia card and every Cap Call produced an identical post. A timeline full
   * of "Who has more career points?" is a bot.
   *
   * Naming both options does not spoil these cards, because the question IS
   * which of the two. That is the line: name what the card is about, never the
   * answer. Which is exactly why `quiz` is left alone below - Guess the Player
   * asks for the player's name, so putting it in the post gives the game away.
   * Same reason the pair goes in front of the question rather than replacing
   * it: a post that says only "Kyle Lowry vs Al Horford" could be any of four
   * card types. */
  function withPair(p, question, fallback) {
    var who = pair(p.a, p.b) || pair(p.p1, p.p2);
    var q = question || fallback;
    if (!who) return q || "";
    if (!q) return who;
    /* Lower-cased after a colon, because the question is now a clause rather
     * than a sentence: "Kyle Lowry vs Al Horford: who had the better
     * teammates?" reads as written and "…: Who had…" reads as a bug. Only the
     * first letter, so an NBA name inside the question keeps its capitals. */
    return who + ": " + q.charAt(0).toLowerCase() + q.slice(1);
  }

  /* The teams in a built trade, which is what a trade card is about. Falls
   * through to the players when a side has no team name, and to nothing at all
   * rather than inventing a shape the payload does not have. */
  function tradeTeams(card) {
    var sides = (card.payload && card.payload.sides) || [];
    var names = sides.map(function (s) { return s && (s.team_name || s.team); })
                     .filter(Boolean);
    if (names.length < 2) {
      var pl = (card.tags && card.tags.players) || [];
      names = pl.slice(0, 2);
    }
    return names.length >= 2 ? names.slice(0, 2).join(" and ") : null;
  }

  function line(card) {
    var p = (card && card.payload) || {};
    if (NEUTRAL[card && card.type]) return NEUTRAL[card.type];
    switch (card && card.type) {
      case "vs":
      case "compare":
        return pair(p.a, p.b) || pair(p.p1, p.p2) || "Head to head";
      /* The three that carry two named options and a question about them. */
      case "mates":
        return withPair(p, p.headline, "Who had the better teammates?");
      case "trivia":
      case "capcall":
        return withPair(p, p.question || p.prompt, "Can you get this one?");
      case "trade":
        var teams = tradeTeams(card);
        return (teams ? teams + ": a" : "A") +
          " trade someone built in the HoopsMatic Trade Machine";
      /* title first. `note` is the methodology footnote - "ballots counted in a
       * random order", "the final standing is the real one" - and posting that
       * instead of "All-time scoring leaders" describes the small print. */
      case "race":   return p.title || p.subtitle || p.note || "An NBA bar chart race";
      /* Both of these put the subject in the question already: "Which of these
       * NBA teams did LeBron James never play for?". They were falling through
       * to the default, which looks for a headline they do not have, and
       * posting nothing but the site name. */
      case "careermap":
        return p.question || "Which team did he never play for?";
      case "dreamteam":
        var sq = (p.squads || []).map(function (s) { return s && (s.label || s.name); })
                                 .filter(Boolean);
        var dq = p.question || "Which five averaged more between them?";
        return sq.length === 2
          ? sq.join(" or ") + ": " + dq.charAt(0).toLowerCase() + dq.slice(1)
          : dq;
      /* Guess the Player and the ballots. The quiz answer IS a player name, so
       * nothing about the player goes in the post. */
      case "quiz":
      case "ballot": return p.question || p.prompt || "Can you get this one?";
      /* Which voters rated a player above or below the rest. The payload's only
       * prose is `note`, and that is the methodology paragraph, so the default
       * branch was posting 125 characters of small print with the player's name
       * nowhere in it. */
      case "lean":
        return p.player
          ? "Which NBA voters rate " + p.player + " higher than the rest"
          : "Who in the media rates whom";
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
