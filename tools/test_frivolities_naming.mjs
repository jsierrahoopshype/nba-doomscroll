/* Does an archive item actually NAME the player it gets attributed to?
 *
 *     node tools/test_frivolities_naming.mjs
 *
 * WHY THIS EXISTS
 *
 * A "who is this?" card went out of a dry run reading, in effect: a Matt
 * Bonner story with Bonner's name plainly in the excerpt, four options, and
 * LaMelo Ball marked correct. The item had matched on the bare surname "ball",
 * which appears in "a paint-ball outing".
 *
 * The guard that was supposed to prevent it dropped surnames shorter than four
 * characters and its comment named "Ball" as the example - but "ball" is
 * exactly four characters, so the test let through the very case it described.
 * Length was never the right axis anyway: Bird, Love, Rose, Wall, Green,
 * Young, West and King all clear four characters and all appear in ordinary
 * basketball prose.
 *
 * So the rule is now about word-ness, not length: a surname that is also an
 * ordinary word requires the player's FULL name. This checks that rule against
 * invented sentences - no archive record is read here, which is the standing
 * condition on this builder and the reason it was written blind in the first
 * place.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/* The builder exits early without a source folder, so the two functions under
 * test are lifted out of it by name rather than by running it. If either is
 * ever renamed this fails loudly, which is the point. */
const src = fs.readFileSync(path.join(REPO, "tools/build_frivolities.mjs"), "utf8");
function lift(name, kind) {
  const re = kind === "const"
    ? new RegExp("^const " + name + " = [\\s\\S]*?^\\]\\);$", "m")
    : new RegExp("^(?:const|function) " + name + "[\\s\\S]*?^\\}$", "m");
  const m = re.exec(src);
  if (!m) throw new Error("could not lift " + name + " from build_frivolities.mjs");
  return m[0];
}
const scope = [
  "const fold = s => String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');",
  "const norm = s => fold(s).toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\\s+/g, ' ').trim();",
  lift("surnameOf"), lift("mentions"), lift("WORD_SURNAMES", "const"), lift("namesPlayer"),
  "return { surnameOf, mentions, WORD_SURNAMES, namesPlayer, norm };"
].join("\n");
const { surnameOf, WORD_SURNAMES, namesPlayer, norm, mentions } = new Function(scope)();

const entry = name => {
  const surname = surnameOf(name);
  return { name, surname, full: norm(name), strict: WORD_SURNAMES.has(surname) };
};

const CASES = [
  // [sentence, player, should it count as naming him]
  ["a paint-ball outing that went awry", "LaMelo Ball", false],
  ["he could not find the ball in traffic", "LaMelo Ball", false],
  ["LaMelo Ball finished with 30 points", "LaMelo Ball", true],
  ["the green light from the bench", "Draymond Green", false],
  ["Draymond Green picked up his sixth", "Draymond Green", true],
  ["young players get minutes in April", "Trae Young", false],
  ["Trae Young hit from the logo", "Trae Young", true],
  ["he rose to the occasion late", "Derrick Rose", false],
  ["Derrick Rose was the youngest MVP", "Derrick Rose", true],
  ["for the love of the game", "Kevin Love", false],
  ["out west the schedule is brutal", "Russell Westbrook", false],
  ["hit the wall in the fourth quarter", "John Wall", false],
  // An ordinary surname still matches on the surname alone, as it always did.
  ["Bonner was a 41.4 percent shooter", "Matt Bonner", true],
  ["Doncic dropped 45 in the return", "Luka Doncic", true],
  // Diacritics: the archive spells it one way, the index the other.
  ["Dončić dropped 45 in the return", "Luka Doncic", true],
  ["Nurkić grabbed 15 boards", "Jusuf Nurkic", true],
  // A surname inside a longer word is still not a mention.
  ["he grew up in Jamestown", "LeBron James", false],
  ["LeBron James grew up in Akron", "LeBron James", true]
];

let failures = 0;
for (const [sentence, player, want] of CASES) {
  const got = namesPlayer(norm(sentence), entry(player));
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${player.padEnd(18)} ${want ? "named" : "  not"} in ` +
    `"${sentence}"` + (ok ? "" : `   -> got ${got}`));
}

/* The regression in one line: the old rule was `surname.length >= 4`, and the
 * whole bug is that "ball" satisfies it. */
const ballLen = surnameOf("LaMelo Ball").length;
if (ballLen >= 4 && !WORD_SURNAMES.has("ball")) {
  console.log(`  FAIL "ball" is ${ballLen} chars and not in WORD_SURNAMES - the original bug is back`);
  failures++;
} else {
  console.log(`  ok   "ball" is ${ballLen} chars, which a length rule would admit, and is on the word list`);
}

console.log(failures ? `\n${failures} naming cases failed` : "\nevery naming case behaves");

/* ---------------- the leak guard ----------------
 *
 * A dry run shipped "the Los █████ █████'" against four teams of which only
 * one was in Los Angeles. The old guard checked the LAST word of each option
 * at four characters or more: "Lakers" was redacted so it passed, and "Los" -
 * the one word on the card that named the answer - was both too short to be
 * checked and too short to have been redacted.
 *
 * The rule is now about what a token does. Discriminating means present in
 * some options and not all; anything discriminating left visible is a leak.
 * This is that rule, mirrored from build_frivolities.mjs.
 */
function leaks(body, options) {
  const hay = body.toLowerCase();
  const sets = options.map(o => new Set(norm(o).split(" ").filter(w => w.length >= 3)));
  for (const set of sets) {
    for (const t of set) {
      if (sets.every(other => other.has(t))) continue;      // shared by all: tells nobody apart
      if (mentions(hay, t)) return t;
    }
  }
  return null;
}

console.log("");
const TEAMS4 = ["Los Angeles Lakers", "New Orleans Pelicans", "Minnesota Timberwolves", "Oklahoma City Thunder"];
const LEAK = [
  // [body, options, the token that should be caught, or null for a clean card]
  ["spoke on the Los █████ █████' struggles", TEAMS4, "los"],
  ["spoke on the █████' struggles", TEAMS4, null],
  ["back when he was with the █████ █████, he returned to his car", TEAMS4, null],
  // The nickname alone is still caught, as it always was.
  ["the Lakers had no answer inside", TEAMS4, "lakers"],
  // A token every option shares tells the reader nothing and must not reject.
  [" ", ["New York Knicks", "New York Nets"], null],
  ["they played in New York that night", ["New York Knicks", "New York Nets"], null],
  // Player options: a shared first name is not a leak, a unique surname is.
  ["█████ was a 41.4 percent shooter", ["Matt Bonner", "Matt Barnes"], null],
  ["Bonner was a 41.4 percent shooter", ["Matt Bonner", "Matt Barnes"], "bonner"],
  // The paint-ball case, from the other direction.
  ["a paint-ball outing that went awry", ["LaMelo Ball", "Jett Howard", "Julius Randle"], "ball"],
  // Years.
  ["nothing dateable here", ["2016", "2017", "2018", "2019"], null],
  ["it happened back in 2019 for sure", ["2016", "2017", "2018", "2019"], "2019"]
];
let leakFails = 0;
for (const [body, options, want] of LEAK) {
  const got = leaks(body, options);
  const ok = got === want;
  if (!ok) leakFails++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${want ? "catches \"" + want + "\"" : "clean          "}  in "${body.slice(0, 46)}"` +
    (ok ? "" : `   -> got ${got}`));
}
console.log(leakFails ? `\n${leakFails} leak cases failed` : "every leak case behaves");
process.exit(failures + leakFails ? 1 : 0);
