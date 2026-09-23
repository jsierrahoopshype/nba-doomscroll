/* Heights, positions and lineup order.
 *
 *     node tools/test_player_bio.mjs
 *
 * The Dream Team card lists five players and used to list them in scoring
 * order, because scoring order is all rsStats.json can support. This covers the
 * lookup that replaces it, and the cases where a sort quietly does the wrong
 * thing rather than failing: a missing height, a typo that parses, a squad the
 * bio file does not cover at all, and two players the same height.
 *
 * No network and no nba-player-data required - every fixture is written here.
 * The real file's shape was measured before this was written: 5,105 rows of
 * PLAYER, BIRTHDAY, POS, HEIGHT, WEIGHT, NATIONALITY, DRAFT, unique by PLAYER,
 * and all 310 players in the current pool present with both a height and a
 * position.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { heightInches, posRank, loadBio, lineupOrder, withBio } from "./lib/player_bio.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};
const eq = (name, got, want) =>
  ck(name, got === want, got === want ? "" : `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

console.log("\nheights, as bio.json writes them");

{
  eq("6-9 is 81 inches", heightInches("6-9"), 81);
  eq("5-10 is 70, the shortest in the pool", heightInches("5-10"), 70);
  eq("7-6 is 90, the tallest", heightInches("7-6"), 90);
  eq("a flat foot mark parses", heightInches("7-0"), 84);
  eq("whitespace is tolerated", heightInches(" 6 - 4 "), 76);

  /* 47 rows in the real file have an empty HEIGHT. They must come back null
   * rather than 0, or every one of them sorts to the front as a 4-footer. */
  eq("an empty height is null, not zero", heightInches(""), null);
  eq("so is null", heightInches(null), null);
  eq("so is undefined", heightInches(undefined), null);
  eq("and a stray word", heightInches("6ft 9in"), null);

  /* THE CASE A BLIND PARSE GETS WRONG. "69-0" is a plausible typo for 6-9 and
   * would parse to 828 inches, sorting a guard behind every centre in the
   * league and looking like a bug in the card rather than in the data. */
  eq("an implausible feet value is refused", heightInches("69-0"), null);
  eq("and implausible inches too", heightInches("6-13"), null);
  eq("a 4-foot floor is allowed, for the oldest rows", heightInches("4-11"), 59);
}

console.log("\npositions, and what this source cannot tell us");

{
  eq("a guard ranks first", posRank("G"), 0);
  eq("a centre ranks last", posRank("C"), 6);
  eq("a forward sits between", posRank("F"), 3);
  ck("the hyphenated pairs sit between their halves",
     posRank("G-F") > posRank("G") && posRank("G-F") < posRank("F") &&
     posRank("F-C") > posRank("F") && posRank("F-C") < posRank("C"),
     `G ${posRank("G")} < G-F ${posRank("G-F")} < F ${posRank("F")} < F-C ${posRank("F-C")} < C ${posRank("C")}`);
  eq("F-G is distinguished from G-F", posRank("F-G"), 2);
  eq("the two GF rows in the file are handled", posRank("GF"), 1);
  eq("lower case is fine", posRank("g"), 0);
  eq("a blank POS is null", posRank(""), null);

  /* STATED AS A TEST so nobody later writes a PG-to-C sort against this field
   * and wonders why every guard comes out equal: the file has no PG, SG, SF or
   * PF anywhere in it. Point guard to centre is not available from this source,
   * which is why the order is by height. */
  ck("there is no point-guard rank to sort by",
     posRank("PG") === null && posRank("SG") === null &&
     posRank("SF") === null && posRank("PF") === null,
     "bio.json POS is only G / F / C and the hyphenated pairs");
}

console.log("\nreading a bio file");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bio-"));
{
  fs.writeFileSync(path.join(dir, "bio.json"), JSON.stringify([
    { PLAYER: "Tiny Archibald", POS: "G", HEIGHT: "6-1" },
    { PLAYER: "Pete Maravich", POS: "G", HEIGHT: "6-5" },
    { PLAYER: "Jim McMillian", POS: "F", HEIGHT: "6-5" },
    { PLAYER: "Bob Lanier", POS: "C", HEIGHT: "6-11" },
    { PLAYER: "Wilt Chamberlain", POS: "C", HEIGHT: "7-1" },
    { PLAYER: "Al Guokas", POS: "F", HEIGHT: "" }
  ]));
  const bio = loadBio(dir);
  eq("every row is indexed", bio.size, 6);
  eq("no duplicates in this fixture", bio.duplicates, 0);
  eq("a known player resolves", bio.get("Bob Lanier").heightIn, 83);
  eq("and carries the raw height for display", bio.get("Bob Lanier").height, "6-11");
  eq("an unknown player is null, not undefined", bio.get("Nobody At All"), null);
  eq("a blank height resolves to null inches", bio.get("Al Guokas").heightIn, null);
  ck("but the row still exists", !!bio.get("Al Guokas"));
}

console.log("\nlineup order");

const P = (name, ppg) => ({ name, ppg: ppg || 20 });
const names = list => list.map(p => p.name).join(", ");
const bio = loadBio(dir);

