/* Is this the same franchise, and what was it called then?
 *
 *     node tools/test_franchises.mjs
 *
 * WHAT THIS IS DEFENDING AGAINST
 *
 * A live card read "the first Raptors player to finish in the top five for
 * Defensive Player of the Year in 43 seasons of voting". Toronto joined the
 * NBA in 1995-96. The number came from the award's span instead of the
 * overlap of the award's span and the franchise's, so the sentence credited
 * the Raptors with thirteen seasons of not doing something they did not exist
 * for. True claim, invented number, and checkable in one search.
 *
 * The franchise SPAN is read from rsStats by the builder, deliberately, so no
 * hand-typed founding year can be wrong. What cannot be derived is the naming:
 * that KCK and ROC are the same franchise as SAC, that a 1974 Bullets player
 * is not a Wizard, and that the two Charlotte teams are NOT one team. Those
 * are the assertions below, and the last one is the dangerous one - merging
 * two franchises produces a drought spanning a team that never existed, which
 * is the Raptors bug again by another route.
 */

import {
  FRANCHISES, FRANCHISE_KEYS, KNOWN_CODES, franchiseKey, identity, oneOf, theOneOf
} from "./lib/franchises.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

console.log("\nthe table itself");

ck("thirty franchises", FRANCHISE_KEYS.length === 30, String(FRANCHISE_KEYS.length));

{
  /* One code, one franchise. A code in two lineages would silently hand
   * seasons to whichever entry the loop built last. */
  const seen = new Map();
  let dupes = 0;
  for (const [key, f] of Object.entries(FRANCHISES)) {
    for (const c of f.codes) {
      if (seen.has(c)) { dupes++; console.log(`        ${c} in both ${seen.get(c)} and ${key}`); }
      seen.set(c, key);
    }
  }
  ck("no team code belongs to two franchises", dupes === 0);
  ck("every code resolves", KNOWN_CODES.every(c => !!franchiseKey(c, 2026)));
}

{
  let bad = 0;
  for (const [key, f] of Object.entries(FRANCHISES)) {
    if (!f.eras.length) { bad++; console.log(`        ${key} has no eras`); }
    for (let i = 1; i < f.eras.length; i++) {
      /* Newest first, because the lookup takes the first era at or below the
       * season asked about. Out of order silently returns the wrong name. */
      if (f.eras[i][0] >= f.eras[i - 1][0]) {
        bad++; console.log(`        ${key} eras are not newest-first`);
      }
    }
    for (const e of f.eras) {
      if (!(e[0] > 1940 && e[0] < 2030)) { bad++; console.log(`        ${key} era year ${e[0]}`); }
      if (!e[1] || !e[2]) { bad++; console.log(`        ${key} era missing a city or nickname`); }
      if (e[3] && /\s/.test(e[3])) { bad++; console.log(`        ${key} singular "${e[3]}" is two words`); }
    }
  }
  ck("every era is well formed and newest-first", bad === 0);
}

console.log("\nthe season decides the name");

ck("Toronto is the Raptors and only since 1996",
   identity("raptors", 2026).nick === "Raptors" && FRANCHISES.raptors.eras[0][0] === 1996);
ck("a 1978 Washington player is a Bullet",
   identity("wizards", 1978).nick === "Bullets" && identity("wizards", 1978).city === "Washington",
   identity("wizards", 1978).city + " " + identity("wizards", 1978).nick);
ck("and in 1974 the city was Capital", identity("wizards", 1974).city === "Capital");
ck("a 2000 Washington player is a Wizard", identity("wizards", 2000).nick === "Wizards");
ck("1996 in that lineage is Seattle, not Oklahoma City",
   identity("thunder", 1996).city === "Seattle" && identity("thunder", 1996).nick === "SuperSonics");
ck("and one of them is a Sonic", identity("thunder", 1996).sing === "Sonic");
ck("2010 is the Thunder, who have no singular", identity("thunder", 2010).nick === "Thunder" &&
   identity("thunder", 2010).sing === null);
ck("the Kings were the Royals in 1968", identity("kings", 1968).nick === "Royals");
ck("and played in Kansas City in 1980", identity("kings", 1980).city === "Kansas City");
ck("the Clippers were the Braves in 1975",
   identity("clippers", 1975).city === "Buffalo" && identity("clippers", 1975).nick === "Braves");
