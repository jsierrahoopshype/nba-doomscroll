/* Does this text actually name this player?
 *
 *     node tools/test_player_resolver.mjs
 *
 * The failure this guards is not a crash. It is a card that renders perfectly,
 * reads well, and has the wrong man's name under a quote he never said — on a
 * page carrying HoopsHype's name. Nothing about the page shows it. Only this
 * shows it.
 *
 * THE COLLISIONS BELOW ARE REAL. They are read out of data/buzz-map.json, the
 * roster the feed actually ships, so this cannot pass by testing a tidy
 * imaginary league. 57 of its 607 surnames are shared by two or more players.
 *
 * The prose fixtures are invented — no archive text, no real post.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolve, buildIndex, surnameOf, yearsIn } from "./lib/players.mjs";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const map = JSON.parse(fs.readFileSync(path.join(REPO, "data", "buzz-map.json"), "utf8"));
const ROSTER = Object.values(map.players || {});
const IDX = buildIndex(ROSTER);

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};
const got = (text, cands, opts) => resolve(text, cands, IDX, opts).players;
const why = (text, cands) => (resolve(text, cands, IDX).rejected[0] || {}).why;

/* ---------------------------------------------------------------- */

console.log("\nthe roster this is judged against");

{
  const counts = {};
  ROSTER.forEach(n => { const s = surnameOf(n); counts[s] = (counts[s] || 0) + 1; });
  const shared = Object.keys(counts).filter(s => counts[s] > 1);
  ck("the shipped roster is loaded", ROSTER.length > 400, ROSTER.length + " players");
  ck("and it really does contain shared surnames",
     shared.length > 20, shared.length + " surnames shared by 2+ players");
  ck("including the ones this was built for",
     ["thompson", "brown", "curry", "bridges"].every(s => counts[s] > 1));
}

console.log("\nsurnames two players share");

{
  /* THE ONE THAT MATTERS. A bare surname must never resolve when the league
   * holds more than one of them, whichever player the feed happened to tag. */
  const t = "An invented sentence in which Thompson scored 30 points.";
  ck("a bare shared surname resolves to NOBODY", got(t, ["Klay Thompson"]).length === 0);
  ck("and says why", /shared by/.test(why(t, ["Klay Thompson"])), why(t, ["Klay Thompson"]));

  ck("the full name resolves",
     got("An invented sentence in which Klay Thompson scored 30.", ["Klay Thompson"])
       .join() === "Klay Thompson");

  /* Tagging BOTH from a bare surname is the shape that puts two wrong names on
   * one card. */
  ck("two candidates on one bare surname resolve to neither",
     got(t, ["Klay Thompson", "Amen Thompson"]).length === 0);
  ck("but the one actually named comes back alone",
     got("Amen Thompson had 12 rebounds in an invented game.",
         ["Klay Thompson", "Amen Thompson"]).join() === "Amen Thompson");
}

{
  ck("Seth does not answer for Stephen",
     got("Curry hit seven threes in an invented game.", ["Stephen Curry"]).length === 0);
  ck("Stephen Curry, named in full, does",
     got("Stephen Curry hit seven threes.", ["Stephen Curry"]).join() === "Stephen Curry");
  ck("Mikal is not Miles",
     got("Bridges was traded in an invented deal.", ["Mikal Bridges"]).length === 0);
  ck("five Browns mean a bare Brown is nobody",
     got("Brown led the invented comeback.", ["Jaylen Brown"]).length === 0);
}

console.log("\nsurnames that are ordinary words");

{
  ck("a paint-ball outing is not LaMelo Ball",
     got("An invented note about a paint-ball outing.", ["LaMelo Ball"]).length === 0);
  ck("and says why", /ordinary word/.test(why("a paint-ball outing", ["LaMelo Ball"]) || "shared"),
     why("An invented note about a paint-ball outing.", ["LaMelo Ball"]));
  ck("green light is not Draymond Green",
     got("The invented offence got the green light.", ["Draymond Green"]).length === 0);
  ck("young players is not Trae Young",
     got("Invented praise for the young players.", ["Trae Young"]).length === 0);
  ck("rose to the occasion is not Derrick Rose",
     got("He rose to the occasion in an invented final.", ["Derrick Rose"]).length === 0);
  ck("but the full name always wins",
     got("Draymond Green got the green light.", ["Draymond Green"]).join() === "Draymond Green");
}

