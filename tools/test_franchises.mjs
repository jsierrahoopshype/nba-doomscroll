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
  FRANCHISES, FRANCHISE_KEYS, KNOWN_CODES, franchiseKey, identity, oneOf, theOneOf,
  franchiseOf, existedIn, currentCode, displayCity
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
 * identity, never the newest: a 1949 season in the Hawks lineage must not read
 * Atlanta. The example used to be 1950 reading Milwaukee, from when the table
 * had no Tri-Cities era - the Blackhawks really did play in Moline in 1950, so
 * the table is now right and the fallback needs a year that predates even that. */
ck("a year before the first era falls back to the oldest identity",
   identity("hawks", 1949).city === "Tri-Cities", identity("hawks", 1949).city);
ck("and the era it actually played in wins over the fallback",
   identity("hawks", 1951).city === "Tri-Cities" && identity("hawks", 1955).city === "Milwaukee",
   identity("hawks", 1951).city + " / " + identity("hawks", 1955).city);
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

console.log("\nevery era carries its own code");

{
  let bad = 0;
  for (const [key, f] of Object.entries(FRANCHISES)) {
    for (const e of f.eras) {
      if (!/^[A-Z]{2,3}$/.test(e[4] || "")) { bad++; console.log(`        ${key} ${e[0]} has no code`); }
      /* Every era code must be a code the franchise admits to, or a lookup
       * by that code would land somewhere else. */
      if (f.codes.indexOf(e[4]) < 0) { bad++; console.log(`        ${key} era code ${e[4]} not in codes`); }
    }
  }
  ck("every era has a code the franchise owns", bad === 0);
}
ck("a 2004 Net is NJN, not BKN", identity("nets", 2004).code === "NJN");
ck("a 2005 Sonic is SEA", identity("thunder", 2005).code === "SEA");
ck("a 1998 Hornet is CHH", identity("pelicans", 1998).code === "CHH");
ck("a 1980 King is KCK", identity("kings", 1980).code === "KCK");
ck("the current code is the newest era's", currentCode("thunder") === "OKC" && currentCode("nets") === "BKN");
ck("an unknown key has no current code", currentCode("sonics") === null);

console.log("\nexistence is strict where identity is lenient");

ck("the Raptors did not exist in 1990", existedIn("raptors", 1990) === false);
ck("but identity still answers for that year", !!identity("raptors", 1990));
ck("the Bobcats did not exist in 1998", existedIn("hornets", 1998) === false);
ck("the first Hornets did", existedIn("pelicans", 1998) === true);
ck("nonsense is false", existedIn("nope", 2000) === false && existedIn("nets", "x") === false);

console.log("\na name, in a season, to a franchise - the join fix");

/* THE BUG: the salary file keys old seasons by the CURRENT city (a 2004 New
 * Jersey payroll arrives as Brooklyn) and the game log by the name of the
 * night ("New Jersey Nets"). Codes made from each side's own string never
 * met, so every pre-move season of every relocated franchise failed to join.
 * Both sides now resolve to a franchise, with the year deciding the cases
 * where a city has belonged to two of them. */
