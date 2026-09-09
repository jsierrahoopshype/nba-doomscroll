/* You against the feed: the tally, and the two ways it could lie.
 *
 *     node tools/test_scoreboard.mjs
 *
 * A scoreboard that is wrong is worse than no scoreboard, and there are exactly
 * two ways this one could be:
 *
 *   1. IT COUNTS A CARD TWICE. The feed loops now - a section runs out, spills
 *      into the rest of the app, and starts again - so the same card really
 *      does come back, in a fresh DOM element that knows nothing about the
 *      first time it was answered. The per-element guard in app.js cannot see
 *      that. A 6-2 afternoon quietly becomes 30-10 by scrolling.
 *
 *   2. IT BREAKS THE CARD. localStorage throws in private windows, with site
 *      data blocked, and on a full quota. A tally is a garnish on a feed; it
 *      must fail to nothing rather than take the quiz down with it.
 *
 * Runs js/scoreboard.js against a fake window the way tools/test_yt_video.mjs
 * runs yt-video.js, with a localStorage stand-in that can be made to throw.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = fs.readFileSync(path.join(REPO, "js/scoreboard.js"), "utf8");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* A localStorage that behaves, until told not to. */
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

const D = (s) => new Date(s + "T12:00:00");

console.log("\nthe basic tally");

{
  const w = fakeWindow();
  const S = w.Scoreboard;
  S.record("q1", "quiz", true, D("2026-09-09"));
  S.record("q2", "quiz", false, D("2026-09-09"));
  S.record("t1", "trivia", true, D("2026-09-09"));
  const t = S.today(D("2026-09-09"));
  ck("right and wrong are counted separately", t.right === 2 && t.wrong === 1,
     t.right + "-" + t.wrong);
  ck("all three scorable types count",
     S.record("b1", "ballot", true, D("2026-09-09")).right === 3);
  ck("the lifetime total tracks too", S.total().right === 3 && S.total().wrong === 1);
}

console.log("\nthe loop cannot inflate it");

{
  /* THE ONE THAT MATTERS. */
  const w = fakeWindow();
  const S = w.Scoreboard;
  S.record("q1", "quiz", true, D("2026-09-09"));
  for (let i = 0; i < 12; i++) S.record("q1", "quiz", true, D("2026-09-09"));
  const t = S.today(D("2026-09-09"));
  ck("the same card answered thirteen times counts once",
     t.right === 1 && t.wrong === 0, t.right + "-" + t.wrong);
  ck("and a different card still counts",
     S.record("q2", "quiz", true, D("2026-09-09")).right === 2);
  ck("even a DIFFERENT answer to the same card does not re-score it",
     S.record("q1", "quiz", false, D("2026-09-09")).wrong === 0);
}

console.log("\nwhat is scorable");

{
  const w = fakeWindow();
  const S = w.Scoreboard;
  ck("quiz, trivia and ballot are", ["quiz", "trivia", "ballot"].every(S.scorable));
  /* These pose a question but do not TAKE an answer - the comparison reveals
   * itself. Scoring them would mean inventing a result nobody gave. */
  ck("vs, compare, mates and rumor are not",
     !["vs", "compare", "mates", "rumor", "buzz", "trade"].some(S.scorable));
  ck("an unscorable type is silently ignored, not counted",
     S.record("v1", "vs", true, D("2026-09-09")).right === 0);
  ck("a card with no id is ignored",
     S.record("", "quiz", true, D("2026-09-09")).right === 0);
}

console.log("\ndays and streaks");