{
  /* The shape the builder hands over: five players in scoring order, tallest
   * anywhere in the list. */
  const five = [P("Pete Maravich", 31), P("Wilt Chamberlain", 30),
                P("Tiny Archibald", 28), P("Bob Lanier", 25), P("Jim McMillian", 19)];
  const got = lineupOrder(five, bio);
  eq("shortest first, tallest last",
     names(got),
     "Tiny Archibald, Pete Maravich, Jim McMillian, Bob Lanier, Wilt Chamberlain");
  eq("nobody is lost", got.length, 5);
  ck("and nobody is duplicated", new Set(got.map(p => p.name)).size === 5);

  /* THE TIE. Maravich and McMillian are both 6-5, so position decides and the
   * guard comes first. Without this the order would depend on whatever order
   * the scoring tiers happened to produce, which is not an order at all. */
  const tie = lineupOrder([P("Jim McMillian"), P("Pete Maravich")], bio);
  eq("at equal height the guard comes before the forward",
     names(tie), "Pete Maravich, Jim McMillian");
}

{
  /* A player the bio file does not cover must not drop out and must not drag
   * the rest into an arbitrary order. */
  const mixed = [P("Wilt Chamberlain"), P("Nobody At All"), P("Tiny Archibald")];
  const got = lineupOrder(mixed, bio);
  eq("an uncovered player is kept", got.length, 3);
  ck("the covered ones are still sorted",
     got.findIndex(p => p.name === "Tiny Archibald") <
     got.findIndex(p => p.name === "Wilt Chamberlain"),
     names(got));

  /* Nothing to sort by at all: hand the list back untouched rather than
   * half-sorted, which would look deliberate and be arbitrary. */
  const none = [P("Nobody At All"), P("Also Nobody")];
  eq("a squad the file does not know is left alone", names(lineupOrder(none, bio)),
     "Nobody At All, Also Nobody");
  eq("and so is one with no bio at hand", names(lineupOrder(none, null)),
     "Nobody At All, Also Nobody");
  /* One known player is not enough to order a list by. */
  eq("one known height is not a sort", names(lineupOrder([P("Nobody At All"), P("Bob Lanier")], bio)),
     "Nobody At All, Bob Lanier");
}

{
  /* The sort must not touch the objects themselves: `total` is summed before
   * the sort and the answer_idx is decided from those totals, so a sort that
   * mutated ppg would change the answer. */
  const five = [P("Wilt Chamberlain", 30), P("Tiny Archibald", 28)];
  const before = five.map(p => p.name + ":" + p.ppg).join("|");
  const sorted = lineupOrder(five, bio);
  eq("the input list is not reordered in place", five.map(p => p.name).join(","),
     "Wilt Chamberlain,Tiny Archibald");
  eq("and no card's numbers change", five.map(p => p.name + ":" + p.ppg).join("|"), before);
  ck("the sum is the same either way",
     sorted.reduce((n, p) => n + p.ppg, 0) === five.reduce((n, p) => n + p.ppg, 0));
}

console.log("\nwhat lands on the card");

{
  const p = withBio({ name: "Bob Lanier", season: "1971-72", ppg: 25.7 }, bio);
  eq("the position is attached", p.pos, "C");
  eq("and the height, as written", p.height, "6-11");
  eq("the name is untouched", p.name, "Bob Lanier");
  eq("and so are the numbers", p.ppg, 25.7);

  const unknown = withBio({ name: "Nobody At All", ppg: 12 }, bio);
  ck("an uncovered player gains nothing rather than gaining nulls",
     !("pos" in unknown) && !("height" in unknown),
     JSON.stringify(unknown));
  const noBio = withBio({ name: "Bob Lanier" }, null);
  ck("and no bio at hand is not an error", noBio.name === "Bob Lanier" && !("pos" in noBio));
}

console.log("\nagainst the shipped pool");

{
  /* The pool on disk was built before this existed, so it carries no heights.
   * This is the check that says so out loud rather than the suite silently
   * passing on a pool that has not been rebuilt yet. */
  const POOL = path.join(path.dirname(new URL(import.meta.url).pathname), "..",
                         "data", "dreamteam-pool.json");
  if (fs.existsSync(POOL)) {
    const pool = JSON.parse(fs.readFileSync(POOL, "utf8"));
    const players = [];
    for (const c of (pool.cards || [])) {
      for (const s of (c.payload.squads || [])) players.push(...(s.players || []));
    }
    const withH = players.filter(p => p.height).length;
    ck("the pool parses and has five-man squads", players.length > 0,
       players.length + " squad players");
    if (withH === 0) {
      console.log("  note  the shipped pool predates this change: rebuild it with");
      console.log("        node tools/build_dream_team.mjs   to get lineup order");
    } else {
      /* Once rebuilt, every squad must actually be in order. A sort that runs
       * at build time and is not asserted here is a sort nobody checks. */
      let outOfOrder = 0;
      for (const c of (pool.cards || [])) {
        for (const s of (c.payload.squads || [])) {
          const hs = (s.players || []).map(p => heightInches(p.height));
          for (let i = 1; i < hs.length; i++) {
            if (hs[i] != null && hs[i - 1] != null && hs[i] < hs[i - 1]) outOfOrder++;
          }
        }
      }
      ck("every squad in the pool is shortest to tallest", outOfOrder === 0,
         outOfOrder + " adjacent pair(s) out of order");
      ck("and every player carries a height", withH === players.length,
         `${withH} of ${players.length}`);
    }
  }
}

fs.rmSync(dir, { recursive: true, force: true });

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the five would be listed in the wrong order"
                 : "each five reads as a lineup, and a missing height costs one card's sort");
process.exit(fail ? 1 : 0);
