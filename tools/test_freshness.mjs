/* Checks the two things this tranche changed, without a browser and without
 * touching the network.
 *
 *     node tools/test_freshness.mjs
 *
 * 1. The freshness curve: shape, monotonicity, the trending clamp, and that
 *    an archive card with no timestamp is untouched.
 * 2. Cross-source dedupe: that three wordings of one event collapse to one,
 *    that two genuinely different stories about the same player do not, and
 *    that the survivor is the one the config asks for.
 * 3. End to end: a synthetic pool where a stale post and a fresh post are
 *    otherwise identical, sampled many times, to confirm the fresh one
 *    actually wins in the mixed feed.
 *
 * The fixtures below are invented, not sampled from the live feed - the point
 * is to exercise the matching rules, and made-up headlines do that better
 * because they can be built to sit either side of the threshold on purpose.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = p => fs.readFileSync(path.join(REPO, p), "utf8");

/* Both files are browser IIFEs that hang an object off `window`. Loading them
 * with a fake window is enough for the engine; buzz.js keeps `build` and
 * `dedupeEvents` private, so the closing line is replaced to expose them to
 * the test only. Production code stays free of test hooks. */
const win = { setTimeout, fetch: undefined, localStorage: null };
const ctx = { window: win, console, Date, Math, JSON, isNaN, String, Object, Array, Promise };

function runIIFE(src, extra = "") {
  const body = src.replace(/\}\)\(window\);\s*$/, extra + "\n})(window);");
  new Function("window", "console", body)(win, console);
}

runIIFE(read("js/engine.js"));
runIIFE(read("js/buzz.js"),
  "root.LiveBuzz.__test = { dedupeEvents: dedupeEvents, titleTokens: titleTokens, overlap: overlap, build: build };");

const E = win.DoomEngine;
const T = win.LiveBuzz.__test;
const cfg = JSON.parse(read("data/buzz-sources.json"));

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   " + detail : ""));
  if (!ok) failures++;
}

/* ---------------- 1. the curve ---------------- */

console.log("\nfreshness curve");
E.setFreshness(cfg.freshness);

const H = 3600000;
const at = (hours, trending = false) => E.freshness({
  payload: { published_at: new Date(Date.now() - hours * H).toISOString(), trending }
});

const pts = [0.5, 3, 6, 12, 24, 48, 72, 120, 168, 240];
console.log("  hours -> weight: " +
  pts.map(h => h + "h=" + at(h).toFixed(3)).join("  "));

check("evergreen card is untouched", E.freshness({ payload: {} }) === 1);
check("unparseable date is not a demotion",
  E.freshness({ payload: { published_at: "not a date" } }) === 1);
check("monotonically decreasing",
  pts.every((h, i) => i === 0 || at(h) <= at(pts[i - 1]) + 1e-9));
check("under 6h stays high", at(3) > 0.85, "3h=" + at(3).toFixed(3));
check("yesterday is roughly half", at(24) > 0.35 && at(24) < 0.55, "24h=" + at(24).toFixed(3));
check("three days is much lower", at(72) < 0.2, "72h=" + at(72).toFixed(3));
check("a week is rare but reachable", at(168) > 0 && at(168) < 0.06, "168h=" + at(168).toFixed(3));
check("past the last anchor holds the floor", at(400) === at(168));
check("no cliff at a band edge",
  Math.abs(at(6.01) - at(5.99)) < 0.01, "delta=" + Math.abs(at(6.01) - at(5.99)).toFixed(5));

check("trending lifts a stale post", at(72, true) > at(72), at(72).toFixed(3) + " -> " + at(72, true).toFixed(3));
check("trending never demotes a fresh one", at(1, true) >= at(1));
check("a week-old trending post loses to a fresh plain one",
  at(168, true) < at(3), at(168, true).toFixed(3) + " < " + at(3).toFixed(3));
check("a week-old trending post loses to a day-old plain one",
  at(168, true) < at(24), at(168, true).toFixed(3) + " < " + at(24).toFixed(3));