console.log("\na surname that belongs to somebody else in the sentence");

{
  /* The Jamal Crawford / Jamal Murray shape, and the actress-and-Ben-Simmons
   * shape: the surname is there, but every time it appears it is behind a
   * different first name. */
  ck("a surname only ever behind another first name is rejected",
     got("Eiza Gonzalez and an invented guest had dinner.", ["Hugo Gonzalez"]).length === 0);
  ck("a bare mention still counts, because reporters write that way",
     got("Gonzalez, who shot 41 percent in an invented season, is back.",
         ["Hugo Gonzalez"]).join() === "Hugo Gonzalez");
  ck("lowercase before the surname is not a first name",
     got("It ended with an invented pass to Gonzalez.", ["Hugo Gonzalez"])
       .join() === "Hugo Gonzalez");
}

console.log("\nwhen the text is pinned to a year");

{
  const careers = { "Old Player": [1996, 2007], "New Player": [2021, 2026] };
  const idxSolo = buildIndex(["Old Player", "New Player"]);
  const at = (text, cands) => resolve(text, cands, idxSolo, { careers }).players;

  ck("a 1999 story does not name a player who debuted in 2021",
     at("In 1999 an invented thing happened to New Player.", ["New Player"]).length === 0);
  ck("and the same story does name the one who was there",
     at("In 1999 an invented thing happened to Old Player.", ["Old Player"])
       .join() === "Old Player");
  ck("a season spanning two years counts as both",
     at("The 2006-07 invented season belonged to Old Player.", ["Old Player"])
       .join() === "Old Player");
  ck("with no career known, the date is not held against anyone",
     resolve("In 1999 an invented thing happened to Someone Unknown.",
             ["Someone Unknown"], buildIndex(["Someone Unknown"]), { careers }).players.length === 1);
  ck("with no date in the text, careers are not consulted",
     at("An undated invented sentence about New Player.", ["New Player"]).length === 1);
}

console.log("\nyear parsing");

{
  ck("a plain year", yearsIn("it was 2014 then").join() === "2014");
  ck("a hyphenated season is both years", yearsIn("the 2019-20 season").join() === "2019,2020");
  ck("a slashed season too", yearsIn("in 2019/20").join() === "2019,2020");
  ck("a jersey number is not a year", yearsIn("he wore 23").length === 0);
  ck("a score is not a year", yearsIn("won 118-96").length === 0);
}

console.log("\naccents, suffixes and junk");

{
  ck("an accent in the text finds the plain-spelled tag",
     got("Nikola Jokić had a triple double in an invented game.", ["Nikola Jokic"]).length === 1);
  ck("and the other way round",
     got("Nikola Jokic had a triple double.", ["Nikola Jokić"]).length === 1);
  ck("a suffix does not change who is named",
     got("Tim Hardaway Jr. hit the invented shot.", ["Tim Hardaway Jr"]).length === 1);
  ck("empty text names nobody", got("", ["Klay Thompson"]).length === 0);
  ck("no candidates does not throw", got("anything at all", []).length === 0);
  ck("null candidates does not throw", resolve("x", null, IDX).players.length === 0);
  ck("a null name is skipped", got("x", [null, undefined]).length === 0);
  ck("a substring is not a match: Jamestown is not James",
     got("An invented trip to Jamestown.", ["LeBron James"]).length === 0);
}

console.log("\nwhat it refuses to guess");

{
  /* The whole design in one assertion: given a text that could be either
   * player, it names neither rather than picking. */
  const ambiguous = "Thompson and Brown combined for 50 in an invented game.";
  ck("two ambiguous surnames in one sentence yield no tags at all",
     got(ambiguous, ["Klay Thompson", "Jaylen Brown", "Amen Thompson"]).length === 0);
  ck("every rejection carries a reason a builder can log",
     resolve(ambiguous, ["Klay Thompson"], IDX).rejected.every(r => r.why && r.why.length > 5));
}

console.log(fail ? "\n" + fail + " failure(s)"
                 : "\nno confident match, no name printed");
process.exit(fail ? 1 : 0);