{
  const w = fakeWindow();
  const S = w.Scoreboard;
  ["2026-09-06", "2026-09-07", "2026-09-08", "2026-09-09"].forEach((d, i) =>
    S.record("q" + i, "quiz", true, D(d)));
  ck("four consecutive days is a streak of four", S.streak(D("2026-09-09")) === 4,
     String(S.streak(D("2026-09-09"))));
  ck("today's tally is only today's", S.today(D("2026-09-09")).right === 1);

  /* A streak must not read as broken between midnight and the first answer. */
  ck("an unplayed today still counts yesterday's streak",
     S.streak(D("2026-09-10")) === 4, String(S.streak(D("2026-09-10"))));
  ck("but a missed day does break it", S.streak(D("2026-09-11")) === 0,
     String(S.streak(D("2026-09-11"))));
}

{
  const w = fakeWindow();
  const S = w.Scoreboard;
  S.record("a", "quiz", true, D("2026-09-01"));
  S.record("b", "quiz", true, D("2026-09-09"));
  ck("a gap means the streak is just today", S.streak(D("2026-09-09")) === 1);
}

console.log("\nthe header line");

{
  const w = fakeWindow();
  const S = w.Scoreboard;
  /* Silent at zero: "0-0 today" over a feed nobody has played is an
   * accusation, not information. */
  ck("nothing to say before the first answer", S.line(D("2026-09-09")) === "");
  S.record("q1", "quiz", true, D("2026-09-09"));
  S.record("q2", "quiz", false, D("2026-09-09"));
  ck("then it says the score", S.line(D("2026-09-09")) === "1-1 today",
     JSON.stringify(S.line(D("2026-09-09"))));
  ck("one day is not called a streak", S.line(D("2026-09-09")).indexOf("streak") < 0);
  S.record("q3", "quiz", true, D("2026-09-08"));
  ck("two days is", S.line(D("2026-09-09")).indexOf("2 day streak") >= 0,
     S.line(D("2026-09-09")));
}

console.log("\nstorage that does not work");

{
  /* Not merely empty - THROWING. A private window and a blocked-site-data
   * setting both raise on access, and a tally must never take a card down. */
  const w = fakeWindow({ throwOnRead: true });
  const S = w.Scoreboard;
  ck("a throwing read does not throw out", S.today().right === 0);
  ck("recording against it does not throw",
     typeof S.record("q1", "quiz", true).right === "number");
  ck("and the line is simply empty", S.line() === "");
}

{
  const w = fakeWindow({ throwOnWrite: true });
  const S = w.Scoreboard;
  ck("a throwing write does not throw out",
     typeof S.record("q1", "quiz", true).right === "number");
}

{
  const w = fakeWindow();
  w._store.set(w.Scoreboard.KEY, "{ this is not json");
  ck("corrupt stored data reads as an empty scoreboard", w.Scoreboard.today().right === 0);
  ck("and recording over it works", w.Scoreboard.record("q1", "quiz", true).right === 1);
}

console.log("\nbounds and wiping");

{
  const w = fakeWindow();
  const S = w.Scoreboard;
  /* 60 days in; only the newest 30 may survive, or the key grows forever. */
  for (let i = 1; i <= 60; i++) {
    const d = new Date(Date.UTC(2026, 0, i, 12));
    S.record("c" + i, "quiz", true, d);
  }
  const saved = JSON.parse(w._store.get(S.KEY));
  ck("history is trimmed to thirty days", Object.keys(saved.days).length <= 30,
     Object.keys(saved.days).length + " days kept");
  ck("the lifetime total is NOT trimmed with it", S.total().right === 60,
     String(S.total().right));
  ck("the seen-card list does not grow without bound",
     Object.keys(saved.seen).length < 10, Object.keys(saved.seen).length + " ids kept");
}

{
  const w = fakeWindow();
  const S = w.Scoreboard;
  S.record("q1", "quiz", true);
  S.reset();
  ck("reset wipes it", S.today().right === 0 && S.total().right === 0);
  ck("and the key is gone, not blanked", !w._store.has(S.KEY));
}

console.log(fail ? "\n" + fail + " failure(s)"
                 : "\none card, one point, and never at the cost of the card");
process.exit(fail ? 1 : 0);