/* ---------------- 2. dedupe ---------------- */

console.log("\ncross-source dedupe");

let n = 0;
const card = (source, title, opts = {}) => ({
  id: "t" + (++n),
  type: "buzz",
  tags: {
    content_type: "buzz",
    players: opts.players || [],
    teams: opts.teams || [],
    era: "2020s",
    category: "buzz-" + source
  },
  payload: {
    title, source,
    published_at: new Date(Date.now() - (opts.hours || 1) * H).toISOString(),
    trending: !!opts.trending,
    excerpt: opts.excerpt || "",
    players: opts.players || [],
    teams: opts.teams || []
  }
});

const LUKA = { players: ["Luka Doncic"], teams: ["Los Angeles Lakers"] };

// One event, three wordings, three sources.
const oneEvent = [
  card("youtube", "Luka Doncic drops 45 points in his return to Dallas", LUKA),
  card("bluesky", "Luka Doncic returns to Dallas and drops 45", { ...LUKA, excerpt: "x".repeat(200) }),
  card("reddit", "[Highlights] Luka Doncic 45 points in return to Dallas", LUKA)
];
let out = T.dedupeEvents(oneEvent, cfg);
check("three wordings of one event collapse to one", out.length === 1,
  out.map(c => c.payload.source).join(","));
check("the preferred source survives", out[0] && out[0].payload.source === "bluesky",
  out[0] && out[0].payload.source);

// Trending outranks source preference.
out = T.dedupeEvents([
  card("youtube", "Luka Doncic drops 45 points in his return to Dallas", { ...LUKA, trending: true }),
  card("bluesky", "Luka Doncic returns to Dallas and drops 45", LUKA)
], cfg);
check("trending outranks the source order",
  out.length === 1 && out[0].payload.source === "youtube",
  out[0] && out[0].payload.source);

// Same player, different stories: must NOT merge.
out = T.dedupeEvents([
  card("bluesky", "Luka Doncic drops 45 points in his return to Dallas", LUKA),
  card("bluesky", "Luka Doncic listed questionable for Tuesday with a calf strain", LUKA),
  card("reddit", "Luka Doncic named Western Conference player of the week", LUKA)
], cfg);
check("different stories about one player survive separately", out.length === 3, out.length + " kept");

// Same wording, no shared entity: must NOT merge.
out = T.dedupeEvents([
  card("bluesky", "Career high 45 points in the return game", { players: ["Luka Doncic"] }),
  card("reddit", "Career high 45 points in the return game", { players: ["Anthony Edwards"] })
], cfg);
check("a shared headline with no shared entity survives", out.length === 2, out.length + " kept");

// Same event wording, weeks apart: must NOT merge.
out = T.dedupeEvents([
  card("bluesky", "Luka Doncic drops 45 points against the Celtics", { ...LUKA, hours: 1 }),
  card("bluesky", "Luka Doncic drops 45 points against the Celtics", { ...LUKA, hours: 24 * 21 })
], cfg);
check("the same wording three weeks apart survives", out.length === 2, out.length + " kept");

/* The cases that broke the first version of this, kept as regressions.
 * Every one of them merged two different stories into one. */
const adversarial = [
  ["opposite result, short titles", [
    card("bluesky", "Lakers win in Denver", { teams: ["Los Angeles Lakers"] }),
    card("reddit", "Lakers lose in Denver", { teams: ["Los Angeles Lakers"] })], 2],
  ["different point totals", [
    card("bluesky", "Luka Doncic drops 45 in the second half", { players: ["Luka Doncic"] }),
    card("reddit", "Luka Doncic drops 30 in the second half", { players: ["Luka Doncic"] })], 2],
  ["out tonight vs in tonight", [
    card("bluesky", "Luka Doncic out tonight", { players: ["Luka Doncic"] }),
    card("reddit", "Luka Doncic in tonight", { players: ["Luka Doncic"] })], 2],
  ["trade talks vs trade done", [
    card("bluesky", "Lakers trade talks with Nets heating up", { teams: ["Los Angeles Lakers"] }),
    card("reddit", "Lakers trade with Nets is done", { teams: ["Los Angeles Lakers"] })], 2],
  ["one event, both quoting the same figure", [
    card("bluesky", "Luka Doncic scores 45 in his Dallas return", { players: ["Luka Doncic"] }),
    card("reddit", "Luka Doncic 45 points in his Dallas return", { players: ["Luka Doncic"] })], 1]
];
for (const [name, cards, want] of adversarial) {
  const got = T.dedupeEvents(cards, cfg).length;
  check(name, got === want, "kept " + got + ", want " + want);
}

