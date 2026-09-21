/* Every card that can send a reader to one of our own tools sends them to
 * HoopsMatic.
 *
 *     node tools/test_hoopsmatic_routes.mjs
 *
 * WHY THIS EXISTS
 *
 * Several HoopsMatic tools are served from two addresses: a GitHub Pages URL
 * and a hoopsmatic.com route. The Pages copy works, looks identical, and costs
 * the site the visit. Worse, it teaches Google to index the wrong host, which
 * is what happened to the matchups section.
 *
 * js/cards.js holds a rewrite table, HM_ROUTES, and a function that applies it.
 * The table was right and the WIRING was not: onHoopsmatic() was called from
 * exactly one branch of tapTarget(), so 99 lean cards and 60 Career Map cards
 * shipped pointing at github.io while the fix for that very problem sat a few
 * lines above them. Nothing failed. Nothing looked wrong. The cards opened.
 *
 * That is the defect shape this file is built for: a rewrite that exists but is
 * not reached. It cannot be caught by reading the table, only by pushing real
 * card payloads through the real tapTarget and looking at what comes out.
 *
 * WHAT IT DOES NOT CHECK. Whether any of these URLs actually answers. That is
 * data/links.json and tools/test_links.mjs, which probe. This file is about
 * which host the feed CHOOSES, which is a question about this repo's code and
 * needs no network.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* The shipped renderer, against a bare window. Same technique as
 * tools/test_careermap_markup.mjs: the file the site serves, not a copy. */
const win = {};
new Function("window", "document", fs.readFileSync(path.join(REPO, "js", "cards.js"), "utf8"))(
  win, { createElement: () => ({}) });
const C = win.DoomCards;

console.log("\nthe table itself");

ck("HM_ROUTES is exported", Array.isArray(C.HM_ROUTES) && C.HM_ROUTES.length > 0,
   C.HM_ROUTES ? C.HM_ROUTES.length + " route(s)" : "(absent)");
ck("onHoopsmatic is exported", typeof C.onHoopsmatic === "function");
ck("tapTarget is exported", typeof C.tapTarget === "function");

/* THE FOOT-GUN. Headshots, team logos and the published JSON indexes are
 * fetched from GitHub Pages on purpose. Adding one of those prefixes to the
 * table would not redirect a visit, it would break every image in the feed -
 * and it is a tempting thing to do while making everything "route to
 * HoopsMatic". Named hosts rather than a pattern, so adding a genuinely new
 * destination does not trip it. */
const ASSET_HOSTS = ["nba-headshots", "nba-player-data"];
for (const [from] of (C.HM_ROUTES || [])) {
  const bad = ASSET_HOSTS.find(h => from.includes(h));
  ck("no asset host is in the rewrite table", !bad,
     bad ? `${bad} is an asset host, not a destination: ${from}` : "");
}
if (!(C.HM_ROUTES || []).length) ck("no asset host is in the rewrite table", false, "empty table");

console.log("\nwhat the rewrite does to a URL");

for (const [from, to] of (C.HM_ROUTES || [])) {
  ck(`${from.replace(/^https:\/\//, "")} -> ${to.replace(/^https:\/\//, "")}`,
     C.onHoopsmatic(from) === to, C.onHoopsmatic(from));
  /* The tail has to survive, or every deep link in the pools lands on a
   * homepage. This is the bug that would look like "the rewrite works". */
  const deep = from + "player.html?p=someone&x=1";
  ck("  and it carries the path and query across",
     C.onHoopsmatic(deep) === to + "player.html?p=someone&x=1", C.onHoopsmatic(deep));
}

{
  /* Everything else is left alone. Buzz cards point at Bluesky, Reddit,
   * YouTube and news outlets; a table that touched those would be a redirect
   * to a page that does not exist. */
  const foreign = [
    "https://bsky.app/profile/hoopshypeofficial.bsky.social/post/abc",
    "https://www.reddit.com/r/nba/comments/abc/",
    "https://hoopshype.com/rumors/",
    "https://hoopsmatic.com/compare?p1=A&p2=B",
    "https://jsierrahoopshype.github.io/nba-headshots/players/headshots/face/1.png"
  ];
  const changed = foreign.filter(u => C.onHoopsmatic(u) !== u);
  ck("a URL the table does not name is returned untouched", changed.length === 0,
     changed.join("  "));
}

