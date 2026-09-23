/* §11: the answer run — attempts, correct, current and best, milestones at 3/5/10.
 *
 *     node tools/test_scoreboard_run.mjs
 *
 * WHAT IS EASY TO GET WRONG HERE
 *
 * js/scoreboard.js already had a `streak`, and it counts something else
 * entirely: consecutive DAYS played. The run counts consecutive CORRECT
 * ANSWERS. Two counters with similar names in one module is how a display ends
 * up showing one and labelling it the other, so both are exercised here and
 * each is checked against the other.
 *
 * The rest is the storage being hostile. localStorage throws in a private
 * window and comes back empty when site data is cleared, and this module is a
 * garnish on a feed: every path has to degrade to "no score" rather than to a
 * broken card. So the suite runs the real file against a stub that works, one
 * that throws on read, one that throws on write, and one that returns a
 * scoreboard written before runs existed.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const SRC = fs.readFileSync(path.join(REPO, "js", "scoreboard.js"), "utf8");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};
const eq = (name, got, want) =>
  ck(name, got === want, got === want ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

/** A fresh Scoreboard over a fresh fake localStorage. */
function fresh(store) {
  const mem = store || {};
  const win = {
    localStorage: {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; }
    }
  };
  new Function("window", SRC)(win);
  return { S: win.Scoreboard, mem };
}

let id = 0;
const answer = (S, correct, type) => S.record("card-" + (++id), type || "quiz", correct);

console.log("\na fresh reader owes nothing and has nothing");

{
  const { S } = fresh();
  const r = S.run();
  eq("no attempts", r.attempts, 0);
  eq("no correct", r.correct, 0);
  eq("no run", r.cur, 0);
  eq("no best", r.best, 0);
  /* The header says nothing at 0-0 on purpose: a scoreboard reading "0-0
   * today" on a feed nobody has played is an accusation, not information. */
  eq("and the line stays empty", S.line(), "");
}

console.log("\nthe run counts correct answers in a row");

{
  const { S } = fresh();
  answer(S, true);
  eq("one right is a run of one", S.run().cur, 1);
  answer(S, true);
  answer(S, true);
  eq("three right is a run of three", S.run().cur, 3);
  eq("and best follows it up", S.run().best, 3);
  eq("attempts counts both kinds", S.run().attempts, 3);
  eq("correct counts only the right ones", S.run().correct, 3);

  answer(S, false);
  eq("a wrong answer resets the run", S.run().cur, 0);
  /* THE POINT OF `best`. A personal best that evaporates on the next wrong
   * answer is not a best. */
  eq("but not the best", S.run().best, 3);
  eq("attempts still went up", S.run().attempts, 4);
  eq("correct did not", S.run().correct, 3);

  answer(S, true);
  answer(S, true);
  eq("a new run starts from one", S.run().cur, 2);
  eq("and best only moves when beaten", S.run().best, 3);
  answer(S, true);
  answer(S, true);
  eq("now it is beaten", S.run().best, 4);
}

console.log("\nmilestones at three, five and ten, and nowhere else");

{
  const { S } = fresh();
  eq("the milestones are 3, 5 and 10", S.MILESTONES.join(","), "3,5,10");

  const hits = [];
  for (let i = 1; i <= 12; i++) {
    const t = answer(S, true);
    if (t.milestone) hits.push(i);
  }
  eq("they fire at exactly those three", hits.join(","), "3,5,10");
  /* DELIBERATELY FINITE. A milestone at every fifth answer for ever becomes
   * wallpaper, and the eleventh in a row is not worth a word. */
  ck("nothing fires past ten", hits.indexOf(11) < 0 && hits.indexOf(12) < 0);

  const { S: S2 } = fresh();
  answer(S2, true); answer(S2, true);
  const wrong = answer(S2, false);
  eq("a wrong answer never carries a milestone", wrong.milestone, 0);
  /* And the run that was broken cannot claim the milestone on the way back
   * without actually getting there again. */
  answer(S2, true); answer(S2, true);
  const third = answer(S2, true);
  eq("the milestone comes again on a genuine new run of three", third.milestone, 3);

  eq("each milestone has a line of text", S.milestoneText(3), "Three in a row.");
  eq("and an unknown number has none", S.milestoneText(4), "");
  eq("as does zero", S.milestoneText(0), "");
}

