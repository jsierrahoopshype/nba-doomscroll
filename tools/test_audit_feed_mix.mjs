/* The audit tool itself, end to end.
 *
 *     node tools/test_audit_feed_mix.mjs
 *
 * tools/test_feed_stats.mjs proves the measurements are correct. This proves
 * the instrument is wired to the thing it claims to measure, which is a
 * different question and the one that would waste a tuning pass:
 *
 *   - it runs at all, against the real pools and the real engine
 *   - the same seed gives the same report, or two runs cannot be compared
 *   - the live dial actually moves the live share, or the supply sweep is
 *     measuring nothing
 *   - the cold-start block is computed over the first N cards and not over the
 *     whole session, which is the distinction the whole brief turns on
 *   - it reads the app's constants rather than restating them
 *
 * No network. Slower than the other suites, because it drives twenty sessions.
 */

import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const AUDIT = path.join(__dirname, "audit_feed_mix.mjs");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

function run(args) {
  return execFileSync(process.execPath, [AUDIT].concat(args), {
    cwd: REPO, encoding: "utf8", maxBuffer: 1 << 24
  });
}

/* Small and fast: these assertions are about wiring, not about the numbers. */
const FAST = ["--cards", "120", "--runs", "4", "--cold", "40"];

console.log("\nit runs against the real archive and the real engine");

let out;
{
  let err = null;
  try { out = run(FAST.concat(["--live", "50"])); } catch (e) { err = e; }
  ck("exits clean", !err, err && String(err.message).slice(0, 200));
  if (err) { console.log("\n1 failed\nthe audit does not run"); process.exit(1); }

  /* The header names WHICH path ran, and since Stage 3 there are two: For You
   * goes through DoomSchedule and --legacy drives the pre-scheduler sampleMixed
   * path so the before/after comparison uses the same seeds. A report that does
   * not say which one it measured is worthless for tuning. */
  ck("says it drove the shipped scheduler",
     /sampler:\s+the shipped DoomSchedule \+ E\.sample/.test(out),
     (out.match(/sampler:.*/) || [""])[0].trim());
  /* indexOf rather than a regex: tools/test_lib_imports.mjs reads every tools/
   * file for undeclared names, and a regex literal holding spaces and hyphens
   * reads to it as division followed by identifiers. A plain string keeps the
   * lint honest instead of teaching it to ignore this line. */
  ck("and --legacy says it drove the old path", (() => {
    const old = run(FAST.concat(["--live", "50", "--legacy"]));
    return old.indexOf("the pre-Stage-3 E.sampleMixed path") >= 0;
  })());
  ck("read the whole archive", /archive:\s+\d{4} cards/.test(out),
     (out.match(/archive:.*/) || [""])[0].trim());
  ck("reports a cold-start block", /COLD START, FIRST 40 CARDS/.test(out));
  ck("reports a whole-session block", /WHOLE SESSION \(120 cards\)/.test(out));
  ck("lists violations", /VIOLATIONS: \d+/.test(out));
  ck("states the ceiling live supply imposes", /CEILING: with 50 live cards/.test(out));
}

console.log("\nthe same seed gives the same report");

{
  const a = run(FAST.concat(["--live", "50", "--seed", "7"]));
  const b = run(FAST.concat(["--live", "50", "--seed", "7"]));
  ck("two runs of seed 7 are identical", a === b,
     a === b ? "" : "the report is not reproducible, so before/after cannot be compared");
  const c = run(FAST.concat(["--live", "50", "--seed", "8"]));
  /* And a different seed must actually differ, or the seed is being ignored
   * and every run is measuring one arrangement of the archive. */
  ck("seed 8 differs from seed 7", a !== c);
}

console.log("\nthe live dial moves the live share");

const liveShare = (txt) => {
  /* The cold-start block is printed first, so the first match is its number. */
  const m = txt.match(/current NBA \(live\)\s+([0-9.]+)%/);
  return m ? parseFloat(m[1]) : NaN;
};

