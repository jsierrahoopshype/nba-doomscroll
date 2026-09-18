/* The four badges, and the three ways the wrong one can be wrong.
 *
 *     node tools/test_career_teams.mjs
 *
 * The right answers are the easy half: they are in the stats. Everything
 * interesting here is about the option the reader is supposed to pick, which
 * asserts a negative - he never played for them - and a negative is false for
 * reasons a spreadsheet cannot see.
 */

import { careerStints, careerMapQuestions, layOut, MIN_GAMES, MIN_FRANCHISES, OPTIONS }
  from "./lib/career_teams.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

const row = (player, team, year, gp) => ({ PLAYER: player, TEAM: team, YEAR: String(year), GP: String(gp) });

/* A toy league. Codes map to franchise keys, and SEA and OKC are one franchise,
 * which is the whole reason this works in keys rather than codes. */
const KEYS = { BOS: "celtics", LAL: "lakers", CHI: "bulls", MIA: "heat",
               SEA: "thunder", OKC: "thunder", MEM: "grizzlies" };
const franchiseOf = (code) => KEYS[code] || null;
/* The Grizzlies arrive in 1996; everybody else has always been here. */
const existedIn = (key, year) => key === "grizzlies" ? year >= 1996 : true;
const ELIGIBLE = ["celtics", "lakers", "bulls", "heat", "thunder", "grizzlies"];

const ask = (rows, over) => careerMapQuestions(
  careerStints(rows, { franchiseOf }),
  Object.assign({ eligible: ELIGIBLE, existedIn }, over || {}));
const one = (rows, player, over) => (ask(rows, over) || []).find(q => q.player === player);

console.log("\nthe three he did play for");

{
  const rows = [
    row("Well Travelled", "BOS", 2001, 80), row("Well Travelled", "LAL", 2003, 70),
    row("Well Travelled", "CHI", 2005, 60), row("Well Travelled", "MIA", 2007, 55)
  ];
  const q = one(rows, "Well Travelled");
  ck("four real stints makes a question", !!q);
  ck("it shows three of them", q && q.played.length === MIN_FRANCHISES,
     q && String(q.played.length));
  ck("the biggest three, in order", q && q.played.map(s => s.key).join(",") === "celtics,lakers,bulls",
     q && q.played.map(s => s.key + ":" + s.games).join(" "));
  ck("and it counts the whole career", q && q.franchises === 4 && q.games === 265,
     q && `${q.franchises} franchises, ${q.games} games`);
}

{
  /* Two teams cannot fill three slots. */
  const rows = [row("Two Clubs", "BOS", 2001, 80), row("Two Clubs", "LAL", 2003, 80)];
  ck("two franchises is not a question", !one(rows, "Two Clubs"));
}

{
  /* THE STINT THAT WOULD FEEL LIKE A TRICK. A four-game spell is playing for
   * them, and a reader who loses to it has been caught out rather than beaten,
   * so it cannot be one of the three shown. */
  const rows = [
    row("Cup Of Coffee", "BOS", 2001, 80), row("Cup Of Coffee", "LAL", 2003, 70),
    row("Cup Of Coffee", "CHI", 2005, 4)
  ];
  ck("a four-game stint cannot be one of the three right answers",
     !one(rows, "Cup Of Coffee"));
  ck("the bar is a named constant", MIN_GAMES >= 10, String(MIN_GAMES));

  /* With a fourth real stint he qualifies, and the thin one is still counted
   * so the builder can say how many it is losing. */
  const more = rows.concat([row("Cup Of Coffee", "MIA", 2007, 60)]);
  const q = one(more, "Cup Of Coffee");
  ck("a real stint elsewhere rescues him", !!q);
  ck("the thin one is not shown",
     q && !q.played.some(s => s.key === "bulls"), q && q.played.map(s => s.key).join(","));
  ck("but it is counted", q && q.thinStints === 1, q && String(q.thinStints));
}

console.log("\nthe one he did not, which is where this can lie");