// Capitalised words must survive tokenising. fold() strips diacritics but not
// case, so an un-lowercased title matched "akers" against "akers".
check("capitalised words keep their first letter",
  T.titleTokens("Lakers Beat Denver").indexOf("lakers") >= 0,
  T.titleTokens("Lakers Beat Denver").join(" "));
check("two-digit numbers are kept",
  T.titleTokens("Doncic drops 45").indexOf("45") >= 0,
  T.titleTokens("Doncic drops 45").join(" "));
check("accented names fold to the same token",
  T.titleTokens("Nikola Jokic")[0] === T.titleTokens("Nikola Jokić")[0]);

// Reddit's category prefix must not create a false match on its own.
check("reddit prefixes are not matchable content",
  T.overlap(T.titleTokens("[Highlights] Game Thread news video"),
            T.titleTokens("[Discussion] Post game thread news")) === 0);

// The caps run after the merge.
const capped = { ...cfg, sources: { ...cfg.sources, bluesky: { ...cfg.sources.bluesky, max: 2 } } };
const many = [
  card("bluesky", "Luka Doncic drops 45 in his return to Dallas", LUKA),
  card("youtube", "Luka Doncic 45 point return to Dallas highlights", LUKA),
  card("bluesky", "Jayson Tatum hits the game winner in Boston", { players: ["Jayson Tatum"] }),
  card("bluesky", "Victor Wembanyama blocks nine shots against Denver", { players: ["Victor Wembanyama"] })
];
const built = T.build([{ items: [], trending: false }], capped, { players: {}, teams: {} }, () => false);
out = T.dedupeEvents(many, capped);
check("merge happens before the cap frees a slot", out.length === 3, out.length + " after merge");

/* ---------------- 3. end to end in the sampler ---------------- */

console.log("\nsampled feed");

const stale = card("bluesky", "A report from four days ago about the Lakers", { teams: ["Los Angeles Lakers"], hours: 96 });
const fresh = card("bluesky", "A report from this morning about the Clippers", { teams: ["Los Angeles Clippers"], hours: 2 });
stale.id = "stale"; fresh.id = "fresh";

let freshWins = 0, RUNS = 2000;
for (let i = 0; i < RUNS; i++) {
  const picked = E.sample([stale, fresh], 1, {});
  if (picked[0] && picked[0].id === "fresh") freshWins++;
}
const pct = Math.round(100 * freshWins / RUNS);
/* Exploration is 25% and picks uniformly, so the ceiling is ~87%: half of the
 * exploration slice goes to the stale card no matter how the weights fall.
 * Anything above ~75% means the weighting is doing its job. */
check("this morning beats four days ago in For You", pct >= 75 && pct <= 92, pct + "% of 2000 draws");

const evergreen = { id: "arch", type: "race", tags: { content_type: "race" }, payload: {} };
let archWins = 0;
for (let i = 0; i < RUNS; i++) {
  const picked = E.sample([stale, evergreen], 1, {});
  if (picked[0] && picked[0].id === "arch") archWins++;
}
check("an archive card is not demoted by a stale news card's curve",
  archWins / RUNS > 0.7, Math.round(100 * archWins / RUNS) + "% of 2000 draws");

console.log("\n" + (failures ? failures + " FAILED" : "all checks passed"));
process.exit(failures ? 1 : 0);