const CASES = [
  ["New Jersey Nets", 2004, "nets"], ["BKN", 2004, "nets"], ["Brooklyn", 2004, "nets"],
  ["Seattle SuperSonics", 2005, "thunder"], ["OKC", 2005, "thunder"], ["SEATTLE", 2005, "thunder"],
  ["Vancouver Grizzlies", 1999, "grizzlies"], ["VANCOUVER", 1999, "grizzlies"], ["MEM", 1999, "grizzlies"],
  ["Washington Bullets", 1995, "wizards"], ["WAS", 1995, "wizards"],
  ["Kansas City Kings", 1980, "kings"], ["Buffalo Braves", 1975, "clippers"],
  /* The two Charlottes, decided by the year - both as the log spells it and
   * as the salary file's code. */
  ["Charlotte Hornets", 1998, "pelicans"], ["CHA", 1998, "pelicans"], ["Charlotte", 1998, "pelicans"],
  ["Charlotte Hornets", 2020, "hornets"], ["CHA", 2020, "hornets"], ["Charlotte Bobcats", 2010, "hornets"],
  /* New Orleans has been the Jazz and the Hornets and the Pelicans. */
  ["New Orleans", 1977, "jazz"], ["New Orleans Jazz", 1977, "jazz"],
  ["New Orleans", 2010, "pelicans"], ["NOP", 2010, "pelicans"],
  /* Oklahoma City hosted the Hornets before it had the Thunder. */
  ["Oklahoma City", 2006, "pelicans"], ["New Orleans/Oklahoma City Hornets", 2006, "pelicans"],
  ["Oklahoma City", 2010, "thunder"],
  /* Chicago and Philadelphia have each had a franchise that moved on. */
  ["Chicago", 1963, "wizards"], ["Chicago", 1990, "bulls"],
  ["Philadelphia", 1960, "warriors"], ["Philadelphia", 1990, "sixers"],
  /* Los Angeles needs the nickname; the salary file always supplies one. */
  ["Los Angeles Lakers", 2010, "lakers"], ["LA Lakers", 2026, "lakers"], ["LAL", 2010, "lakers"],
  ["LA Clippers", 2026, "clippers"], ["Los Angeles Clippers", 1990, "clippers"],
  /* Codes as the stats files spell them. */
  ["PHO", 2000, "suns"], ["BRK", 2015, "nets"], ["NOH", 2010, "pelicans"],
  /* Today's name on an old season, which is how the salary file keys things:
   * the second pass. "Oklahoma City" in 2004 is the Sonics, not the Hornets
   * who would arrive there two years later. */
  ["Oklahoma City", 2004, "thunder"], ["Memphis", 1999, "grizzlies"],
  ["New Orleans", 1998, "pelicans"], ["Brooklyn Nets", 1990, "nets"]
];
{
  let bad = 0;
  for (const [text, year, want] of CASES) {
    const got = franchiseOf(text, year);
    if (got !== want) { bad++; console.log(`        "${text}" ${year} -> ${got}, expected ${want}`); }
  }
  ck(`${CASES.length} names and codes land on the right franchise`, bad === 0);
}

/* What must be refused: guessing here puts a payroll on the wrong record. */
ck("bare Los Angeles is ambiguous and refused", franchiseOf("Los Angeles", 2010) === null);
/* A franchise with no descendant. The Stags, the Capitols, the Bombers and the
 * original Baltimore Bullets all folded, so there is nothing for a card to
 * name and a guess would put their games on a living team's record. Tri-Cities
 * used to be the example here, which was only true because the table was
 * missing an era of a franchise that is still playing. */
ck("a franchise that folded is refused", franchiseOf("Chicago Stags", 1950) === null);
ck("so is another", franchiseOf("Washington Capitols", 1950) === null);
ck("but a defunct NAME of a living franchise is not",
   franchiseOf("Tri-Cities Blackhawks", 1951) === "hawks",
   String(franchiseOf("Tri-Cities Blackhawks", 1951)));
/* The abbreviation the league's own game log uses for the Pistons' first home.
 * 665 rows resolved to nothing until fold() expanded it. */
ck("Ft. Wayne is Fort Wayne", franchiseOf("Ft. Wayne Zollner Pistons", 1955) === "pistons",
   String(franchiseOf("Ft. Wayne Zollner Pistons", 1955)));
ck("and St. Louis still is Saint Louis", franchiseOf("St. Louis Hawks", 1960) === "hawks");
ck("expanding one abbreviation did not break a nickname containing it",
   franchiseOf("Detroit Pistons", 2020) === "pistons" &&
   franchiseOf("Boston Celtics", 1960) === "celtics");
ck("a franchise before it existed is refused", franchiseOf("Toronto Raptors", 1990) === null);
/* No Charlotte team played in 2003-04. Matching every name a franchise has
 * ever had would hand this to the old Hornets, by then in New Orleans. */
ck("Charlotte in 2004, when there was no Charlotte team, is refused",
   franchiseOf("Charlotte", 2004) === null, String(franchiseOf("Charlotte", 2004)));
ck("no year, no answer", franchiseOf("Boston Celtics", undefined) === null);
ck("no text, no answer", franchiseOf("", 2010) === null && franchiseOf(undefined, 2010) === null);

console.log("\nhow a card names the city");

ck("Boston is Boston", displayCity("celtics", 2010) === "Boston");
ck("Los Angeles is two teams, so the nickname comes along",
   displayCity("lakers", 2010) === "LA Lakers" && displayCity("clippers", 2010) === "LA Clippers");
ck("but San Diego was only the Clippers", displayCity("clippers", 1982) === "San Diego");
ck("a 2004 Nets card says New Jersey", displayCity("nets", 2004) === "New Jersey");
ck("in 1977 New York had two, so both are named",
   displayCity("knicks", 1977) === "New York Knicks" && displayCity("nets", 1977) === "New York Nets");
ck("and in 1990 the Knicks have it to themselves", displayCity("knicks", 1990) === "New York");
ck("an unknown key yields nothing", displayCity("sonics", 1990) === null);

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