{
  /* THE EXPANSION TRAP. He retires in 1994 and the Grizzlies arrive in 1996.
   * "He never played for the Grizzlies" is true, and it is a fact about the
   * league's calendar rather than about him. */
  const rows = [
    row("Retired Early", "BOS", 1988, 80), row("Retired Early", "LAL", 1990, 70),
    row("Retired Early", "CHI", 1994, 60)
  ];
  const q = one(rows, "Retired Early");
  ck("a career that ended before a team existed is a question", !!q);
  ck("and that team is never the answer", q && q.never !== "grizzlies", q && q.never);

  /* Half an overlap is not enough either: the team has to have been there for
   * the whole career, or the honest answer is "for most of his career they did
   * not exist". */
  const overlap = [
    row("Straddler", "BOS", 1990, 80), row("Straddler", "LAL", 1994, 70),
    row("Straddler", "CHI", 2000, 60)
  ];
  const q2 = one(overlap, "Straddler");
  ck("nor is a team that arrived mid-career", q2 && q2.never !== "grizzlies", q2 && q2.never);

  /* A career entirely inside their existence is fine. */
  const modern = [
    row("Modern", "BOS", 2001, 80), row("Modern", "LAL", 2003, 70),
    row("Modern", "CHI", 2005, 60)
  ];
  const q3 = one(modern, "Modern");
  ck("a team that existed throughout can be the answer",
     q3 && ELIGIBLE.includes(q3.never) && q3.never !== "celtics", q3 && q3.never);
}

{
  /* THE FRANCHISE THAT MOVED. He played in Seattle; the badge says Oklahoma
   * City. Asking "did he play for the Thunder" and answering no would be a
   * question about a relocation, not about a career. Keys, not codes. */
  const rows = [
    row("Sonic", "SEA", 2005, 80), row("Sonic", "BOS", 2009, 70),
    row("Sonic", "LAL", 2011, 60), row("Sonic", "CHI", 2013, 50)
  ];
  const q = one(rows, "Sonic");
  ck("Seattle and Oklahoma City are one franchise", !!q && q.never !== "thunder",
     q && q.never);
  const stints = careerStints(rows.concat([row("Sonic", "OKC", 2014, 30)]), { franchiseOf });
  ck("and two spells under two names are one stint",
     stints.get("Sonic").get("thunder").games === 110,
     String(stints.get("Sonic").get("thunder").games));
}

{
  /* A franchise with no badge cannot be named at all, right answer or wrong. */
  const rows = [
    row("Only Old Teams", "BOS", 2001, 80), row("Only Old Teams", "LAL", 2003, 70),
    row("Only Old Teams", "CHI", 2005, 60)
  ];
  ck("a question needs three showable stints",
     !one(rows, "Only Old Teams", { eligible: ["celtics", "lakers"] }));
  ck("and somewhere to point the wrong answer",
     !one(rows, "Only Old Teams", { eligible: ["celtics", "lakers", "bulls"] }));
}

console.log("\nthe franchise that moved, which is a different problem");

{
  /* ROBERT PARISH AND THE PELICANS. He played for the Charlotte Hornets in
   * 1994-96. That franchise is today the New Orleans Pelicans, so the only
   * badge the card can draw for it says New Orleans - and offered as a team he
   * played for, nobody can answer it. The stint is real; the crest is not.
   *
   * The wrong answer still has to respect the lineage, so the franchise is
   * disqualified from being the distractor too. It simply does not appear. */
  const sameCityNow = (key, year) =>
    key === "pelicans" ? year >= 2003 : key === "thunder" ? year >= 2009 : true;
  const rows = [
    row("Parish Like", "BOS", 1990, 80), row("Parish Like", "LAL", 1993, 70),
    row("Parish Like", "CHI", 1996, 60),
    row("Parish Like", "MIA", 1995, 55)
  ];
  /* MIA stands in for the moved franchise here: give it a key whose city
   * changed and the stint should stop being showable. */
  const movedKeys = Object.assign({}, KEYS, { MIA: "pelicans" });
  const stints = careerStints(rows, { franchiseOf: c => movedKeys[c] || null, sameCityNow });
  const q = careerMapQuestions(stints, { eligible: ELIGIBLE, existedIn })
    .find(x => x.player === "Parish Like");
  ck("a stint played in another city is not shown", !!q &&
     !q.played.some(s => s.key === "pelicans"), q && q.played.map(s => s.key).join(","));
  ck("and it is still not the wrong answer either", !!q && q.never !== "pelicans",
     q && q.never);
  ck("the stint is counted as real, just unshowable",
     !!q && q.movedStints === 1, q && String(q.movedStints));

  /* CHRIS PAUL AND THE SAME PELICANS. His New Orleans Hornets years are in the
   * same city the badge names, so nothing is hidden. */
  const cp3 = [
    row("Paul Like", "MIA", 2008, 78), row("Paul Like", "BOS", 2012, 70),
    row("Paul Like", "LAL", 2015, 60), row("Paul Like", "CHI", 2018, 60)
  ];
  const s2 = careerStints(cp3, { franchiseOf: c => movedKeys[c] || null, sameCityNow });
  ck("a stint in the city the badge still names is shown",
     s2.get("Paul Like").get("pelicans").homeGames === 78,
     String(s2.get("Paul Like").get("pelicans").homeGames));
}

