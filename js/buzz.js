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

  /* ---------------- cross-source event dedupe ----------------
   *
   * titleKey above catches only an exact normalised repeat. The same event
   * arrives through Bluesky, Reddit and YouTube worded three different ways -
   * "Doncic drops 45 in return", "[Highlights] Luka's 45-point return",
   * "Luka Doncic returns with 45 points" - and all three land in one feed.
   *
   * Two items are the same event when they share an entity tag AND their
   * titles overlap heavily AND they were published close together. All three
   * are required: entity alone merges every post about the same player, title
   * overlap alone merges two different games with similar phrasing, and the
   * window keeps a rematch three weeks later from folding into the first one.
   */
  var STOP = {
    the: 1, a: 1, an: 1, and: 1, or: 1, of: 1, to: 1, in: 1, on: 1, for: 1,
    with: 1, at: 1, by: 1, from: 1, is: 1, are: 1, was: 1, were: 1, be: 1,
    has: 1, have: 1, had: 1, his: 1, her: 1, its: 1, their: 1, this: 1,
    that: 1, it: 1, as: 1, but: 1, all: 1, via: 1,
    nba: 1, vs: 1, per: 1, says: 1, said: 1, new: 1, now: 1, one: 1, two: 1,
    /* "out", "off" and "not" are deliberately NOT here. In an NBA headline
     * they are the whole story - "Doncic out tonight" and "Doncic in tonight"
     * are opposite reports, and a stopword list that ate them would merge the
     * two. */
    /* Reddit prefixes its own titles by category, so every r/NBA highlight
     * would otherwise share two tokens with every other one. */
    highlights: 1, highlight: 1, discussion: 1, news: 1, post: 1, game: 1,
    thread: 1, video: 1, watch: 1
  };

  /* Lowercasing matters: fold() strips diacritics but leaves case alone, so
   * without this every capitalised word lost its first letter to the class
   * below and "Lakers" matched "akers". Numbers are kept at any length -
   * "45" and "30" are the difference between two reports of the same game,
   * and the length filter that removes "the" was removing them too. */
  function titleTokens(t) {
    var seen = {}, out = [];
    fold(t).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").forEach(function (w) {
      if (!w || seen[w]) return;
      if (!/[0-9]/.test(w) && (w.length < 3 || STOP[w])) return;
      seen[w] = 1; out.push(w);
    });
    return out;
  }

  function numbersIn(tokens) {
    return tokens.filter(function (w) { return /^[0-9]+$/.test(w); });
  }

  /* Overlap relative to the SHORTER title, not to the union. A 5-word Bluesky
   * post and a 14-word YouTube title describing the same play score ~0.35 on
   * Jaccard and ~0.8 here, and the second number is the true one: everything
   * the short title said, the long one also said. */
  function overlap(a, b) {
    if (!a.length || !b.length) return 0;
    var set = {}, hits = 0;
    for (var i = 0; i < a.length; i++) set[a[i]] = 1;
    for (var j = 0; j < b.length; j++) if (set[b[j]]) hits++;
    return hits / Math.min(a.length, b.length);
  }

  function sharesEntity(a, b) {
    var set = {}, i;
    var ap = a.tags.players.concat(a.tags.teams);
    var bp = b.tags.players.concat(b.tags.teams);
    for (i = 0; i < ap.length; i++) set[ap[i]] = 1;
    for (i = 0; i < bp.length; i++) if (set[bp[i]]) return true;
    return false;
  }

  function pubMs(card) {
    var t = Date.parse(card.payload.published_at);
    return isNaN(t) ? 0 : t;
  }

  /* Which copy of an event survives. Trending first, because that is the one
   * the reader is most likely to have heard about; then the source order
   * Jorge sets in the config; then the copy with the most body text, since a
   * bare headline is the least useful version of a story; then the earliest,
   * which is the source that broke it. */
  function pickBest(a, b, rank) {
    if (!!a.payload.trending !== !!b.payload.trending) return a.payload.trending ? a : b;
    var ra = rank[a.payload.source], rb = rank[b.payload.source];
    if (ra === undefined) ra = 99;
    if (rb === undefined) rb = 99;
    if (ra !== rb) return ra < rb ? a : b;
    var la = (a.payload.excerpt || "").length, lb = (b.payload.excerpt || "").length;
    if (la !== lb) return la > lb ? a : b;
    var ta = pubMs(a), tb = pubMs(b);
    if (ta && tb && ta !== tb) return ta < tb ? a : b;
    return a;
  }

  /* Returns a new list with each event represented once. The survivor takes
   * the position of the FIRST member of its group, so the trending ordering
   * the feed arrived in is preserved rather than reshuffled by the merge. */
  function dedupeEvents(cards, cfg) {
    var d = (cfg && cfg.dedupe) || {};
    if (d.on === false) return cards;
    var minOverlap = typeof d.min_overlap === "number" ? d.min_overlap : 0.6;
    var minTokens = typeof d.min_tokens === "number" ? d.min_tokens : 5;
    var windowMs = (typeof d.window_hours === "number" ? d.window_hours : 36) * 3600000;
    var rank = {};
    (d.prefer || ["bluesky", "reddit", "substack", "youtube", "google-news"])
      .forEach(function (s, i) { rank[s] = i; });

    var groups = [];   // { at, card, tokens, ms }
    var merged = 0;
    cards.forEach(function (card) {
      var tok = titleTokens(card.payload.title);
      var ms = pubMs(card);
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        if (windowMs && g.ms && ms && Math.abs(g.ms - ms) > windowMs) continue;
        if (!sharesEntity(g.card, card)) continue;
        /* A title with only three or four content words carries too little to
         * match on. "Lakers win in Denver" and "Lakers lose in Denver" agree
         * on two words out of three, which any overlap threshold worth using
         * for real headlines will wave through. Short titles are left alone
         * and the exact-title check upstream is all they get. Showing a
         * duplicate is a much cheaper mistake than hiding the other result. */
        if (Math.min(g.tokens.length, tok.length) < minTokens) continue;
        if (overlap(g.tokens, tok) < minOverlap) continue;
        /* Numbers are the payload of an NBA headline. If both titles quote a
         * figure and they are different figures, it is two reports, not one:
         * a 45-point game and a 30-point game are not the same night however
         * similarly they are worded. */
        var na = numbersIn(g.tokens), nb = numbersIn(tok);
        if (na.length && nb.length && !na.some(function (x) { return nb.indexOf(x) >= 0; })) continue;
        var win = pickBest(g.card, card, rank);
        if (win !== g.card) { g.card = win; g.tokens = tok; g.ms = ms; }
        merged++;
        return;
      }
      groups.push({ card: card, tokens: tok, ms: ms });
    });
    var out = groups.map(function (g) { return g.card; });
    out.merged = merged;
    return out;
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
      media = { type: "video", thumbnail: em.thumbnail || null, playlist: em.playlist || null };
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
   * is where "Of the 27 players in NBA history…" stops mid-table. The full body
   * is public, but reddit.com sends no CORS headers, so it goes through the
   * CORS proxy Worker nba-content-stream already runs and already allowlists
   * reddit.com for. No Worker change; one more caller.
   *
   * It reads RSS, not the JSON API. /api/info.json was the obvious route and it
   * returned 403 in production: Reddit gates its API behind OAuth for
   * datacenter IPs, and a Cloudflare Worker is a datacenter IP. RSS is not
   * gated — it is the same mechanism Content Stream's own Reddit live-merge
   * uses through this proxy, which is the evidence that it works.
   *
   * Two requests, not one per post: a subreddit feed carries up to 100 entries,
   * each with its fullname in <id> and its rendered body in <content>, so the
   * week's top plus the newest posts covers nearly everything the index holds.
   * Anything not in either feed keeps its short excerpt.
   *
   * What RSS costs, relative to the JSON API: no score, no comment count, and
   * no over_18 flag. The editorial blocklist still runs over every title and
   * body, and r/nba is the only subreddit in the feed.
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

  /* Reddit's RSS <content> is rendered HTML. It is parsed with DOMParser and
   * read as text rather than injected — this is third-party HTML and it never
   * touches innerHTML. Tables come back as <tr>/<td>, so the walk keeps one
   * line per row, which is how that free-throw table wants to be read. */
  function htmlToText(html) {
    var doc;
    try { doc = new DOMParser().parseFromString(String(html || ""), "text/html"); }
    catch (e) { return ""; }
    var body = doc && doc.body;
    if (!body) return "";
    var parts = [];
    var blocks = body.querySelectorAll("tr,p,li,h1,h2,h3,blockquote");
    for (var i = 0; i < blocks.length; i++) {
      var el = blocks[i], tag = (el.tagName || "").toLowerCase(), t;
      if (tag === "tr") {
        var cells = el.querySelectorAll("th,td"), row = [];
        for (var j = 0; j < cells.length; j++) row.push(cells[j].textContent.trim());
        t = row.join("   ");
      } else {
        // A wrapper whose children are themselves blocks would print twice.
        if (el.querySelector("tr,p,li")) continue;
        t = el.textContent;
      }
      t = t.replace(/\s+/g, " ").trim();
      // Reddit closes every self-post body with "submitted by /u/x [link]
      // [comments]", which is chrome, not content.
      if (!t || /^submitted by\b/i.test(t)) continue;
      parts.push(t);
    }
    if (!parts.length) parts.push(body.textContent.replace(/\s+/g, " ").trim());
    return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function enrichReddit(cards, cfg) {
    if (cfg.enrich_reddit === false || !cfg.cors_proxy) return Promise.resolve(cards);
    var byName = {}, wanted = 0;
    cards.forEach(function (c) {
      if (c.payload.source !== "reddit") return;
      var fn = redditFullname(c.payload.source_id);
      if (!fn || byName[fn]) return;
      byName[fn] = c;
      wanted++;
    });
    if (!wanted) return Promise.resolve(cards);

    var feeds = cfg.reddit_feeds || [
      "https://www.reddit.com/r/nba/top/.rss?t=week&limit=100",
      "https://www.reddit.com/r/nba/new/.rss?limit=100"
    ];
    var calls = feeds.map(function (f) {
      return fetch(cfg.cors_proxy + "/?url=" + encodeURIComponent(f), { credentials: "omit" })
        .then(function (r) {
          if (!r.ok) throw new Error(f.split("/r/nba/")[1] + " " + r.status);
          return r.text();
        })
        .catch(function (e) {
          console.warn("[doomscroll] reddit feed:", e.message);
          return null;
        });
    });
    var timeout = new Promise(function (res) {
      root.setTimeout(function () { res("timeout"); }, cfg.enrich_timeout_ms || 5000);
    });
    return Promise.race([Promise.all(calls), timeout]).then(function (results) {
      if (results === "timeout" || !results) {
        console.warn("[doomscroll] reddit bodies unavailable — the index excerpt stands");
        return cards;
      }
      var src = (cfg.sources && cfg.sources.reddit) || {};
      var got = 0;
      results.forEach(function (xml) {
        if (!xml) return;
        var doc;
        try { doc = new DOMParser().parseFromString(xml, "text/xml"); }
        catch (e) { return; }
        if (!doc || doc.querySelector("parsererror")) return;
        var entries = doc.querySelectorAll("entry");
        for (var i = 0; i < entries.length; i++) {
          var idEl = entries[i].querySelector("id");
          var fn = idEl ? idEl.textContent.trim() : "";
          var c = byName[fn];
          if (!c || c.payload.enriched) continue;
          var contentEl = entries[i].querySelector("content");
          var text = contentEl ? htmlToText(contentEl.textContent) : "";
          if (text && text.length > (c.payload.excerpt || "").length) {
            c.payload.excerpt = clip(text, src.excerpt_chars || 700);
            c.payload.enriched = true;
            got++;
          }
        }
      });
      console.info("[doomscroll] reddit: " + got + "/" + wanted + " full bodies from RSS");
      return cards;
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
        // Badge only the top of the ranked list: the per-source caps fill
        // mostly from trending.json, so badging all 40 would badge everything.
        var hot = entry.trending && rank < (cfg.trending_top || 12);
        var card = toCard(item, cfg, map, hot);
        // Re-check after the tags have been verified against the text: an
        // item whose only tag was a mis-match has nothing left to stand on.
        if (cfg.require_entity !== false && src.require_entity !== false &&
            !card.tags.players.length && !card.tags.teams.length) { dropped++; return; }
        seenId[id] = 1;
        if (tk) seenTitle[tk] = 1;
        cards.push(card);
      });
    });

    /* Dedupe BEFORE the per-source caps, not after. A cap applied first hands
     * a slot to a duplicate and then the merge throws it away, so the source
     * ends up under its own ceiling for no reason - the reader loses a card
     * they could have had. */
    var kept = dedupeEvents(cards, cfg);

    var out = [];
    kept.forEach(function (card) {
      var s = card.payload.source;
      var src = cfg.sources[s] || {};
      var used = perSource[s] || 0;
      if (src.max && used >= src.max) return;
      perSource[s] = used + 1;
      out.push(card);
    });
    out.filtered = dropped;
    out.deduped = kept.merged || 0;
    return out;
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
      /* The decay curve is editorial, so it lives beside the source config
       * rather than in the engine. Absent means the engine's own defaults. */
      if (cfg.freshness && root.DoomEngine && root.DoomEngine.setFreshness) {
        root.DoomEngine.setFreshness(cfg.freshness);
      }
      /* Whether a YouTube card may start on its own is editorial too, so it
       * sits beside the source it governs rather than in the player. */
      if (root.YtVideo && root.YtVideo.setAutoplay) {
        root.YtVideo.setAutoplay(!!((cfg.sources || {}).youtube || {}).autoplay);
      }
      var cards = build(lists, cfg, map, blocked);
      console.info("[doomscroll] buzz: " + cards.length + " cards from " +
        lists.reduce(function (n, l) { return n + (l.items || []).length; }, 0) +
        " items (" + (cards.filtered || 0) + " filtered out, " +
        (cards.deduped || 0) + " merged as duplicates)");
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
