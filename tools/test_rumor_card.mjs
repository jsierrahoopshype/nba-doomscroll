/* What a rumor card links, and what it must not.
 *
 *     node tools/test_rumor_card.mjs
 *
 * THE BUG THIS PINS DOWN. renderRumor used to wrap the whole excerpt in an
 * anchor, so every card in the Rumors tab arrived as a paragraph of underlined
 * link text. HoopsHype's own rumors page links ONE SPAN of an entry - often
 * starting partway in, with plain text on both sides - and puts the outlet
 * underneath as a second link. That is the shape these tests hold in place. A
 * card that links too much still renders, still works, and still looks
 * deliberate, which is exactly why it needs a test rather than an eye.
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

console.log("\nwhich part of the entry is the link");

/* The archive stores the excerpt and the passage it sits inside. All invented. */
const BEFORE = "An invented opening clause, then ";
const SPAN   = "the invented stretch that carries the link";
const AFTER  = ", and an invented continuation after it.";
const WHOLE  = BEFORE + SPAN + AFTER;

{
  /* THE ONE THAT MATTERS: the span starts PARTWAY IN, not at the beginning. */
  const html = render(card({ text: SPAN, quote: WHOLE }));
  const { inside, outside } = split(html);

  ck("the span IS inside an anchor", inside.indexOf(SPAN) >= 0);
  ck("what comes before it is NOT", inside.indexOf(BEFORE.trim()) < 0);
  ck("what comes after it is NOT", inside.indexOf(AFTER.trim()) < 0);
  ck("both sides are still on the card",
     outside.indexOf(BEFORE.trim()) >= 0 && outside.indexOf(AFTER.trim()) >= 0);
  ck("the span is not printed twice",
     (html.split(SPAN).length - 1) === 1, (html.split(SPAN).length - 1) + " occurrences");
  ck("no separate quote block, which would repeat the passage",
     html.indexOf("rumor-quote") < 0);
  ck("the span anchor points at the report",
     /class="rumor-link"[^>]*href="https:\/\/example\.invalid\/report\/1"/.test(html));

  ck("the outlet IS inside an anchor too", inside.indexOf(OUTLET) >= 0);
  ck("three anchors: span, outlet, tap-through",
     (html.match(/<a\b/g) || []).length === 3, (html.match(/<a\b/g) || []).length + " found");
  ck("the tap-through still goes to the rumors page, not the source",
     html.indexOf('href="https://hoopshype.com/rumors/"') >= 0);
}

{
  /* Whichever field is shorter is the excerpt. The renderer must not care which
   * of the two the archive happens to put it in. */
  const html = render(card({ text: WHOLE, quote: SPAN }));
  const { inside } = split(html);
  ck("it works when the SHORT one is `quote` instead", inside.indexOf(SPAN) >= 0);
  ck("and the surrounding text is still plain", inside.indexOf(AFTER.trim()) < 0);
}

{
  /* A span at the very start still works - that is just offset zero. */
  const html = render(card({ text: SPAN, quote: SPAN + AFTER }));
  const { inside } = split(html);
  ck("a span at offset zero is not a special case", inside.indexOf(SPAN) >= 0);
  ck("and nothing after it is linked", inside.indexOf(AFTER.trim()) < 0);
}

{
  /* A truncated excerpt carries an ellipsis the full passage does not. One
   * character, and without handling it the match misses every long entry. */
  const html = render(card({ text: SPAN + "...", quote: WHOLE }));
  ck("an ellipsis on the excerpt does not break the match",
     html.indexOf("rumor-link") >= 0);
  ck("and the ellipsis itself is not inside the link",
     split(html).inside.indexOf("...") < 0);
}

console.log("\ntypography the two fields do not agree on");

/* The fields are scraped separately, so one can carry curly quotes where the
 * other has straight ones. A plain indexOf misses, and the miss is invisible -
 * the card just quietly falls back to linking the outlet. */
{
  const straight = 'he said "an invented thing" out loud';
  const curly    = 'Before it, he said “an invented thing” out loud, and after it.';
  const html = render(card({ text: straight, quote: curly }));
  const { inside } = split(html);
  ck("curly quotes match straight ones", html.indexOf("rumor-link") >= 0);
  ck("and the ORIGINAL typography is what renders, not a flattened copy",
     html.indexOf("“an invented thing”") >= 0);
  ck("the matched span is the linked one", inside.indexOf("an invented thing") >= 0);
}

{
  const tight = "an invented phrase with one space";
  const loose = "Before.  an invented  phrase with one space  After.";
  ck("a run of whitespace on one side still matches",
     render(card({ text: tight, quote: loose })).indexOf("rumor-link") >= 0);
}

{
  const hyphen = "a well-known invented phrase";
  const dash   = "Before it, a well–known invented phrase, after it.";
  ck("an en dash matches a hyphen",
     render(card({ text: hyphen, quote: dash })).indexOf("rumor-link") >= 0);
}

console.log("\nwhen there is no span to find");

{
  /* Neither field contains the other. Linking an arbitrary stretch would be
   * worse than linking nothing, so the card falls back to the outlet alone. */
  const html = render(card({ text: TEXT, quote: "An unrelated invented quotation." }));
  const { inside, outside } = split(html);
  ck("the excerpt is NOT inside an anchor", inside.indexOf(TEXT) < 0);
  ck("the excerpt is still on the card", outside.indexOf(TEXT) >= 0);
  ck("the outlet carries the only body link", inside.indexOf(OUTLET) >= 0);
  ck("the quote gets its own block, as before", html.indexOf("rumor-quote") >= 0);
  ck("two anchors, no more", (html.match(/<a\b/g) || []).length === 2,
     (html.match(/<a\b/g) || []).length + " found");
}

{
  const html = render(card());   // no quote at all
  const { inside, outside } = split(html);
  ck("one field alone cannot make a span", html.indexOf("rumor-link") < 0);
  ck("and the excerpt stays plain", inside.indexOf(TEXT) < 0 && outside.indexOf(TEXT) >= 0);
}

{
  const html = render(card({ source_url: null, text: SPAN, quote: WHOLE }));
  ck("no source_url means no link anywhere in the body",
     html.indexOf("rumor-src") < 0 && html.indexOf("rumor-link") < 0);
  ck("the outlet is printed anyway", html.indexOf(OUTLET) >= 0);
  ck("and the passage survives", html.indexOf(SPAN) >= 0);
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
  const html = render(card({ text: nasty, quote: "before " + nasty + " and more",
                             outlet: nasty, player: nasty, face: "data/faces/x.png" }));
  ck("no raw script tag survives anywhere", html.indexOf("<script") < 0);
  /* A closing anchor smuggled through the lead would end the link early and
     leave the rest of the entry as markup. Three anchors open, three close. */
  ck("no raw closing anchor is injected into the markup",
     (html.match(/<\/a>/g) || []).length === 3,
     (html.match(/<\/a>/g) || []).length + " closing anchors");
  ck("as many closes as opens", (html.match(/<a\b/g) || []).length === 3);
}

console.log("\non this day");

{
  const html = render(card({ on_this_day: true, years_ago: 7 }));
  ck("the badge counts the years", html.indexOf("7 years ago today") >= 0);
  ck("one year is singular",
     render(card({ on_this_day: true, years_ago: 1 })).indexOf("1 year ago today") >= 0);
}

console.log(fail ? "\n" + fail + " failure(s)" : "\none span is the link; the entry around it is a sentence");
process.exit(fail ? 1 : 0);
