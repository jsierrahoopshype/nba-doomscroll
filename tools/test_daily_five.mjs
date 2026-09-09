/* The Daily Five: the same five for everyone, and a grid that spoils nothing.
 *
 *     node tools/test_daily_five.mjs
 *
 * Two properties carry the whole feature, and both fail silently:
 *
 *   1. EVERY DEVICE MUST DERIVE THE SAME FIVE. If they do not, the grid is
 *      meaningless — two people compare results from different questions and
 *      neither can tell. Nothing on screen would say so.
 *
 *   2. THE GRID MUST NOT SPOIL ANYTHING. It is posted the day it is played, to
 *      people who have not played yet. A grid that leaked an answer, a player
 *      name or a question would poison the one thing that makes this spread.
 *
 * The pools are the real ones from data/, so the determinism is tested against
 * the cards that actually ship.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(REPO, "js/daily-five.js"), "utf8");

function fakeWindow(opts) {
  const o = opts || {};
  const store = new Map();
  const win = {
    localStorage: {
      getItem(k) { if (o.throwOnRead) throw new Error("blocked"); return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { if (o.throwOnWrite) throw new Error("quota"); store.set(k, String(v)); },
      removeItem(k) { store.delete(k); }
    },
    _store: store
  };
  new Function("window", SRC)(win);
  return win;
}

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* The shipped pools. */
const pool = [];
for (const f of ["quiz-pool", "trivia-pool", "ballot-pool"]) {
  const raw = JSON.parse(fs.readFileSync(path.join(REPO, "data", f + ".json"), "utf8"));
  /* The pool files are { generated, cards: [...] }, not a bare array. */
  (raw.cards || []).forEach(c => { if (c && c.id) pool.push(c); });
}

const W = fakeWindow();
const D = W.DailyFive;

console.log("\nthe pools this draws from");

{
  ck("all three shipped pools load", pool.length > 1000, pool.length + " cards");
  ck("and they are the answerable types",
     pool.every(c => D.TYPES[c.type]), [...new Set(pool.map(c => c.type))].join(","));
}

console.log("\nthe same five for everyone");

{
  const a = D.pick(pool, "2026-09-09").map(c => c.id);
  const b = D.pick(pool, "2026-09-09").map(c => c.id);
  ck("two draws on one day are identical", a.join() === b.join(), a.join(" "));

  /* A SECOND, INDEPENDENT MODULE INSTANCE — a different reader's browser. */
  const other = fakeWindow().DailyFive;
  ck("a separate device derives the same five",
     other.pick(pool, "2026-09-09").map(c => c.id).join() === a.join());

  /* Pool ORDER must not matter: two builds can serialise the same cards
   * differently and neither reader would ever know. */
  const shuffled = pool.slice().reverse();
  ck("shuffling the pool changes nothing",
     D.pick(shuffled, "2026-09-09").map(c => c.id).sort().join() === a.slice().sort().join());

  ck("five of them", a.length === 5, String(a.length));
  ck("no card twice", new Set(a).size === 5);
}

{
  const days = ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-12-25"];
  const sets = days.map(d => D.pick(pool, d).map(c => c.id).join());
  ck("a different day is a different five", new Set(sets).size === days.length);

  /* Across a month, the same card should not keep coming back. */
  const seen = {};
  for (let i = 1; i <= 28; i++) {
    D.pick(pool, "2026-10-" + ("0" + i).slice(-2)).forEach(c => { seen[c.id] = (seen[c.id] || 0) + 1; });
  }
  const most = Math.max(...Object.values(seen));
  ck("no card dominates a month of draws", most <= 2, "most repeated: " + most + " times");
}

{
  const five = D.pick(pool, "2026-09-09");
  const types = new Set(five.map(c => c.type));
  /* Five quiz cards would be a quiz, not a mix. */
  ck("the five span all three types", types.size === 3, [...types].join(","));
}

console.log("\nplaying through");

{
  const w = fakeWindow();
  const F = w.DailyFive;
  const ids = F.pick(pool, "2026-09-09").map(c => c.id);
  let s = F.state(ids, "2026-09-09");

  ck("it starts on the first question", F.current(s).index === 0);
  ck("and is not done", !F.done(s));

  s = F.answered(ids[0], true, ids, "2026-09-09");
  ck("answering advances", F.current(s).index === 1);
  ck("the score follows", F.score(s) === 1);

  /* The feed loops, so the same card comes back. It must not re-score or push
   * the run past five. */
  s = F.answered(ids[0], false, ids, "2026-09-09");
  ck("the same card answered twice does not count twice", s.results.length === 1);
  ck("nor overwrite the first result", F.score(s) === 1);

  /* A card that is not part of today's five is simply not this feature's
   * business, however it was answered. */
  s = F.answered("quiz-not-in-todays-five", true, ids, "2026-09-09");
  ck("a card outside the five is ignored", s.results.length === 1);

  for (let i = 1; i < 5; i++) s = F.answered(ids[i], i % 2 === 0, ids, "2026-09-09");
  ck("five answers finishes the run", F.done(s));
  ck("and there is no current question", F.current(s) === null);
  ck("the final score counts only the right ones", F.score(s) === 3, String(F.score(s)));
}