ck("and in San Diego in 1982", identity("clippers", 1982).city === "San Diego");
ck("Philadelphia was Syracuse in 1960", identity("sixers", 1960).nick === "Nationals");
ck("a Syracuse player gets no singular", identity("sixers", 1960).sing === null);
ck("a 76er does", identity("sixers", 2026).sing === "Sixer");
/* A season earlier than the table's earliest entry falls back to the OLDEST
 * identity. The table's first era may predate what it records; a 1950 season
 * in the Hawks lineage should read Milwaukee, never Atlanta. */
ck("a year before the first era falls back to the oldest identity",
   identity("hawks", 1950).city === "Milwaukee", identity("hawks", 1950).city);
ck("and does not throw", !!identity("raptors", 1970));
ck("an unknown key yields nothing", identity("sonics", 1990) === null);

console.log("\nthe two Charlottes, which are two franchises");

/* The 1988-2002 Hornets moved to New Orleans and became the Pelicans. The 2004
 * expansion team was the Bobcats and took the Hornets name back in 2014. A
 * table that merges them would let a card say "the first Hornet since 1993"
 * about a team founded in 2004. */
ck("CHH is the Pelicans lineage", franchiseKey("CHH", 1995) === "pelicans");
ck("CHA in 1998 is too, whatever the dataset calls it",
   franchiseKey("CHA", 1998) === "pelicans", franchiseKey("CHA", 1998));
ck("CHA in 2010 is the expansion team", franchiseKey("CHA", 2010) === "hornets");
ck("CHO in 2020 as well", franchiseKey("CHO", 2020) === "hornets");
ck("a 1995 player in that lineage is a Charlotte Hornet",
   identity("pelicans", 1995).city === "Charlotte" && identity("pelicans", 1995).nick === "Hornets");
ck("2006 was the Oklahoma City Hornets, briefly",
   identity("pelicans", 2006).city === "Oklahoma City");
ck("2010 back in New Orleans", identity("pelicans", 2010).city === "New Orleans" &&
   identity("pelicans", 2010).nick === "Hornets");
ck("2020 is the Pelicans", identity("pelicans", 2020).nick === "Pelicans");
ck("2010 in the OTHER Charlotte is the Bobcats", identity("hornets", 2010).nick === "Bobcats");
ck("and 2020 is the Hornets", identity("hornets", 2020).nick === "Hornets");

console.log("\nrelocations are one franchise, not two");

const SAME = [
  ["kings", ["SAC", "KCK", "KCO", "CIN", "ROC"]],
  ["thunder", ["OKC", "SEA"]],
  ["clippers", ["LAC", "SDC", "BUF"]],
  ["wizards", ["WAS", "WSB", "CAP", "BAL"]],
  ["grizzlies", ["MEM", "VAN"]],
  ["nets", ["BKN", "BRK", "NJN", "NYN"]],
  ["warriors", ["GSW", "SFW", "PHW"]],
  ["hawks", ["ATL", "STL", "MLH"]],
  ["jazz", ["UTA", "NOJ"]],
  ["sixers", ["PHI", "SYR"]],
  ["lakers", ["LAL", "MNL"]],
  ["pistons", ["DET", "FTW"]],
  ["rockets", ["HOU", "SDR"]]
];
{
  let bad = 0;
  for (const [key, codes] of SAME) {
    for (const c of codes) {
      const got = franchiseKey(c, 1990);
      if (got !== key) { bad++; console.log(`        ${c} -> ${got}, expected ${key}`); }
    }
  }
  ck("every relocation code lands on its franchise", bad === 0);
}

console.log("\nhow a sentence says it");

ck("a Piston", oneOf(identity("pistons", 2026)) === "a Piston");
ck("a Heat player, because there is no singular",
   oneOf(identity("heat", 2026)) === "a Heat player", oneOf(identity("heat", 2026)));
ck("the first Piston", theOneOf(identity("pistons", 2026)) === "Piston");
ck("the first Jazz player", theOneOf(identity("jazz", 2026)) === "Jazz player");
ck("nothing does not throw", oneOf(null) === "a player" && theOneOf(null) === "player");

console.log("\nrubbish in");

ck("an empty code", franchiseKey("", 2026) === null);
ck("undefined", franchiseKey(undefined, undefined) === null);
ck("a made-up code", franchiseKey("ZZZ", 2026) === null);
ck("lower case still works", franchiseKey("tor", 2026) === "raptors");
ck("whitespace still works", franchiseKey("  BOS  ", 2026) === "celtics");

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail
  ? "a wrong lineage is a drought spanning a team that did not exist"
  : "every claim can be dated to a franchise that was actually in the league");
process.exit(fail ? 1 : 0);
