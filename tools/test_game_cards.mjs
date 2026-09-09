/* The cards that send a reader to the other games.
 *
 *     node tools/test_game_cards.mjs
 *
 * These are hand-written rather than built, which means the usual protection -
 * a builder that cannot produce a malformed card - does not exist here. A typo
 * in data/games.json ships a card that renders blank, or worse, one whose tap
 * goes nowhere. That is what this checks.
 *
 * The URLs themselves are checked by tools/test_links.mjs, which is where every
 * outbound destination in this repo is registered; a game URL that is not in
 * that registry fails there rather than here.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const games = JSON.parse(fs.readFileSync(path.join(REPO, "data/games.json"), "utf8"));
const win = {};
new Function("window", fs.readFileSync(path.join(REPO, "js/cards.js"), "utf8"))(win);
const render = win.DoomCards.render;
/* The renderer escapes everything, so a card whose text contains an
 * apostrophe comes back as &#39;. Comparing against the raw string would
 * fail on correct output, which is a test bug wearing a bug report. */
const esc = win.DoomCards.esc;

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

const cards = games.cards || [];

console.log("\nthe file itself");

{
  ck("it has cards", cards.length > 0, cards.length + " cards");
  ck("every id is unique", new Set(cards.map(c => c.id)).size === cards.length);
  ck("every card is type game", cards.every(c => c.type === "game"));
  ck("every card names at least one tab", cards.every(c => (c.tab || []).length > 0));
  ck("every card carries the tags the engine reads",
     cards.every(c => c.tags && c.tags.content_type === "game" &&
                      Array.isArray(c.tags.players) && Array.isArray(c.tags.teams)));
}

console.log("\nevery card states a challenge");

{
  const p = c => c.payload || {};
  ck("all have a game name", cards.every(c => (p(c).game || "").length > 1));
  ck("all have a hook", cards.every(c => (p(c).hook || "").length > 20));
  ck("all have a url", cards.every(c => /^https:\/\//.test(p(c).url || "")));
  ck("all have their own call to action", cards.every(c => (p(c).cta || "").length > 3));

  /* THE POINT OF THE FEATURE. A hook that just says "open the thing" is a nav
   * link, and a nav link in a feed gets scrolled past. Every hook has to say
   * what the reader would actually be doing. */
  const lazy = cards.filter(c => /^(open|play|try|visit|check out) /i.test(p(c).hook || ""));
  ck("no hook is just an instruction to open a page", lazy.length === 0,
     lazy.map(c => c.id).join(", "));
  ck("the hooks are all different",
     new Set(cards.map(c => p(c).hook)).size === cards.length);
}

console.log("\nthey render, and they lead somewhere");

{
  cards.forEach(c => {
    const html = render(c);
    const ok = html.indexOf(esc(c.payload.hook)) >= 0 &&
               html.indexOf('href="' + esc(c.payload.url) + '"') >= 0 &&
               html.indexOf(esc(c.payload.cta)) >= 0;
    ck(c.id, ok);
  });
}

console.log("\nescaping");

{
  const nasty = { id: "x", type: "game", tab: ["quiz"], tags: {},
    payload: { game: "<script>a</script>", hook: "<script>b</script>",
               note: "<script>c</script>", url: "https://example.invalid/\"onload=x",
               cta: "<script>d</script>" } };
  const html = render(nasty);
  ck("no raw script tag survives", html.indexOf("<script") < 0);
  ck("a quote in a url cannot break out of the attribute",
     !/href="[^"]*"[^>]*onload/.test(html));
}

console.log(fail ? "\n" + fail + " failure(s)"
                 : "\nevery card asks something, and every card leads somewhere real");
process.exit(fail ? 1 : 0);