console.log("\nevery correct answer from two up says something");

{
  /* Jorge on the first version: "That does not do much." It only spoke at 3, 5
   * and 10, so the fourth correct answer in a row got nothing and the run was
   * invisible while it was building. A streak you cannot see is not a streak. */
  const { S } = fresh();
  const lines = [];
  for (let i = 1; i <= 12; i++) lines.push(answer(S, true).runLine);

  eq("one right still says nothing", lines[0], "");
  ck("two right says something", lines[1].length > 0, lines[1]);
  ck("and so does every answer after it",
     lines.slice(1).every(l => l.length > 0),
     lines.map((l, i) => (i + 1) + ":" + (l || "-")).join("  "));

  ck("the milestones still say more than a number",
     lines[2] === "Three in a row." && lines[9] === "Ten in a row.",
     lines[2] + " / " + lines[9]);
  ck("the count keeps going past the last milestone",
     lines[10].indexOf("11 in a row") >= 0, lines[10]);
  ck("a wrong answer says nothing at all", answer(S, false).runLine === "");
}

console.log("\n`best yet` waits until there is something to beat");

{
  /* On a first unbroken run every answer IS a personal best, so saying so on
   * all of them is true and means nothing. It earns its place after a miss. */
  const { S } = fresh();
  const first = [];
  for (let i = 0; i < 4; i++) first.push(answer(S, true).runLine);
  ck("a never-broken run does not claim a best",
     first.every(l => l.indexOf("best yet") < 0),
     first.join(" | "));

  answer(S, false);
  const after = [];
  for (let i = 0; i < 6; i++) after.push(answer(S, true).runLine);
  ck("but beating the old mark does",
     after.some(l => l.indexOf("best yet") >= 0),
     after.join(" | "));
  /* And not before the old mark is actually passed. */
  ck("and only once it is actually passed",
     after[1].indexOf("best yet") < 0, after[1]);

  ck("runText is exported so this is testable",
     typeof S.runText === "function");
  eq("it refuses a run of one", S.runText(1, 1, true), "");
  eq("and a run of zero", S.runText(0, 5, true), "");
}

console.log("\nthe same card cannot pad the run");

{
  /* The feed loops: `rendered` is cleared once every card has been seen, so a
   * quiz card genuinely comes round again. The run has to move on the same
   * `seen` guard as the tally, or a reader could sit on one card and count to
   * ten. */
  const { S } = fresh();
  S.record("same-card", "quiz", true);
  S.record("same-card", "quiz", true);
  S.record("same-card", "quiz", true);
  eq("three answers to one card is a run of one", S.run().cur, 1);
  eq("and one attempt", S.run().attempts, 1);

  /* A card type that is not scored must not move it either. */
  const before = S.run().attempts;
  S.record("a-race", "race", true);
  eq("an unscored type does not count", S.run().attempts, before);
  S.record("", "quiz", true);
  eq("nor does a card with no id", S.run().attempts, before);
}

console.log("\nthe run is not the day streak");

{
  const { S } = fresh();
  for (let i = 0; i < 4; i++) answer(S, true);
  eq("four right in a row on day one is a run of four", S.run().cur, 4);
  /* THE CONFUSION THIS CHECK EXISTS FOR. Same module, similar name, different
   * thing: one visit is one day however well it goes. */
  eq("and a day streak of one", S.streak(), 1);
}

console.log("\nwhat the header line says");

{
  const { S } = fresh();
  answer(S, true);
  ck("one right says nothing about a run", S.line().indexOf("in a row") < 0, S.line());
  answer(S, true);
  answer(S, true);
  ck("three in a row is worth a word", S.line().indexOf("3 in a row") >= 0, S.line());
  ck("and the tally is still there", /^3-0 today/.test(S.line()), S.line());

  answer(S, false);
  ck("after a miss it shows the best instead of a live run",
     S.line().indexOf("best 3") >= 0 && S.line().indexOf("in a row") < 0, S.line());
}

console.log("\nstorage that fights back");