console.log("\nthe grid spoils nothing");

{
  const w = fakeWindow();
  const F = w.DailyFive;
  const five = F.pick(pool, "2026-09-09");
  const ids = five.map(c => c.id);
  let s = F.state(ids, "2026-09-09");
  [true, false, true, true, false].forEach((ok, i) => { s = F.answered(ids[i], ok, ids, "2026-09-09"); });

  const g = F.grid(s);
  const post = F.shareText(s);

  ck("five squares", [...g].length === 5, g);
  ck("in the order the questions came", g === "🟩🟥🟩🟩🟥", g);

  /* THE ONE THAT MATTERS. Nothing identifying may reach the post. */
  const answers = [];
  five.forEach(c => {
    const p = c.payload || {};
    [p.answer, p.player, p.question, p.detail, p.story].forEach(v => {
      if (typeof v === "string" && v.length > 3) answers.push(v);
    });
    (p.options || []).forEach(o => { if (typeof o === "string" && o.length > 3) answers.push(o); });
  });
  ck("the post carries no answer, option, player or question text",
     !answers.some(a => post.indexOf(a) >= 0),
     answers.length + " strings checked");
  ck("nor any card id", !ids.some(id => post.indexOf(id) >= 0));
  ck("but it does carry the date, so a grid is anchored to its day",
     post.indexOf("2026-09-09") >= 0);
  ck("and the score", post.indexOf("3/5") >= 0, post.split("\n")[1]);
}

{
  const w = fakeWindow();
  const F = w.DailyFive;
  const ids = ["a", "b", "c", "d", "e"];
  let s = F.state(ids, "2026-09-09");
  s = F.answered("a", true, ids, "2026-09-09");
  ck("an unfinished run shows blanks for what is left",
     F.grid(s) === "🟩⬜⬜⬜⬜", F.grid(s));
}

console.log("\na new day, and storage that fails");

{
  const w = fakeWindow();
  const F = w.DailyFive;
  const ids = ["a", "b", "c", "d", "e"];
  F.answered("a", true, ids, "2026-09-09");
  const fresh = F.state(ids, "2026-09-10");
  ck("tomorrow starts empty", fresh.results.length === 0);
  ck("and is not done", !F.done(fresh));
}

{
  const w = fakeWindow({ throwOnRead: true });
  const F = w.DailyFive;
  ck("a throwing read does not throw out", F.state(["a"], "2026-09-09").results.length === 0);
  ck("recording against it does not throw",
     Array.isArray(F.answered("a", true, ["a"], "2026-09-09").results));
}

{
  const w = fakeWindow({ throwOnWrite: true });
  ck("a throwing write does not throw out",
     Array.isArray(w.DailyFive.answered("a", true, ["a"], "2026-09-09").results));
}

{
  const w = fakeWindow();
  w._store.set(w.DailyFive.KEY, "{not json");
  ck("corrupt storage reads as a fresh run",
     w.DailyFive.state(["a"], "2026-09-09").results.length === 0);
}

console.log("\nedges");

{
  ck("an empty pool yields nothing", D.pick([], "2026-09-09").length === 0);
  ck("a pool smaller than five gives what there is",
     D.pick(pool.slice(0, 3), "2026-09-09").length === 3);
  ck("null does not throw", D.pick(null, "2026-09-09").length === 0);
  ck("sample cards are never used",
     D.pick([{ id: "x", type: "quiz", dummy: true }], "2026-09-09").length === 0);
  ck("unanswerable types are never used",
     D.pick([{ id: "r1", type: "rumor" }, { id: "b1", type: "buzz" }], "2026-09-09").length === 0);
  ck("the hash is stable across instances",
     D.hash("2026-09-09|quiz-1") === fakeWindow().DailyFive.hash("2026-09-09|quiz-1"));
}

console.log(fail ? "\n" + fail + " failure(s)"
                 : "\nsame five everywhere, and the grid gives nothing away");
process.exit(fail ? 1 : 0);