{
  /* SEATTLE, WHICH IS THE SAME SHAPE. A man who played only in Seattle has a
   * real Thunder stint that the Thunder badge misrepresents, so the Thunder
   * appear on his card not at all: not as a right answer, because the crest is
   * Oklahoma City's, and not as the wrong one, because he did play for the
   * franchise. */
  const sameCityNow = (key, year) => key === "thunder" ? year >= 2009 : true;
  const rows = [
    row("Sonics Only", "SEA", 2005, 80), row("Sonics Only", "BOS", 2010, 70),
    row("Sonics Only", "LAL", 2012, 60), row("Sonics Only", "CHI", 2014, 55)
  ];
  const q = careerMapQuestions(careerStints(rows, { franchiseOf, sameCityNow }),
    { eligible: ELIGIBLE, existedIn }).find(x => x.player === "Sonics Only");
  ck("a Seattle-only career never shows the Thunder",
     !!q && !q.played.some(s => s.key === "thunder"), q && q.played.map(s => s.key).join(","));
  ck("nor offers them as a team he did not play for", !!q && q.never !== "thunder",
     q && q.never);

  /* A man who played in Oklahoma City after the move keeps them. */
  const after = [
    row("OKC Era", "OKC", 2012, 80), row("OKC Era", "BOS", 2016, 70),
    row("OKC Era", "LAL", 2018, 60)
  ];
  const q2 = careerMapQuestions(careerStints(after, { franchiseOf, sameCityNow }),
    { eligible: ELIGIBLE, existedIn }).find(x => x.player === "OKC Era");
  ck("but a career that began after the move does",
     !!q2 && q2.played.some(s => s.key === "thunder"), q2 && q2.played.map(s => s.key).join(","));
}

console.log("\nthe board");

{
  const rows = [
    row("Board Test", "BOS", 2001, 80), row("Board Test", "LAL", 2003, 70),
    row("Board Test", "CHI", 2005, 60)
  ];
  const q = one(rows, "Board Test");
  const b = layOut(q);
  ck("four options", b.keys.length === OPTIONS, String(b.keys.length));
  ck("no repeats", new Set(b.keys).size === OPTIONS);
  ck("the answer is one of them", b.keys[b.answerIdx] === q.never);
  ck("and it is not always last", (() => {
    /* Across a spread of names the answer must land in more than one slot,
     * or the game is "press the fourth button". */
    const seen = new Set();
    for (const name of ["Aa", "Bb", "Cc", "Dd", "Ee", "Ff", "Gg", "Hh"]) {
      const r = [row(name, "BOS", 2001, 80), row(name, "LAL", 2003, 70), row(name, "CHI", 2005, 60)];
      const qq = one(r, name);
      if (qq) seen.add(layOut(qq).answerIdx);
    }
    return seen.size > 1;
  })());
  ck("the same player gets the same board twice running",
     JSON.stringify(layOut(q)) === JSON.stringify(layOut(q)));
}

console.log("\nrubbish in");

ck("no rows, no questions", careerMapQuestions(careerStints([], { franchiseOf }), { eligible: ELIGIBLE }).length === 0);
ck("undefined does not throw", careerMapQuestions(careerStints(undefined, undefined), undefined).length === 0);
ck("a row with no team is skipped",
   careerStints([{ PLAYER: "X", YEAR: "2001", GP: "80" }], { franchiseOf }).size === 0);
ck("a row with no player is skipped",
   careerStints([{ TEAM: "BOS", YEAR: "2001", GP: "80" }], { franchiseOf }).size === 0);
ck("an unresolvable team is skipped, not guessed",
   careerStints([row("X", "ZZZ", 2001, 80)], { franchiseOf }).size === 0);
ck("a missing GP counts as none, and does not become NaN",
   careerStints([{ PLAYER: "X", TEAM: "BOS", YEAR: "2001" }], { franchiseOf })
     .get("X").get("celtics").games === 0);

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "it would ask which team a man never played for and name one he did"
                 : "every wrong answer is wrong about him, not about the calendar");
process.exit(fail ? 1 : 0);
