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
  /* feed.json is the 7-day, 1,000-item index; feed-recent.json is a 100-item
   * slice of it. The slice is 79KB against 806KB, and while Google News was on
   * it was plenty. With Google News off it is not: of those 100 items only a
   * handful are Bluesky or Reddit, which is not enough to hold a 40% share of
   * the feed. The deep index carries ~140 tagged non-news items over the same
   * week. It is fetched after the first screen has painted, never before it. */
  var FEED_URL = BASE + "data/index/feed.json";
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

  /* Cuts at a sentence, then a paragraph, then a word — never mid-word, and
   * never mid-sentence when a full stop is close to the limit. A Reddit post's
   * opening paragraph is the thing worth reading; chopping it at exactly 320
   * characters made it look broken. */
  function clip(s, max) {
    if (s.length <= max) return s;
    var head = s.slice(0, max);
    var stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
    if (stop > max * 0.5) return head.slice(0, stop + 1);
    var para = head.lastIndexOf("\n");
    if (para > max * 0.5) return head.slice(0, para).trim() + "…";
    var word = head.lastIndexOf(" ");
    return (word > 0 ? head.slice(0, word) : head).trim() + "…";
  }

  function toCard(item, cfg, map, trending) {
    var src = cfg.sources[item.source] || { label: item.source, excerpt: false, cta: "Open" };
    var text = [item.title, item.body_excerpt].filter(Boolean).join(" ");
    var players = verifyPlayers(
      (item.players || []).map(function (s) { return map.players[s]; }).filter(Boolean), text);
    var teams = (item.teams || []).map(function (s) { return map.teams[s]; }).filter(Boolean);
    var excerpt = null;
    if (src.excerpt && item.body_excerpt) {
      var t = String(item.body_excerpt).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      // A Bluesky post whose text is the title is common; showing both is noise.
      if (titleKey(t) !== titleKey(item.title)) excerpt = clip(t, src.excerpt_chars || 320);
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
        // Kept so the Bluesky enrichment can rebuild the post's AT-URI.
        source_id: item.id,
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

  /* ---------------- Bluesky enrichment ----------------
   *
   * The published index carries a truncated post, no avatar, no facets and no
   * quoted post — those live on the Bluesky AppView, which Content Stream
   * calls directly (no proxy, CORS is open, no auth). One getPosts call covers
   * 25 posts, so the whole tab costs one or two requests.
   *
   * What it buys, in order of visible impact: the FULL post text instead of
   * the indexer's excerpt; facets, which turn Bluesky's display-truncated
   * links ("www.si.com/nba/76ers/on...") back into real links; the author's
   * avatar; and the quoted post, which is the other half of a reply-with-quote
   * and reads as a non-sequitur without it.
   *
   * Entirely best-effort. If the call fails, is slow, or is switched off in
   * data/buzz-sources.json, the cards render from the index exactly as before.
   */
  function atUri(id) {
    var s = String(id || "");
    if (s.indexOf("bs-") !== 0) return null;
    try {
      var path = decodeURIComponent(s.slice(3));
      return path.indexOf("/app.bsky.feed.post/") > 0 ? "at://" + path : null;
    } catch (e) { return null; }
  }

  function normEmbed(em) {
    if (!em) return { media: null, quote: null };
    var t = em.$type || "";
    var media = null, quote = null;
    if (t.indexOf("app.bsky.embed.recordWithMedia") === 0) {
      var inner = normEmbed(em.media);
      media = inner.media;
      quote = normQuote(em.record && em.record.record);
    } else if (t.indexOf("app.bsky.embed.record") === 0) {
      quote = normQuote(em.record);
    } else if (t.indexOf("app.bsky.embed.images") === 0) {
      media = { type: "image", images: (em.images || []).map(function (i) {
        return { url: i.fullsize || i.thumb, alt: i.alt || "" }; }) };
    } else if (t.indexOf("app.bsky.embed.video") === 0) {
      media = { type: "video", thumbnail: em.thumbnail || null };
    } else if (t.indexOf("app.bsky.embed.external") === 0) {
      var x = em.external || {};
      media = { type: "link", uri: x.uri, title: x.title, description: x.description, thumb: x.thumb };
    }
    return { media: media, quote: quote };
  }

  function normQuote(rec) {
    if (!rec) return null;
    var t = rec.$type || "";
    // A deleted, blocked or detached quote is not an error to hide — the
    // post still reads as a reply to something, so say the something is gone.
    if (/viewNotFound|viewBlocked|viewDetached/.test(t)) return { missing: true };
    var a = rec.author || {}, v = rec.value || {};
    var url = "";
    if (rec.uri && rec.uri.indexOf("at://") === 0) {
      var parts = rec.uri.slice(5).split("/");
      if (parts.length >= 3) {
        url = "https://bsky.app/profile/" + (a.handle || parts[0]) + "/post/" + parts[parts.length - 1];
      }
    }
    var nested = null;
    (rec.embeds || []).forEach(function (e) {
      if (!nested) nested = normEmbed(e).media;
    });
    return {
      author: a.displayName || a.handle || "",
      handle: a.handle || "",
      avatar: a.avatar || "",
      text: v.text || "",
      facets: v.facets || null,
      media: nested,
      url: url
    };
  }

  function enrichBluesky(cards, cfg) {
    if (cfg.enrich_bluesky === false) return Promise.resolve(cards);
    var base = cfg.bluesky_appview || "https://public.api.bsky.app";
    var byUri = {}, uris = [];
    cards.forEach(function (c) {
      if (!c.payload.post) return;
      var u = atUri(c.payload.source_id);
      if (!u || byUri[u]) return;
      byUri[u] = c;
      uris.push(u);
    });
    if (!uris.length) return Promise.resolve(cards);

    var chunks = [];
    for (var i = 0; i < uris.length; i += 25) chunks.push(uris.slice(i, i + 25));
    var calls = chunks.map(function (chunk) {
      var qs = chunk.map(function (u) { return "uris=" + encodeURIComponent(u); }).join("&");
      return fetchJson(base + "/xrpc/app.bsky.feed.getPosts?" + qs)
        .catch(function (e) {
          console.warn("[doomscroll] bluesky appview:", e.message);
          return null;
        });
    });
    // A hung AppView must not hold the tab hostage; the cards are already
    // renderable without it.
    var timeout = new Promise(function (res) {
      root.setTimeout(function () { res("timeout"); }, cfg.enrich_timeout_ms || 5000);
    });
    return Promise.race([Promise.all(calls), timeout]).then(function (results) {
      if (results === "timeout" || !results) {
        console.warn("[doomscroll] bluesky enrichment timed out — cards render from the index");
        return cards;
      }
      var got = 0;
      results.forEach(function (r) {
        ((r && r.posts) || []).forEach(function (p) {
          var c = byUri[p.uri];
          if (!c) return;
          var a = p.author || {}, rec = p.record || {};
          var em = normEmbed(p.embed);
          var post = c.payload.post;
          if (rec.text) post.text = rec.text;
          if (rec.facets) post.facets = rec.facets;
          if (a.handle) { post.handle = a.handle; post.profile = "https://bsky.app/profile/" + a.handle; }
          if (a.avatar) post.avatar = a.avatar;
          if (a.displayName) c.payload.author = a.displayName;
          if (em.media) post.media = em.media;
          if (em.quote) post.quote = em.quote;
          got++;
        });
      });
      console.info("[doomscroll] bluesky enriched " + got + "/" + uris.length + " posts");
      return cards;
    });
  }

  /* ---------------- Reddit enrichment ----------------
   *
   * The index publishes a Reddit post's body cut off at ~280 characters, which
   * is where "Of the 27 players in NBA history…" stops mid-table. The full
   * selftext is public, but reddit.com sends no CORS headers, so a browser
   * cannot read it directly.
   *
   * It goes through the CORS proxy Worker nba-content-stream already runs and
   * already allowlists reddit.com for — no Worker code changed, no deploy, one
   * more caller. And exactly ONE request per page: /api/info.json takes up to
   * 100 fullnames at once, and every Reddit item's id in the index already IS
   * its fullname (rd-t3_1vv3b58). The alternative, /comments/<id>.json, would
   * be one request per post and would drag the whole comment tree along.
   *
   * It also brings two things worth having: the score and comment count, which
   * are what make a Reddit item feel like a Reddit item, and the over_18 and
   * removed flags, which let a post that should not be on a HoopsHype-adjacent
   * page be dropped rather than rendered.
   */
  function redditFullname(id) {
    var m = /^rd-(t3_[a-z0-9]+)$/i.exec(String(id || ""));
    return m ? m[1] : null;
  }

  /* Reddit selftext is markdown. Rendered raw it shows its own syntax, so the
   * markers come off and tables become one line per row — which is how that
   * stat post wants to be read anyway, and better than the flattened
   * single-paragraph version the index carries. */
  function redditText(md) {
    var lines = String(md || "").replace(/\r/g, "").split("\n");
    var out = [];
    lines.forEach(function (ln) {
      // A table separator row: |---|:--:|
      if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(ln) && ln.indexOf("-") >= 0) return;
      if (ln.indexOf("|") >= 0) ln = ln.replace(/^\s*\|/, "").replace(/\|\s*$/, "").replace(/\s*\|\s*/g, "   ");
      ln = ln.replace(/^\s{0,3}#{1,6}\s+/, "")            // headings
             .replace(/^\s{0,3}>\s?/, "")                  // quote markers
             .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")      // [text](url) -> text
             .replace(/(\*\*|__)(.*?)\1/g, "$2")           // bold
             .replace(/&#x200B;/g, "");                    // reddit's zero-width filler
      out.push(ln.replace(/\s+$/, ""));
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function enrichReddit(cards, cfg) {
    if (cfg.enrich_reddit === false || !cfg.cors_proxy) return Promise.resolve(cards);
    var byName = {}, names = [];
    cards.forEach(function (c) {
      if (c.payload.source !== "reddit") return;
      var fn = redditFullname(c.payload.source_id);
      if (!fn || byName[fn]) return;
      byName[fn] = c;
      names.push(fn);
    });
    if (!names.length) return Promise.resolve(cards);
    names = names.slice(0, cfg.reddit_max_lookup || 40);

    var target = "https://www.reddit.com/api/info.json?raw_json=1&id=" + names.join(",");
    var call = fetchJson(cfg.cors_proxy + "/?url=" + encodeURIComponent(target))
      .catch(function (e) {
        console.warn("[doomscroll] reddit lookup:", e.message);
        return null;
      });
    var timeout = new Promise(function (res) {
      root.setTimeout(function () { res("timeout"); }, cfg.enrich_timeout_ms || 5000);
    });
    return Promise.race([call, timeout]).then(function (r) {
      if (r === "timeout" || !r) {
        console.warn("[doomscroll] reddit bodies unavailable — the index excerpt stands");
        return cards;
      }
      var kids = (r.data && r.data.children) || [];
      var drop = {}, got = 0;
      kids.forEach(function (k) {
        var d = k && k.data;
        if (!d) return;
        var c = byName[d.name];
        if (!c) return;
        // Not on a page that sits next to HoopsHype.
        if (d.over_18 || d.removed_by_category || d.selftext === "[removed]" ||
            d.selftext === "[deleted]") { drop[c.id] = 1; return; }
        var src = (cfg.sources && cfg.sources.reddit) || {};
        if (d.selftext) {
          var full = redditText(d.selftext);
          if (full) c.payload.excerpt = clip(full, src.excerpt_chars || 700);
        }
        if (typeof d.score === "number") c.payload.score = d.score;
        if (typeof d.num_comments === "number") c.payload.comments = d.num_comments;
        if (d.subreddit) c.payload.source_label = "r/" + d.subreddit;
        got++;
      });
      var kept = cards.filter(function (c) { return !drop[c.id]; });
      console.info("[doomscroll] reddit: " + got + "/" + names.length + " bodies" +
        (Object.keys(drop).length ? ", " + Object.keys(drop).length + " dropped (removed or NSFW)" : ""));
      return kept;
    });
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
        // Optional per-source outlet allowlist. Empty means every outlet.
        if (src.outlet_allow && src.outlet_allow.length &&
            src.outlet_allow.indexOf(String(item.author || "")) < 0) { dropped++; return; }
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
      fetchJson(FEED_URL).catch(function (e) {
        console.warn("[doomscroll] deep feed unavailable:", e.message);
        // Fall back to the small one rather than losing the tab.
        return fetchJson(RECENT_URL).catch(function (e2) {
          console.warn("[doomscroll] recent feed unavailable:", e2.message); return null;
        });
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
      // Both enrichments are optional and independent, so they run together
      // and either one failing leaves the other's work in place.
      return Promise.all([
        enrichBluesky(cards, cfg).catch(function (e) {
          console.warn("[doomscroll] bluesky enrichment failed:", e.message);
          return cards;
        }),
        enrichReddit(cards, cfg).catch(function (e) {
          console.warn("[doomscroll] reddit enrichment failed:", e.message);
          return cards;
        })
      ]).then(function (out) {
        // Both mutate the same card objects in place; only Reddit removes
        // any, so its list is the one to return.
        return out[1] || cards;
      });
    }).catch(function (e) {
      console.warn("[doomscroll] buzz skipped:", e.message);
      return [];
    });
  }

  root.LiveBuzz = { load: load, base: BASE };
})(window);
