/* NBA Doomscroll — Buzz (current events)
 *
 * Everything else in this feed is history: the archive, the ballots, the
 * races, the on-this-day games. Buzz is the one section about today. It reads
 * nba-content-stream's two published index files in the READER's browser —
 * nothing from that repo is baked in here:
 *
 *   data/index/trending.json     40 items, 72h window, weighted by source
 *   data/index/feed-recent.json  100 items, 7 day window
 *
 * Trending goes first and is marked, so the ordering the Content Stream
 * already computed is not thrown away and recomputed badly here.
 *
 * Three filters run before anything reaches a card, and an item has to clear
 * all three:
 *
 *  1. Editorial. The same blocklist the Rumors tab uses, borrowed from
 *     js/rumors.js rather than copied, so the two cannot drift apart. If the
 *     blocklist cannot be loaded, Buzz shows nothing at all — an unfiltered
 *     feed of other people's headlines is not something to fail open into.
 *  2. On topic. Content Stream tags entities by name, so an MLB story about a
 *     Spencer Jones is tagged with the Thunder rookie of the same name. Items
 *     carrying another league's markers are dropped (data/buzz-sources.json).
 *  3. Source rules. Which sources are on, how many of each, and whether their
 *     body text renders at all. Two do not: google-news repeats the headline,
 *     and youtube descriptions are full of sportsbook affiliate links.
 *
 * Entity slugs are translated through data/buzz-map.json into the display
 * names and team abbreviations every other card here is tagged with, so a Buzz
 * card about Luka surfaces for someone who likes Luka and appears when his
 * name is tapped anywhere in the feed.
 */