console.log("\nevery card in every pool, through the real tapTarget");

/* The claim: if a card's payload carries a URL the table knows how to rewrite,
 * then the thing tapTarget hands the feed must be on hoopsmatic.com. Any card
 * type whose branch forgot to call onHoopsmatic fails here, by name, with a
 * count of how many readers it affects. */
const rewritable = u =>
  (C.HM_ROUTES || []).some(([from]) => String(u || "").indexOf(from) === 0);

const pools = fs.readdirSync(path.join(REPO, "data"))
  .filter(f => /-pool\.json$/.test(f) || f === "games.json")
  .sort();

const offenders = new Map();   // card type -> { n, sample }
let scanned = 0, carried = 0;

for (const f of pools) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(REPO, "data", f), "utf8")); }
  catch (e) { ck(`${f} parses`, false, e.message); continue; }
  for (const c of (j.cards || [])) {
    scanned++;
    const u = c && c.payload && c.payload.url;
    if (!rewritable(u)) continue;
    carried++;
    let got = null;
    try { got = C.tapTarget(c); } catch (e) { got = { url: "(threw: " + e.message + ")" }; }
    const out = got && got.url;
    if (!out || out.indexOf("https://hoopsmatic.com/") !== 0) {
      const k = c.type || "(no type)";
      if (!offenders.has(k)) offenders.set(k, { n: 0, sample: out || "(no tap target)", file: f });
      offenders.get(k).n++;
    }
  }
}

console.log(`  (${scanned} cards across ${pools.length} files, ` +
  `${carried} carrying a URL the table knows)`);

ck("no card type opens a GitHub Pages copy of one of our tools",
   offenders.size === 0,
   [...offenders].map(([t, v]) => `${t}: ${v.n} card(s) in ${v.file} -> ${v.sample}`).join("   |   "));

console.log("\nand the builders bake the right host in");

/* The render-time rewrite is a safety net for pools already deployed, not the
 * plan. A builder still writing a Pages URL means every rebuild re-creates the
 * problem and the net has to keep catching it forever. Data and asset
 * constants are skipped: only the value that ends up in a card's payload.url
 * is a destination. */
const BUILDERS = ["build_career_map.mjs", "build_lean.mjs", "build_oddities.mjs"];
for (const b of BUILDERS) {
  const p = path.join(REPO, "tools", b);
  if (!fs.existsSync(p)) { ck(`${b} exists`, false); continue; }
  const src = fs.readFileSync(p, "utf8");
  /* Only lines that assign a URL, so the explanatory comments above them -
   * which name the old prefix on purpose - do not fail their own file. */
  const bad = src.split("\n").filter(l =>
    !/^\s*(\*|\/\/|\/\*)/.test(l) && (C.HM_ROUTES || []).some(([from]) => l.includes(from)));
  ck(`${b} emits no rewritable URL`, bad.length === 0,
     bad.map(l => l.trim().slice(0, 70)).join(" | "));
}

console.log("\nand the registry agrees");

{
  const j = JSON.parse(fs.readFileSync(path.join(REPO, "data", "links.json"), "utf8"));
  const byId = new Map(j.links.map(l => [l.id, l]));
  /* Registered ahead of the card that will use it, so the card is not blocked
   * on the registry again. */
  const dt = byId.get("dream-team-game");
  ck("Beat the Dream Team has a registered address", !!dt, dt ? dt.url : "(absent)");
  ck("and it is a hoopsmatic.com one",
     !!dt && dt.url.indexOf("https://hoopsmatic.com/") === 0, dt && dt.url);

  /* A `page` entry still on github.io is either a deliberate exception or the
   * next instance of this bug. The deliberate ones say so with probe:false and
   * a note; anything else is reported. */
  const stragglers = j.links.filter(l =>
    l.kind === "page" && l.url.includes("github.io") && l.probe !== false);
  ck("no reader destination is registered on GitHub Pages without a reason",
     stragglers.length === 0,
     stragglers.map(l => l.id + " " + l.url).join("  "));
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a card in this feed opens the GitHub copy of a HoopsMatic tool"
                 : "every tap-through lands on hoopsmatic.com");
process.exit(fail ? 1 : 0);