{
  /* A private window throws on read. The module must answer "no score", not
   * throw through to whatever called it. */
  const throwsOnRead = {};
  const win = {
    localStorage: {
      getItem: () => { throw new Error("SecurityError"); },
      setItem: () => { throw new Error("SecurityError"); },
      removeItem: () => {}
    }
  };
  new Function("window", SRC)(win);
  const S = win.Scoreboard;
  let threw = null;
  try {
    S.record("x", "quiz", true);
    ck("a run can be read when storage throws", S.run().cur === 0, JSON.stringify(S.run()));
    ck("and the line is empty rather than broken", S.line() === "", S.line());
  } catch (e) { threw = e; }
  ck("nothing propagates out of the module", !threw, threw && threw.message);
  void throwsOnRead;
}

{
  /* A scoreboard written before runs existed: days and totals, no `run`. */
  const mem = {};
  const pre = { days: { "2026-09-01": { right: 9, wrong: 1 } },
                total: { right: 9, wrong: 1 }, seen: {} };
  const probe = fresh();
  mem[probe.S.KEY] = JSON.stringify(pre);
  const { S } = fresh(mem);
  const r = S.run();
  ck("an older scoreboard reads without a run", r.cur === 0 && r.best === 0,
     JSON.stringify(r));
  /* NOT reconstructed from the old totals. Nine right across a month is not a
   * run of nine, and claiming it would be inventing a record the reader never
   * set. */
  ck("and the old totals are not turned into a best", r.best === 0, "best " + r.best);
  ck("the old totals survive", S.total().right === 9, JSON.stringify(S.total()));
  answer(S, true);
  eq("and a run starts from there", S.run().cur, 1);
}

{
  const mem = {};
  const probe = fresh();
  mem[probe.S.KEY] = "{not json";
  const { S } = fresh(mem);
  ck("unparseable storage reads as blank", S.run().attempts === 0);
  ck("and still records afterwards", (() => {
    S.record("after-garbage", "quiz", true);
    return S.run().cur === 1;
  })());
}

console.log("\nnothing leaves the browser, and nothing interrupts");

