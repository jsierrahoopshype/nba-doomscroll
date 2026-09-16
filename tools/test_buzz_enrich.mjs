/* Does a Bluesky post that came whole from the index still get re-requested?
 *
 *     node tools/test_buzz_enrich.mjs
 *
 * WHAT THIS IS ABOUT
 *
 * Every buzz card used to cost a call to Bluesky's public AppView - one request
 * per twenty-five posts, on every page load - to collect four things: the full
 * post text, the author's avatar, the facets that turn Bluesky's
 * display-shortened links back into real ones, and the quoted post.
 *
 * Two of those were already unnecessary. The index has carried the full text
 * for a long time (poll_bluesky writes the whole thing into body_excerpt, and
 * the note in buzz-sources.json claiming otherwise was simply out of date) and
 * the media object with its HLS playlist, which is why a video card can play
 * without a round trip. As of Sept 2026 Content Stream publishes the other
 * three as well, and marks the item `enriched` so a consumer can tell.
 *
 * The marker is the load-bearing part. A post with no links and a post polled
 * before facets were published both arrive with no facets, so absence cannot
 * be the signal - only the marker separates "this post has nothing to fetch"
 * from "we do not know yet".
 *
 * The test hands buzz.js a `fetch` that throws. A skipped request cannot throw.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(REPO, "js/buzz.js"), "utf8");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* buzz.js is a browser IIFE. Same approach test_freshness.mjs uses: a fake
 * window, and the closing line rewritten to expose the two private functions.
 * Production code stays free of test hooks.
 *
 * `fetch` IS PASSED AS A PARAMETER, and that detail is the whole test. buzz.js
 * calls bare `fetch`, not `root.fetch`, so a stub hung on the fake window is
 * ignored and the module reaches Node's real global one - which means the first
 * version of this test was quietly making a live request to the AppView and
 * then swallowing the failure in enrichBluesky's own catch, reporting "no
 * calls" either way. A parameter shadows the global, so nothing here can touch
 * the network and a call is a call. */
function load(fetchImpl) {
  const win = { setTimeout, localStorage: null };
  const body = SRC.replace(/\}\)\(window\);\s*$/,
    "root.LiveBuzz.__test = { build: build, enrichBluesky: enrichBluesky };\n})(window);");
  /* Written out rather than as shorthand methods: test_lib_imports.mjs reads
     every tools/ file for names nothing declares, and `info(){}` inside an
     object literal reads to it as a bare call. */
  var quiet = { info: function () {}, warn: function () {}, error: function () {} };
  new Function("window", "console", "fetch", body)(win, quiet, fetchImpl);
  return win.LiveBuzz.__test;
}

/* A fetch that counts, and a note of every URL it was given. */
function spy(impl) {
  const calls = [];
  const fn = (url, opts) => {
    calls.push(url);
    return impl ? impl(url, opts)
                : Promise.resolve({ ok: true, json: () => Promise.resolve({ posts: [] }) });
  };
  fn.calls = calls;
  return fn;
}

const SOURCES = JSON.parse(fs.readFileSync(path.join(REPO, "data/buzz-sources.json"), "utf8"));

/* An index item as Content Stream publishes it now. */
/* The id is the AT-URI path, URL-encoded, exactly as SHARD_FORMAT.md specifies
   and as poll_bluesky writes it - enrichBluesky decodes it back to address the
   post, so a made-up id would silently never be asked about, which is the
   failure this fixture existed to catch in the first place. */
const AT_NEW = "bs-did%3Aplc%3Ar1%2Fapp.bsky.feed.post%2F3kabc123";
const AT_OLD = "bs-did%3Aplc%3Ar1%2Fapp.bsky.feed.post%2F3kold999";

const item = (extra) => Object.assign({
  id: AT_NEW,
  source: "bluesky",
  published_at: new Date().toISOString(),
  title: "Report: something happened",
  url: "https://bsky.app/profile/reporter.bsky.social/post/3kabc123",
  author: "A Reporter",
  body_excerpt: "Report: something happened to LeBron James, and here is the rest.",
  /* build() drops any item with no NBA entity - the accounts this feed follows
     post about other sports between NBA posts - so the fixture carries one. */
  players: ["lebron-james"],
  teams: []
}, extra || {});

