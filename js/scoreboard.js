/* NBA Doomscroll — you against the feed.
 *
 * Quiz, trivia and ballot cards already know whether you got it right, and
 * until now that knowledge died on the card. This keeps it: a running tally
 * for today, a lifetime one, and a streak of days played.
 *
 * ENTIRELY LOCAL, like everything else here. One localStorage key. Nothing is
 * sent anywhere, there is no account, and the panel's "delete all data" wipes
 * it along with the rest.
 *
 * A CARD IS SCORED ONCE, EVER. The feed loops now — a section runs out, spills
 * into the rest of the app, then starts again — so the same card genuinely does
 * come back, in a fresh DOM element that knows nothing about the first time.
 * The per-element guard in app.js cannot see that. This can, and the id it
 * remembers is what stops a 6-2 afternoon turning into 30-10 by scrolling.
 *
 * DAYS ARE THE READER'S DAYS, not UTC. At 8pm in Los Angeles it is already
 * tomorrow in UTC, and being told your streak broke while you are still playing
 * is the kind of small wrongness that makes a feature feel broken. Same call
 * js/rumors.js makes for on-this-day.
 */
(function (root) {
  "use strict";

  var KEY = "doom.score.v1";
  /* Thirty days of history is enough for a streak and a chart, and bounds the
   * key at a few KB. Older days are dropped on write, not read, so the trim
   * actually happens rather than being recomputed forever. */
  var KEEP_DAYS = 30;

  var SCORED = { quiz: 1, trivia: 1, ballot: 1, capcall: 1 };

  /* §11: three, five and ten. Deliberately short and deliberately finite - a
   * milestone at every multiple of five for ever turns into wallpaper, and the
   * point is that the third one in a row is worth a word and the eleventh is
   * not. Nothing here opens a modal or interrupts a scroll: js/app.js prints
   * one line in the card's own result area. */
  var MILESTONES = [3, 5, 10];

  var MILESTONE_TEXT = {
    3: "Three in a row.",
    5: "Five in a row.",
    10: "Ten in a row."
  };

  /** The line to show when an answer reaches a milestone, or "". */
  function milestoneText(n) { return MILESTONE_TEXT[n] || ""; }

  /** Attempts, correct, the run in progress and the best run. */
  function run() {
    var r = read().run || blankRun();
    return { cur: r.cur || 0, best: r.best || 0,
             attempts: r.attempts || 0, correct: r.correct || 0 };
  }

  function today(d) {
    d = d || new Date();
    return d.getFullYear() + "-" +
      ("0" + (d.getMonth() + 1)).slice(-2) + "-" +
      ("0" + d.getDate()).slice(-2);
  }

  /* §11: THE ANSWER RUN.
   *
   * Distinct from the day streak above it, and the two are easy to confuse:
   * `streak()` counts consecutive DAYS played, `run` counts consecutive
   * CORRECT ANSWERS. A reader who gets four right in a row on their first
   * visit has a run of four and a day streak of one.
   *
   * `cur` is the run in progress and is reset by a wrong answer. `best` is
   * kept, because a personal best that evaporates when you close the tab is
   * not a best. Both live in the same localStorage key as everything else,
   * which is the whole extent of it: no account, no leaderboard, nothing
   * leaves the browser. */
  function blankRun() { return { cur: 0, best: 0, attempts: 0, correct: 0 }; }

  function blank() {
    return { days: {}, total: { right: 0, wrong: 0 }, seen: {}, run: blankRun() };
  }

  /* Storage can throw, not just come back empty: private windows, a browser set
   * to block site data, a quota that is full. A scoreboard is a nice-to-have on
   * a feed, so every access is wrapped and failure means "no score", never a
   * broken tab. */
  function read() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(KEY);
      if (!raw) return blank();
      var d = JSON.parse(raw);
      if (!d || typeof d !== "object") return blank();
      d.days = d.days || {};
      d.total = d.total || { right: 0, wrong: 0 };
      d.seen = d.seen || {};
      /* Readers who played before this existed have no `run`. Starting them at
       * zero is right: a best run cannot be reconstructed from a day tally,
       * and inventing one from d.total.right would claim a streak that may
       * never have happened. */
      d.run = d.run || blankRun();
      return d;
    } catch (e) { return blank(); }
  }

  function write(d) {
    try {
      var keys = Object.keys(d.days).sort();
      while (keys.length > KEEP_DAYS) delete d.days[keys.shift()];
      /* `seen` would otherwise grow forever. Only today's and yesterday's ids
       * matter — a card scored last week is not about to be rescored in the
       * same session, and if it is, one extra point is a smaller problem than
       * an unbounded key. */
      var live = {};
      Object.keys(d.seen).forEach(function (id) {
        if (d.seen[id] >= keys[Math.max(0, keys.length - 2)]) live[id] = d.seen[id];
      });
      d.seen = live;
      root.localStorage.setItem(KEY, JSON.stringify(d));
      return true;
    } catch (e) { return false; }
  }

  /** Can this card type be scored at all?
   *
   * VS, compare and teammates cards pose a question a reader could answer, but
   * they do not currently TAKE an answer — the comparison reveals itself. Until
   * they ask, scoring them would mean inventing a result nobody gave. */
  function scorable(type) { return !!SCORED[type]; }

  /** Record an answer. Returns today's tally, whether or not it counted.
   *
   * @param {string} id       the card's id; a card already scored is ignored
   * @param {string} type     quiz | trivia | ballot
   * @param {boolean} correct
   */
  function record(id, type, correct, now) {
    var day = today(now);
    var d = read();
    if (!id || !scorable(type)) return dayTally(d, day);
    if (d.seen[id]) return dayTally(d, day);       // the loop brought it back

    d.seen[id] = day;
    var t = d.days[day] || (d.days[day] = { right: 0, wrong: 0 });
    if (correct) { t.right++; d.total.right++; } else { t.wrong++; d.total.wrong++; }

    /* The run moves on the same answer, inside the same `seen` guard, so a card
     * the loop brings round again cannot pad it. */
    var r = d.run;
    r.attempts++;
    if (correct) {
      r.correct++;
      r.cur++;
      if (r.cur > r.best) r.best = r.cur;
    } else {
      r.cur = 0;
    }
    write(d);
    return { right: t.right, wrong: t.wrong, run: r.cur, best: r.best,
             attempts: r.attempts, correct: r.correct,
             /* The milestone this answer just reached, or 0. Read by js/app.js
              * to put one line under the card - see MILESTONES. */
             milestone: correct && MILESTONES.indexOf(r.cur) >= 0 ? r.cur : 0 };
  }

  function dayTally(d, day) {
    var t = d.days[day] || { right: 0, wrong: 0 };
    return { right: t.right, wrong: t.wrong };
  }

  function todayScore(now) { return dayTally(read(), today(now)); }

  function total() {
    var d = read();
    return { right: d.total.right || 0, wrong: d.total.wrong || 0 };
  }

  /** Consecutive days ending today, or ending yesterday if today has no answers
   *  yet — otherwise a streak would read as broken every morning until the
   *  first answer of the day. */
  function streak(now) {
    var d = read();
    var cur = now ? new Date(now.getTime()) : new Date();
    if (!d.days[today(cur)]) cur.setDate(cur.getDate() - 1);
    var n = 0;
    while (d.days[today(cur)]) { n++; cur.setDate(cur.getDate() - 1); }
    return n;
  }

  /** The header line, or "" when there is nothing to say yet.
   *
   * Deliberately says nothing at 0-0: a scoreboard reading "0-0 today" on a
   * feed nobody has played is an accusation, not information. */
  function line(now) {
    var t = todayScore(now);
    if (!t.right && !t.wrong) return "";
    var s = t.right + "-" + t.wrong + " today";
    /* The run in progress earns a word from three up, which is where the first
     * milestone is. Below that it is noise: "1 in a row" is just an answer. */
    var r = run();
    if (r.cur >= 3) s += " · " + r.cur + " in a row";
    else if (r.best >= 3) s += " · best " + r.best;
    var days = streak(now);
    if (days > 1) s += " · " + days + " day streak";
    return s;
  }

  function reset() {
    try { root.localStorage.removeItem(KEY); return true; }
    catch (e) { return false; }
  }

  root.Scoreboard = {
    record: record, today: todayScore, total: total, streak: streak,
    run: run, milestoneText: milestoneText, MILESTONES: MILESTONES,
    line: line, reset: reset, scorable: scorable, dayKey: today, KEY: KEY
  };
})(typeof window !== "undefined" ? window : this);