(function (root) {
  "use strict";

  var BASE = "https://jsierrahoopshype.github.io/nba-content-stream/";
  var TRENDING_URL = BASE + "data/index/trending.json";
  var RECENT_URL = BASE + "data/index/feed-recent.json";
  var MAP_URL = "data/buzz-map.json";
  var CFG_URL = "data/buzz-sources.json";

  function fetchJson(url) {
    return fetch(url, { credentials: "omit" }).then(function (r) {
      if (!r.ok) throw new Error(url.split("/").pop() + " " + r.status);
      return r.json();
    });
  }

  /* Titles from a wire feed repeat: the same story files under six outlets
   * within an hour, and Google News carries all six. Normalising to letters and
   * digits catches the punctuation and outlet-suffix variants. */
  function titleKey(t) {
    return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 70);
  }

  function offTopic(item, words) {
    var hay = " " + [item.title, item.body_excerpt, item.author]
      .filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
    for (var i = 0; i < words.length; i++) {
      if (hay.indexOf(" " + words[i] + " ") >= 0) return true;
    }
    return false;
  }

  /* An id that is safe in a URL and in an HTML attribute. Content Stream ids
   * are source-native — a Bluesky one is a percent-encoded DID with slashes in
   * it — and those go into data-id, share links and localStorage keys. */
  function cardId(item) {
    var s = String(item.id || item.url || "").replace(/[^a-zA-Z0-9]+/g, "");
    return "buzz-" + item.source.replace(/[^a-z]/g, "") + "-" + s.slice(-28);
  }

  /* The handle is not in the index, but every Bluesky post URL carries it:
   * bsky.app/profile/<handle>/post/<rkey>. Content Stream derives it the same
   * way for its archive cards. */
  function bskyHandle(url) {
    var m = /bsky\.app\/profile\/([^/?#]+)/.exec(String(url || ""));
    return m ? m[1] : "";
  }

  /* Content Stream tags entities by name match, and the match is loose enough
   * to be wrong in public: a post about Jamal CRAWFORD came through tagged
   * Jamal Murray, and the card printed the wrong man's name under a quote he
   * never said. So a player tag has to earn its place — the surname has to
   * appear in the text. A player mentioned only by first name loses a chip;
   * that is a much smaller failure than naming the wrong player.
   *
   * Teams are left alone: their names are multi-word and specific, and the
   * same class of collision does not happen with them. */
  function verifyPlayers(names, text) {
    var hay = " " + fold(text).toLowerCase().replace(/[^a-z0-9]+/g, " ") + " ";
    return names.filter(function (n) {
      var parts = fold(n).toLowerCase().replace(/[^a-z0-9 ]+/g, "").split(/\s+/)
        .filter(function (w) { return w && !/^(jr|sr|ii|iii|iv)$/.test(w); });
      var surname = parts[parts.length - 1];
      return surname && hay.indexOf(" " + surname + " ") >= 0;
    });
  }

  // "Dončić" and "Doncic" have to compare equal: the two feeds disagree.
  function fold(s) {
    s = String(s || "");
    return s.normalize ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : s;
  }

  function toCard(item, cfg, map, trending) {
    var src = cfg.sources[item.source] || { label: item.source, excerpt: false, cta: "Open" };
    var text = [item.title, item.body_excerpt].filter(Boolean).join(" ");
    var players = verifyPlayers(
      (item.players || []).map(function (s) { return map.players[s]; }).filter(Boolean), text);
    var teams = (item.teams || []).map(function (s) { return map.teams[s]; }).filter(Boolean);
    var excerpt = null;
    if (src.excerpt && item.body_excerpt) {
      var t = String(item.body_excerpt).replace(/\s+/g, " ").trim();
      // A Bluesky post whose text is the title is common; showing both is noise.
      if (titleKey(t) !== titleKey(item.title)) excerpt = t.slice(0, 320);
    }
    /* A Bluesky card is the post, not a headline about the post. `title` is
     * the first line truncated by the indexer — the reason a card read "A
     * splash of Leandro Barbosa, a dash of Jamal Crawford . . ." and stopped
     * before the punchline — so the post text is what renders, with the line
     * breaks the author wrote. Content Stream does the same thing. */
    var post = null;
    if (item.source === "bluesky") {
      var handle = bskyHandle(item.url);
      post = {
        handle: handle,
        profile: handle ? "https://bsky.app/profile/" + handle : item.url,
        text: String(item.body_excerpt || item.title || "").replace(/[ \t]+\n/g, "\n").trim(),
        media: item.media || null
      };
    }
    return {
      id: cardId(item),
      type: "buzz",
      tab: ["buzz"],
      live: true,
      tags: {
        content_type: "buzz",
        players: players.slice(0, 4),
        teams: teams.slice(0, 4),
        era: "2020s",
        category: "buzz-" + item.source
      },
      payload: {
        title: String(item.title || "").replace(/\s+/g, " ").trim(),
        url: item.url,
        source: item.source,
        source_label: src.label,
        cta: src.cta || "Open",
        author: item.author || "",
        published_at: item.published_at,
        excerpt: excerpt,
        // Video posts carry a thumbnail but the player is on the source site.
        thumbnail: item.thumbnail || null,
        is_video: !!(item.media && item.media.type === "video"),
        post: post,
        trending: !!trending,
        players: players.slice(0, 4),
        teams: teams.slice(0, 4)
      }
    };
  }

  function build(lists, cfg, map, blocked) {
    var seenId = {}, seenTitle = {}, perSource = {}, cards = [], dropped = 0;
    var oldest = cfg.max_age_days
      ? Date.now() - cfg.max_age_days * 86400000
      : 0;
    lists.forEach(function (entry) {
      (entry.items || []).forEach(function (item, rank) {
        if (!item || !item.url || !item.title || !item.source) return;
        var src = cfg.sources[item.source];
        if (!src || src.on === false) return;
        var id = cardId(item);
        if (seenId[id]) return;
        var tk = titleKey(item.title);
        if (tk && seenTitle[tk]) return;
        /* The one filter that matters most. The accounts this feed follows post
         * about their own lives and other sports in between NBA posts, and an
         * untagged item is usually one of those: baseball play-by-play, a
         * podcast plug, a joke. Requiring an NBA entity drops all of it, and
         * has the side benefit that every Buzz card can be personalised and
         * cross-matched like every other card here. */
        if (cfg.require_entity !== false && src.require_entity !== false &&
            !(item.players || []).length && !(item.teams || []).length) { dropped++; return; }
        if (oldest && Date.parse(item.published_at) < oldest) { dropped++; return; }
        // A headline cut off mid-sentence with no body to finish it.
        if (src.drop_truncated && /(…|\.\.\.)\s*$/.test(item.title)) { dropped++; return; }
        if (offTopic(item, cfg.off_topic || [])) { dropped++; return; }
        if (blocked([item.title, item.body_excerpt].filter(Boolean).join(" "))) { dropped++; return; }
        var used = perSource[item.source] || 0;
        if (src.max && used >= src.max) return;
        // Badge only the top of the ranked list: the per-source caps fill
        // mostly from trending.json, so badging all 40 would badge everything.
        var hot = entry.trending && rank < (cfg.trending_top || 12);
        var card = toCard(item, cfg, map, hot);
        // Re-check after the tags have been verified against the text: an
        // item whose only tag was a mis-match has nothing left to stand on.
        if (cfg.require_entity !== false && src.require_entity !== false &&
            !card.tags.players.length && !card.tags.teams.length) { dropped++; return; }
        perSource[item.source] = used + 1;
        seenId[id] = 1;
        if (tk) seenTitle[tk] = 1;
        cards.push(card);
      });
    });
    cards.filtered = dropped;
    return cards;
  }

  /* Returns buzz cards, or an empty array if the feed or the blocklist could
   * not be read. Never throws: an empty result is the failure signal, and
   * app.js turns it into an honest message rather than an empty tab. */
  function load() {
    var filter = root.LiveRumors && root.LiveRumors.editorialFilter
      ? root.LiveRumors.editorialFilter()
      : Promise.reject(new Error("editorial filter unavailable"));
    return Promise.all([
      filter,
      fetchJson(CFG_URL),
      fetchJson(MAP_URL),
      fetchJson(TRENDING_URL).catch(function (e) {
        console.warn("[doomscroll] trending unavailable:", e.message); return null;
      }),
      fetchJson(RECENT_URL).catch(function (e) {
        console.warn("[doomscroll] recent feed unavailable:", e.message); return null;
      })
    ]).then(function (r) {
      var blocked = r[0], cfg = r[1], map = r[2];
      var lists = [];
      if (r[3]) lists.push({ items: r[3].items, trending: true });
      if (r[4]) lists.push({ items: r[4].items, trending: false });
      if (!lists.length) throw new Error("no content stream index reachable");
      var cards = build(lists, cfg, map, blocked);
      console.info("[doomscroll] buzz: " + cards.length + " cards from " +
        lists.reduce(function (n, l) { return n + (l.items || []).length; }, 0) +
        " items (" + (cards.filtered || 0) + " filtered out)");
      return cards;
    }).catch(function (e) {
      console.warn("[doomscroll] buzz skipped:", e.message);
      return [];
    });
  }

  root.LiveBuzz = { load: load, base: BASE };
})(window);