const MAP = { players: { "lebron-james": "LeBron James" }, teams: {} };

/* build(lists, cfg, map, blocked) - cfg is the whole sources config, which is
   where the per-source switches and the excerpt length live. */
const cardFrom = (T, it) => {
  const built = T.build([{ items: [it], trending: false }], SOURCES, MAP, () => false);
  return built[0];
};

console.log("\nwhat the index supplies");

{
  const f = spy();
  const T = load(f);
  const c = cardFrom(T, item({
    enriched: true,
    avatar: "https://cdn.bsky.app/avatar/reporter.jpg",
    facets: [{ index: { byteStart: 0, byteEnd: 6 }, features: [] }],
    quote: { author: "Q", handle: "q.bsky.social", text: "the original", url: "https://x/q" },
    media: { type: "video", thumbnail: "https://x/t.jpg", playlist: "https://video.bsky.app/p.m3u8" }
  }));
  ck("a card is built", !!c && !!c.payload.post);
  const p = c.payload.post;
  ck("the avatar comes from the index", p.avatar === "https://cdn.bsky.app/avatar/reporter.jpg");
  ck("so do the facets", !!p.facets && p.facets.length === 1);
  ck("so does the quoted post", !!p.quote && p.quote.handle === "q.bsky.social");
  ck("and the HLS playlist, as before",
     p.media && p.media.playlist === "https://video.bsky.app/p.m3u8");
  ck("the post is marked complete", p.complete === true);
}

console.log("\na complete post is never re-requested");

{
  const f = spy();
  const T = load(f);
  const c = cardFrom(T, item({ enriched: true, avatar: "https://x/a.jpg" }));
  await T.enrichBluesky([c], SOURCES);
  ck("no request is made at all", f.calls.length === 0, f.calls.length + " call(s)");
}

console.log("\nan item from an older shard still is");

{
  /* No marker: this post predates the upstream change, so the AppView is still
   * the only place its facets and quote exist. */
  const f = spy();
  const T = load(f);
  const c = cardFrom(T, item());
  ck("the post is not marked complete", c.payload.post.complete === false);
  await T.enrichBluesky([c], SOURCES);
  ck("and the appview is called for it", f.calls.length === 1, f.calls.length + " call(s)");
  ck("at the public appview, not the authed host",
     /^https:\/\/public\.api\.bsky\.app\//.test(f.calls[0] || ""), (f.calls[0] || "").slice(0, 48));
}

console.log("\nthe mixed page, which is what a real one looks like for a while");

{
  const f = spy();
  const T = load(f);
  const newOne = cardFrom(T, item({ enriched: true, avatar: "https://x/a.jpg" }));
  const oldOne = cardFrom(T, item({ id: AT_OLD, title: "Report: a different thing",
    body_excerpt: "Report: a different thing about LeBron James.",
    url: "https://bsky.app/profile/reporter.bsky.social/post/3kold999" }));
  await T.enrichBluesky([newOne, oldOne], SOURCES);
  ck("one call, not two", f.calls.length === 1, f.calls.length + " call(s)");
  const asked = f.calls[0] || "";
  ck("and it asks only about the older post",
     asked.indexOf("3kold999") > 0 && asked.indexOf("3kabc123") < 0,
     asked.indexOf("uris=") > 0 ? asked.slice(asked.indexOf("uris=")) : "no url");
}

console.log("\nthe switch still works");

{
  const f = spy();
  const T = load(f);
  const c = cardFrom(T, item());
  await T.enrichBluesky([c], Object.assign({}, SOURCES, { enrich_bluesky: false }));
  ck("enrich_bluesky:false still skips everything, marker or not",
     f.calls.length === 0, f.calls.length + " call(s)");
}

console.log("\nand the note describing all this is accurate");

{
  /* It claimed the index truncates the post text. It does not: poll_bluesky
   * writes the whole thing into body_excerpt. A comment that is wrong about
   * why the code exists is how the code outlives its reason. */
  const note = String(SOURCES.enrich_note || "");
  ck("the note no longer claims the index truncates the text",
     !/index truncates/i.test(note), note.slice(0, 80) + "...");
  ck("and it says what the marker is for", /enriched/.test(note));
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the feed is still paying for what it already has"
                 : "a whole post costs no request");
process.exit(fail ? 1 : 0);
