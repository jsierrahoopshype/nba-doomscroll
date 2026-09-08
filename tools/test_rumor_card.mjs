/* What a rumor card links, and what it must not.
 *
 *     node tools/test_rumor_card.mjs
 *
 * THE BUG THIS PINS DOWN. renderRumor used to wrap the whole excerpt in an
 * anchor, so every card in the Rumors tab arrived as a paragraph of underlined
 * link text. HoopsHype's own rumors page links the attribution, not the
 * sentence. The fix is one line of markup, which is exactly the kind of thing
 * that gets undone by a later edit without anyone noticing - a card that links
 * too much still renders, still works, and still looks deliberate.
 *
 * EVERY FIXTURE BELOW IS INVENTED. Not a paraphrase of a real rumor, not a
 * shortened one - made up, including the outlet and the URL. The archive
 * content rule applies to test files exactly as it does everywhere else.
 *
 * Runs js/cards.js the way tools/test_yt_video.mjs runs js/yt-video.js: the
 * real file against a bare window object, so this tests the renderer the site
 * ships rather than a copy of it.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", fs.readFileSync(path.join(REPO, "js/cards.js"), "utf8"))(win);
const render = win.DoomCards.render;

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

const TEXT = "Invented placeholder sentence standing in for a rumor excerpt.";
const OUTLET = "Invented Wire";
const SRC = "https://example.invalid/report/1";

const card = (payload) => ({
  id: "rumor-test-1",
  type: "rumor",
  tab: ["rumors"],
  live: true,
  tags: { content_type: "rumor", players: [], teams: [], era: "2020s" },
  payload: Object.assign({
    archive_date: "2019-03-14",
    outlet: OUTLET,
    source_url: SRC,
    text: TEXT,
    quote: null,
    on_this_day: false,
    years_ago: 0,
    player: null,
    face: null
  }, payload || {})
});

/* Everything inside an <a>...</a>, and everything outside it. Crude on purpose:
 * a regex is enough here because the renderer emits the anchors and they do not
 * nest, and it keeps this test free of a DOM. */
function split(html) {
  const inside = [];
  const outside = html.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/g, (m, body) => {
    inside.push(body);
    return " ";
  });
  return { inside: inside.join(" | "), outside };
}

console.log("\nwhat is a link and what is a sentence");

{
  const html = render(card());
  const { inside, outside } = split(html);

  /* THE ONE THAT MATTERS. */
  ck("the excerpt is NOT inside an anchor", inside.indexOf(TEXT) < 0);
  ck("the excerpt is still on the card", outside.indexOf(TEXT) >= 0);
  ck("the outlet IS inside an anchor", inside.indexOf(OUTLET) >= 0);
  ck("that anchor points at the report", html.indexOf('href="' + SRC + '"') >= 0);
  ck("it opens in a new tab, with noopener",
     /class="rumor-src"[^>]*target="_blank"[^>]*rel="noopener"/.test(html));

  /* The old markup put rumor-text and rumor-src on the same element. If they
   * ever share one again, the whole excerpt is underlined once more. */
  ck("rumor-text and rumor-src are not the same element",
     !/class="[^"]*rumor-text[^"]*rumor-src|class="[^"]*rumor-src[^"]*rumor-text/.test(html));

  /* Exactly two anchors: the source, and the card's own tap-through. A third
   * would mean something else on the card became a link. */
  const anchors = html.match(/<a\b/g) || [];
  ck("two anchors, no more", anchors.length === 2, anchors.length + " found");
  ck("the tap-through still goes to the rumors page, not the source",
     html.indexOf('href="https://hoopshype.com/rumors/"') >= 0);
}

{
  const html = render(card({ source_url: null }));
  ck("no source_url means no source anchor", (html.match(/rumor-src/g) || []).length === 0);
  ck("the outlet is printed anyway", html.indexOf(OUTLET) >= 0);
  ck("and the excerpt survives", html.indexOf(TEXT) >= 0);
}

console.log("\nthe face column");

{
  const withFace = render(card({ player: "A Test Player", face: "data/faces/a-test-player.png" }));
  ck("a resolved face gets a row", withFace.indexOf("rumor-row") >= 0);
  ck("and the image", withFace.indexOf('src="data/faces/a-test-player.png"') >= 0);
  ck("and the name, as an entity filter",
     withFace.indexOf('data-entity="A Test Player"') >= 0);

  const noFace = render(card());
  ck("no face means no row at all", noFace.indexOf("rumor-row") < 0);
  /* An initials circle for a rumor with no player tag would read as "some
   * unnamed person said this", which is worse than no column. */
  ck("and no initials circle standing in for nobody", noFace.indexOf("mt-ini") < 0);
}

console.log("\nescaping");

{
  const nasty = '</a><script>alert(1)</script>';
  const html = render(card({ text: nasty, outlet: nasty, player: nasty, face: "data/faces/x.png" }));
  ck("no raw script tag survives anywhere", html.indexOf("<script") < 0);
  ck("no raw closing anchor is injected into the markup",
     (html.match(/<\/a>/g) || []).length === 2,
     (html.match(/<\/a>/g) || []).length + " closing anchors");
}

console.log("\non this day");

{
  const html = render(card({ on_this_day: true, years_ago: 7 }));
  ck("the badge counts the years", html.indexOf("7 years ago today") >= 0);
  ck("one year is singular",
     render(card({ on_this_day: true, years_ago: 1 })).indexOf("1 year ago today") >= 0);
}

console.log(fail ? "\n" + fail + " failure(s)" : "\nthe rumor reads as a sentence; the source is the link");
process.exit(fail ? 1 : 0);
