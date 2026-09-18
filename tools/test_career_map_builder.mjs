/* The Career Map card, built for real, over seasons whose answer is known.
 *
 *     node tools/test_career_map_builder.mjs
 *
 * lib/career_teams.mjs is tested on its own. This exists for the half-inch
 * between the JSON and the library, which is where the last two bugs in this
 * repo lived: rsStats YEAR read a season late, and a card ranked by the
 * player's name. Neither was visible to a unit test, because neither the units
 * nor the ranking reach the library.
 *
 * It drives the real builder over a fixture whose truth is written beside the
 * rows that encode it, and reads the card that comes out.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(__dirname, "build_career_map.mjs");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* ---------------- the fixture ----------------
 *
 * YEAR is a season's ENDING year here, as it is in rsStats.
 */
const rows = [];
const add = (p, t, y, gp) => rows.push({ PLAYER: p, TEAM: t, YEAR: String(y), GP: String(gp) });

/* Journey Man: four real stints, so three get shown and the fourth is spare.
 * 840 games, well past the career-games gate. */
for (const [t, y] of [["BOS", 2005], ["LAL", 2008], ["CHI", 2011], ["MIA", 2014]]) {
  for (let k = 0; k < 3; k++) add("Journey Man", t, y + k, 70);
}

/* Sonic Man: Seattle and Oklahoma City are ONE franchise, so the card must
 * never offer the Thunder as a team he did not play for. */
for (const [t, y] of [["SEA", 2004], ["OKC", 2009], ["BOS", 2012], ["NYK", 2014]]) {
  for (let k = 0; k < 3; k++) add("Sonic Man", t, y + k, 70);
}

/* Cup Of Coffee: three long stints and one four-game spell. The short one must
 * not be offered as a right answer, because a reader who loses to it has been
 * tricked rather than beaten. */
for (const [t, y] of [["BOS", 2005], ["LAL", 2009], ["MIA", 2013]]) {
  for (let k = 0; k < 3; k++) add("Cup Of Coffee", t, y + k, 70);
}
add("Cup Of Coffee", "CHI", 2016, 4);

/* Brief Guy: three stints, 120 games in all. Under the career-games gate, so
 * no card: a question about a man nobody can place is not a hard question. */
add("Brief Guy", "BOS", 2015, 40);
add("Brief Guy", "LAL", 2016, 40);
add("Brief Guy", "CHI", 2017, 40);

/* Two Clubs: cannot fill three right answers. */
for (let k = 0; k < 6; k++) { add("Two Clubs", "BOS", 2005 + k, 75); add("Two Clubs", "LAL", 2012 + k, 75); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "career-map-"));
fs.writeFileSync(path.join(dir, "rsStats.json"), JSON.stringify(rows));
const out = path.join(dir, "pool.json");

let log = "";
try {
  log = execFileSync(process.execPath, [BUILDER, "--local", dir, "--out", out],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (e) {
  console.log("  FAIL the builder did not finish");
  console.log(String((e.stdout || "") + (e.stderr || "")).split("\n").map(l => "    " + l).join("\n"));
  process.exit(1);
}

const cards = JSON.parse(fs.readFileSync(out, "utf8")).cards;
const card = who => cards.find(c => (c.tags.players || [])[0] === who);
const names = c => c.payload.options.map(o => o.name);
const answer = c => c.payload.options[c.payload.answer_idx];

console.log("\nthe badges, which come out of a file in this repo");

ck("all thirty franchises have one", /30 franchises with a badge/.test(log),
   (log.match(/\d+ franchises with a badge/) || ["(not printed)"])[0]);
ck("and none of the notes about missing ones fired", !/fewer than thirty/.test(log));

console.log("\nwho gets a card");

ck("a well-travelled career does", !!card("Journey Man"));
/* The detail only on failure. A passing check that prints "Two Clubs got a
 * card" reads as a bug in the line above it. */
ck("a two-team career does not", !card("Two Clubs"), card("Two Clubs") ? "it got one" : "");
ck("and neither does a 120-game career", !card("Brief Guy"), card("Brief Guy") ? "it got one" : "");

console.log("\nthe four options");

{
  const c = card("Journey Man");
  ck("there are four", c && c.payload.options.length === 4, c && String(c.payload.options.length));
  ck("every one has a badge", c && c.payload.options.every(o => /^https?:\/\/.+\.svg$/.test(o.logo)),
     c && c.payload.options.map(o => o.logo ? "ok" : "MISSING").join(","));
  ck("every one is named", c && c.payload.options.every(o => o.name && o.name.length > 3));
  ck("no team appears twice",
     c && new Set(c.payload.options.map(o => o.key)).size === 4);
  ck("the answer points at one of them",
     c && !!answer(c), c && String(c.payload.answer_idx));
}

console.log("\nthe wrong answer is wrong about him");

{
  /* THE FRANCHISE THAT MOVED. He played in Seattle. The badge says Oklahoma
   * City. Offering the Thunder as a team he never played for would be a
   * question about a relocation. */
  const c = card("Sonic Man");
  ck("Seattle counts as Oklahoma City", !!c && !/Thunder/.test(answer(c).name),
     c && answer(c).name);
  ck("and the Thunder are on the board as a team he DID play for",
     !!c && names(c).some(n => /Thunder/.test(n)), c && names(c).join(", "));
}

{
  /* THE STINT THAT WOULD FEEL LIKE A TRICK. Four games for Chicago. The Bulls
   * may not be shown as one of the three he played for. */
  const c = card("Cup Of Coffee");
  ck("a four-game stint is not offered as a right answer",
     !!c && !names(c).filter((n, i) => i !== c.payload.answer_idx).some(n => /Bulls/.test(n)),
     c && names(c).join(", "));
}

console.log("\nand every card says so out loud");

for (const c of cards) {
  const p = c.payload;
  if (!/^Which of these NBA teams did .+ never play for\?$/.test(p.question)) {
    ck("the question names the league it is asking about", false, p.question);
  }
  if (/\b(NaN|undefined|null)\b/.test(p.question + " " + p.detail)) {
    ck("a value that is not one", false, p.question);
  }
}
ck("the question names the league it is asking about", true);
ck("nothing reads as a number that is not one", true);

console.log("\nthe same build twice running");

{
  const out2 = path.join(dir, "pool2.json");
  execFileSync(process.execPath, [BUILDER, "--local", dir, "--out", out2],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const again = JSON.parse(fs.readFileSync(out2, "utf8")).cards;
  /* The feed remembers what a reader has seen by story_key. A card whose board
   * reshuffles on every build is a different question wearing the same key. */
  ck("gives every player the same board",
     JSON.stringify(cards.map(c => [c.story_key, c.payload.answer_idx,
       c.payload.options.map(o => o.key)])) ===
     JSON.stringify(again.map(c => [c.story_key, c.payload.answer_idx,
       c.payload.options.map(o => o.key)])));
}

fs.rmSync(dir, { recursive: true, force: true });

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "it would ask which badge a man never wore and show one he did"
                 : "every board is answerable, and the same tomorrow");
process.exit(fail ? 1 : 0);