{
  /* §11 is explicit: localStorage only, no modal, no leaderboard, no login. */
  ck("the module makes no network call",
     !/\bfetch\s*\(|XMLHttpRequest|navigator\.sendBeacon/.test(SRC));
  ck("and one storage key holds all of it",
     (SRC.match(/localStorage/g) || []).length > 0 &&
     /var KEY = "doom\.score\.v1"/.test(SRC));

  const app = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(REPO, "css", "styles.css"), "utf8");
  ck("the run is written into the card's result area",
     /function showReward[\s\S]{0,700}querySelector\("\.quiz-result"\)/.test(app));
  ck("and never opens a dialog or a toast", (() => {
    const at = app.indexOf("function showReward");
    const body = app.slice(at, at + 2600);
    return !/toast\(|alert\(|showModal|<dialog/.test(body);
  })());
  ck("it is added once, not once per re-render",
     /querySelector\("\.quiz-run"\)\) return/.test(app));
  /* Counting call sites has to exclude the declaration, which matches the same
   * pattern - the mistake this repo has now made twice, once on clearFeed. */
  ck("the card element is passed in rather than queried for",
     /function scoreAnswer\(card, correct, cardEl\)/.test(app) &&
     (app.match(/(?<!function )scoreAnswer\(card, correct, cardEl\)/g) || []).length === 2,
     (app.match(/(?<!function )scoreAnswer\(card, correct, cardEl\)/g) || []).length + " call site(s)");
  ck("and it has a style", /\.quiz-run\{/.test(css));
}

/* THE REWARD, NOT THE REPORT.
 *
 * Jorge on the first version, which printed the run as a line of grey text:
 * "There should be some sort of reward for getting answers right." He was right
 * about why - the line said where you were and never what you were heading for,
 * so a run had no shape and nothing to reach. reward() is the target: the run,
 * the next milestone, and how far along the meter should sit.
 *
 * What is easy to get wrong: the meter must read FULL at a milestone and start
 * again below the next one, and it must stop rather than promise a reward that
 * never comes once the milestones run out. All three are checked. */
console.log("\nthe run has something to reach");

{
  const { S } = fresh();
  eq("next above nothing is the first milestone", S.nextMilestone(0), 3);
  eq("next above two is still three", S.nextMilestone(2), 3);
  eq("at three the target moves to five", S.nextMilestone(3), 5);
  eq("at five it moves to ten", S.nextMilestone(5), 10);
  /* Past the last milestone there is no target, and inventing one (15, 20, an
   * endless every-five) is what turns a reward into wallpaper. */
  eq("past ten there is no next", S.nextMilestone(10), 0);
  eq("and none beyond it either", S.nextMilestone(37), 0);
}

{
  const { S } = fresh();
  ck("one right answer earns no meter", answer(S, true).reward === null,
     "\"1 in a row\" is just an answer");

  const two = answer(S, true).reward;
  ck("two does", !!two);
  eq("and it counts two", two.run, 2);
  eq("aiming at three", two.next, 3);
  eq("two thirds of the way", Math.round(two.fill * 100), 67);
  eq("with no badge yet", two.hit, 0);

  const three = answer(S, true).reward;
  eq("the third answer hits the milestone", three.hit, 3);
  eq("and the meter reads full", three.fill, 1);
  eq("and the target moves on", three.next, 5);

  const four = answer(S, true).reward;
  eq("the fourth starts the next meter", four.run, 4);
  eq("still aiming at five", four.next, 5);
  eq("and is no longer full", four.fill, 0.8);
  eq("and has no badge", four.hit, 0);

  ck("a wrong answer earns nothing", answer(S, false).reward === null);
  const after = answer(S, true).reward;
  ck("and the meter starts over", after === null, "one right answer, no meter");
}

{
  /* Ten in a row: the last milestone. The badge appears, the meter fills, and
   * from eleven on there is no meter at all - by then the count is the reward. */
  const { S } = fresh();
  let rw = null;
  for (let i = 0; i < 10; i++) rw = answer(S, true).reward;
  eq("ten in a row is a milestone", rw.hit, 10);
  eq("and fills the meter", rw.fill, 1);
  const eleven = answer(S, true).reward;
  eq("eleven still counts", eleven.run, 11);
  eq("but has no target", eleven.next, 0);
  eq("and the meter is left full rather than empty", eleven.fill, 1);
}

console.log("\nthe card draws the meter, the badge and the chip");

{
  const app = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(REPO, "css", "styles.css"), "utf8");
  const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");

  ck("the card is given the reward, not just a line",
     /if \(tally && tally\.reward\) showReward\(cardEl, tally\.reward\);/.test(app));
  ck("the meter is drawn at the reward's own fill",
     /bar\.className = "quiz-run-bar";[\s\S]{0,400}Math\.min\(1, rw\.fill\)/.test(app));
  ck("and the badge only at a milestone", /if \(rw\.hit\) wrap\.appendChild\(runBadge/.test(app));
  ck("the badge posts the run to both networks",
     /ShareText\.runComposeUrl\(p\[0\], rw\.run, rw\.best/.test(app) &&
     /\["bsky", "Post on Bluesky"\], \["x", "Post on X"\]/.test(app));
  /* A composer opened outside the click handler is what a popup blocker eats,
   * and noopener is what stops the composer getting a handle on this window. */
  ck("in a new tab it cannot reach back through",
     /runComposeUrl[\s\S]{0,120}"_blank", "noopener,noreferrer"/.test(app));

  ck("the chip has somewhere to live", /id="runChip"/.test(html));
  ck("and is drawn after every answer", /renderRunChip\(\);/.test(app));
  ck("and on load, for a reader who comes back mid-run",
     /function renderSummary\(\)[\s\S]{0,300}renderRunChip\(\);/.test(app));
  /* Silent below two, and silent when a run breaks. A chip that announced the
   * end of a streak would make losing it the loudest thing on the page. */
  ck("it says nothing below two in a row",
     /if \(!r \|\| r\.cur < 2\) \{ el\.hidden = true;/.test(app));

  ck("the meter has a style", /\.quiz-run-bar\{/.test(css));
  ck("the badge has one", /\.quiz-run-badge\{/.test(css));
  ck("and the chip has one", /\.run-chip\{/.test(css));
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the run counter is not what the card claims"
                 : "runs count answers, days count days, and a miss costs the run but not the best");
process.exit(fail ? 1 : 0);