{
  const at0 = run(FAST.concat(["--live", "0"]));
  const at20 = run(FAST.concat(["--live", "20"]));
  const at120 = run(FAST.concat(["--live", "120"]));
  const s0 = liveShare(at0), s20 = liveShare(at20), s120 = liveShare(at120);

  /* With no live supply the feed CANNOT contain a live card. If this ever
   * reports otherwise, the synthetic supply is leaking into the archive count
   * and every live number in the report is fiction. */
  ck("no live supply means no live cards", s0 === 0, s0 + "%");
  ck("20 live cards put live cards in the feed", s20 > 0, s20 + "%");
  ck("120 is not below 20", s120 >= s20, `${s20}% -> ${s120}%`);
  /* The plateau is the finding, not a bug: BUZZ_SHARE caps the reserved block,
   * so past a certain supply more live cards do not raise the share. Asserted
   * as a bound rather than a value so it does not have to be re-tuned. */
  ck("and the share is capped well below 100%", s120 < 80, s120 + "%");

  /* §4: Rumors must not appear in For You. Today they are absent because no
   * rumor pool is committed; the assertion is here so it fails if one is. */
  ck("no rumor cards reach the feed", !/\brumor\b/.test(at120));
}

console.log("\nthe cold-start block is a different window, not a copy");

{
  /* One card of cold start against a 200-card session. If the two blocks match,
   * the slice is not happening and every cold-start number in the report is
   * really a whole-session number. */
  const txt = run(["--cards", "200", "--runs", "2", "--cold", "1", "--live", "50"]);
  const nums = [...txt.matchAll(/current NBA \(live\)\s+([0-9.]+)%/g)].map(m => parseFloat(m[1]));
  ck("both blocks report a live share", nums.length === 2, nums.join(" / "));
  ck("the first card's share differs from the session's", nums[0] !== nums[1],
     nums.join("% / ") + "%");
  /* A single-card window can only be 0 or 100. */
  ck("a one-card window is all-or-nothing", nums[0] === 0 || nums[0] === 100, nums[0] + "%");
  ck("says which window it used", /cold-start window: first 1 cards/.test(txt));
}

console.log("\nit reads the app's constants rather than restating them");

{
  const app = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");
  const of = (name) => {
    const m = app.match(new RegExp("var\\s+" + name + "\\s*=\\s*([0-9.*\\s]+);"));
    return m ? Function('"use strict";return (' + m[1] + ")")() : null;
  };
  const batch = of("BATCH"), share = of("BUZZ_SHARE"), win = of("DIVERSITY_WINDOW");
  ck("js/app.js still declares the constants the audit reads",
     batch != null && share != null && win != null,
     `BATCH=${batch} BUZZ_SHARE=${share} DIVERSITY_WINDOW=${win}`);
  ck("and the report echoes those exact values",
     out.indexOf(`BATCH=${batch} BUZZ_SHARE=${share} DIVERSITY_WINDOW=${win}`) >= 0,
     (out.match(/constants:.*/) || [""])[0].trim());
  /* MIXED_CAPS is echoed as JSON, so a cap added in app.js shows up here
   * without this test needing to know what it is. */
  const capNames = (app.match(/var\s+MIXED_CAPS\s*=\s*\{([^}]*)\}/) || ["", ""])[1]
    .split(",").map(s => s.split(":")[0].trim()).filter(Boolean);
  ck("every MIXED_CAPS entry is echoed", capNames.length > 0 &&
     capNames.every(n => out.indexOf('"' + n + '"') >= 0), capNames.join(", "));
}

console.log("\n--sample prints a readable first fifty");

{
  const txt = run(["--cards", "60", "--runs", "1", "--live", "50", "--sample"]);
  ck("prints the sample block", /FIRST 50 CARDS OF ONE SESSION/.test(txt));
  const lines = txt.split("\n").filter(l => /^\s+\d+\.\s/.test(l));
  ck("fifty numbered cards", lines.length === 50, lines.length + " lines");
  /* Each line has to name a bucket, or the sample cannot be read editorially. */
  const buckets = ["live", "game", "history_record", "comparison",
                   "awards_voting", "money_cap_static", "other"];
  ck("every line names an editorial bucket",
     lines.every(l => buckets.some(b => l.indexOf(b) >= 0)),
     (lines.find(l => !buckets.some(b => l.indexOf(b) >= 0)) || "").trim());
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the audit cannot be trusted to tune against"
                 : "the audit measures the shipped feed, reproducibly");
process.exit(fail ? 1 : 0);
