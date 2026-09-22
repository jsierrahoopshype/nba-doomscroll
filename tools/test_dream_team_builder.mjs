/* The Dream Team card, built for real, over rows whose answer is known.
 *
 *     node tools/test_dream_team_builder.mjs
 *
 * lib/dream_squads.mjs is tested on its own. This exists for the gap between
 * the JSON and the library, which on the Career Map is exactly where the last
 * two bugs lived: rsStats YEAR read a season late, and a card ranked by the
 * player's name. Neither was reachable from a unit test.
 *
 * It drives the real builder over a fixture whose truth is arithmetic, and
 * reads the cards that come out.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILDER = path.join(__dirname, "build_dream_team.mjs");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* ---------------- the fixture ----------------
 *
 * YEAR is a season's ENDING year, as in rsStats. Six decades of scorers on a
 * gentle taper, so some decade pairings land inside the gap band and others do
 * not. Every man plays 78 games, so PPG is exactly PTS/78 and any total can be
 * checked by hand.
 */
const rows = [];
/* Six decades, sixty scorers each, ANCHORED so that d + (k % 8) stays inside
 * its own ten years: 1962 + 7 is 1969, but 1965 + 7 would be 1972 and would
 * scatter one decade's men across two, leaving every bucket under the depth
 * floor. That mistake cost two debugging rounds when this fixture was first
 * written, so the anchors are spelled out rather than computed.
 *
 * Each decade gets its own base so the totals separate enough for some
 * pairings to land inside the gap band, and its own scoring level so the era
 * figure in the reveal is not identical on every card. */
const decades = [1962, 1972, 1982, 1992, 2002, 2012];
const base    = [28.0, 26.8, 25.6, 24.4, 23.2, 22.0];
decades.forEach((d, di) => {
  for (let k = 0; k < 60; k++) {
    const y = d + (k % 8);
    const p = base[di] - k * 0.2;
    /* Two teams a season, and MIN on every row. Both matter: the production
     * denominator is total minutes, so a fixture without MIN would silently
     * exercise only the pre-1952 fallback, and two teams gives the shape a
     * one-roster season would not. */
    rows.push({ PLAYER: `P${di}_${String(k).padStart(2, "0")}`,
                TEAM: (k % 2 ? "BOS" : "LAL"), YEAR: String(y),
                GP: "78", MIN: String(78 * 24),
                PTS: String(Math.round(78 * p)) });
  }
});

/* THE TRADED MAN. A TOT row of 70 games and 1470 points, 21.0 a game, plus the
 * two team rows that make it up. If the builder sums all three he becomes a
 * 140-game player and his average survives unchanged, which is why the games
 * count and not the average is what gives this bug away. */
rows.push({ PLAYER: "Traded Guy", TEAM: "TOT", YEAR: "1995", GP: "70", PTS: "1470" });
rows.push({ PLAYER: "Traded Guy", TEAM: "BOS", YEAR: "1995", GP: "30", PTS: "630" });
rows.push({ PLAYER: "Traded Guy", TEAM: "LAL", YEAR: "1995", GP: "40", PTS: "840" });

/* A six-game cameo at a huge average, which must never reach a card. */
rows.push({ PLAYER: "Cameo Man", TEAM: "BOS", YEAR: "2012", GP: "6", PTS: "240" });

/* A BAA-era season, which is before MIN_YEAR and must be dropped. */
rows.push({ PLAYER: "Baa Man", TEAM: "BOS", YEAR: "1948", GP: "60", PTS: String(60 * 22) });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dream-team-"));
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

console.log("\nit builds a pool at all");

ck("there are cards", cards.length > 0, cards.length + " cards");
ck("and more than a handful, because one seed per pairing would give a handful",
   cards.length >= 10, cards.length + " cards");
ck("the build reports the TOT rows it collapsed",
   /1 of them assembled from a TOT row/.test(log),
   (log.match(/\d+ player-seasons[^\n]*/) || ["(not printed)"])[0]);

console.log("\nthe traded man, counted once");

{
  const his = [];
  for (const c of cards) {
    for (const s of c.payload.squads) {
      for (const m of s.players) if (m.name === "Traded Guy") his.push(m.ppg);
    }
  }
  /* He may or may not be picked, depending on the seed walk. If he IS, his
   * average must be the TOT row's 21.0 and not something built from double
   * counting. */
  ck("if he was picked, he averages 21.0",
     his.every(v => Math.abs(v - 21.0) < 0.05),
     his.length ? "seen " + his.length + " time(s) at " + [...new Set(his)].join(", ")
                : "(not picked by any seed, which is allowed)");
}

console.log("\nwho never appears");

{
  const names = new Set();
  for (const c of cards) for (const s of c.payload.squads) for (const m of s.players) names.add(m.name);
  ck("the six-game cameo is not on any card", !names.has("Cameo Man"),
     names.has("Cameo Man") ? "he got picked" : "");
  ck("nor does a pre-merger season", !names.has("Baa Man"),
     names.has("Baa Man") ? "he got picked" : "");

  /* Nobody is the face of the card type. The library caps this; asserted here
   * because the cap is shared across the whole run and only a real build
   * exercises that. */
  const count = new Map();
  for (const c of cards) {
    for (const s of c.payload.squads) for (const m of s.players) {
      count.set(m.name, (count.get(m.name) || 0) + 1);
    }
  }
  const worst = [...count.entries()].sort((a, b) => b[1] - a[1])[0] || ["(nobody)", 0];
  ck("no man carries more than three cards", worst[1] <= 3,
     `${worst[0]} appears on ${worst[1]}`);
}

console.log("\nevery five has the shape of a team");

{
  /* THE BUG THAT SHIPPED, caught at the level Jorge saw it. The first real
   * build produced fives of five men on the SAME average, in alphabetical
   * order, because squadFrom took consecutive entries from a list sorted by
   * scoring average. Every total was correct, every gate passed, and the cards
   * were unusable. Only the spread inside a five gives it away. */
  let worstSpread = Infinity, worstCard = "";
  let flat = 0;
  for (const c of cards) {
    for (const s of c.payload.squads) {
      const v = s.players.map(m => m.ppg);
      const spread = Math.max(...v) - Math.min(...v);
      if (spread < worstSpread) { worstSpread = spread; worstCard = c.id + " / " + s.label; }
      /* Five averages inside a single point of each other is the signature. */
      if (spread < 1.0) flat++;
    }
  }
  ck("no five is five men on the same average", flat === 0,
     flat ? `${flat} flat five(s), tightest ${worstSpread.toFixed(1)} on ${worstCard}` : "");
  ck("and the tightest five still spans a real range", worstSpread > 3,
     `tightest spread ${worstSpread.toFixed(1)} (${worstCard})`);

  /* A five listed low-to-high would read as a mistake next to its total. */
  const descending = cards.every(c => c.payload.squads.every(s =>
    s.players.every((m, i) => i === 0 || m.ppg <= s.players[i - 1].ppg + 0.001)));
  ck("every five is listed best scorer first", descending);
}

console.log("\nthe scoring era the reveal quotes");

{
  /* It has to VARY, or the sentence is decoration. The old measure came out
   * near 19 in every decade because it was computed over players who had
   * already cleared the scoring floor. */
  const eras = new Set();
  for (const c of cards) {
    for (const m of c.payload.detail.matchAll(/averaged ([\d.]+) points a game|and ([\d.]+) in the/g)) {
      eras.add(m[1] || m[2]);
    }
  }
  ck("the reveal quotes a team scoring figure", eras.size > 0, [...eras].join(", "));
  ck("and it is not the same number on every card", eras.size > 1,
     `${eras.size} distinct value(s): ${[...eras].sort().join(", ")}`);
  ck("the build printed the landmark seasons for checking",
     /points per team per game, against what these seasons are known for/.test(log));
  /* The production denominator is minutes. A fixture that quietly fell through
   * to the roster-max fallback would leave the real path untested. */
  ck("and it used the minutes denominator, not the fallback",
     /denominators: minutes/.test(log),
     (log.match(/denominators:[^\n]*/) || ["(not printed)"])[0]);
}

console.log("\nevery card's arithmetic");

for (const c of cards) {
  const p = c.payload;
  const a = p.squads[0], b = p.squads[1];

  const sumA = Math.round(a.players.reduce((n, m) => n + m.ppg, 0) * 10) / 10;
  const sumB = Math.round(b.players.reduce((n, m) => n + m.ppg, 0) * 10) / 10;
  if (Math.abs(sumA - a.total) > 0.05 || Math.abs(sumB - b.total) > 0.05) {
    ck("the printed total is the sum of the printed averages", false,
       `${c.id}: ${a.total} vs ${sumA}, ${b.total} vs ${sumB}`);
  }
  /* THE ANSWER. Re-derived from the numbers the card shows, not from anything
   * the builder said. A card whose answer is not its higher five is a card
   * that marks a right answer wrong. */
  const hi = a.total > b.total ? 0 : 1;
  if (p.answer_idx !== hi) {
    ck("the answer is the higher five", false,
       `${c.id}: answer_idx ${p.answer_idx}, higher is ${hi} (${a.total} v ${b.total})`);
  }
  if (a.total === b.total) ck("no card is a tie", false, c.id);
  if (a.label === b.label) ck("no card pits a decade against itself", false, c.id);

  const names = a.players.concat(b.players).map(m => m.name);
  if (new Set(names).size !== names.length) {
    ck("no man is on both fives", false, c.id);
  }
  /* The reveal names the higher five FIRST. A detail that opens with the
   * loser reads as though it is announcing the winner and is wrong in the
   * one sentence a reader actually reads after answering. */
  const winner = p.squads[p.answer_idx].label;
  if (p.detail.indexOf(winner) !== p.detail.search(/\b(19|20)\d0s\b/)) {
    ck("the detail names the higher five first", false, `${c.id}: ${p.detail.slice(0, 70)}`);
  }
  if (p.url !== "https://hoopsmatic.com/dream-team-game") {
    ck("the CTA points at hoopsmatic.com", false, `${c.id}: ${p.url}`);
  }
}
ck("the printed total is the sum of the printed averages", true);
ck("the answer is the higher five", true);
ck("no card is a tie", true);
ck("no card pits a decade against itself", true);
ck("no man is on both fives", true);
ck("the detail names the higher five first", true);
ck("the CTA points at hoopsmatic.com", true);

console.log("\nand it says what it is asking");

{
  const qs = new Set(cards.map(c => c.payload.question));
  ck("one question, asked the same way every time", qs.size === 1, [...qs].join(" | "));
  ck("it asks about points a game between them",
     /averaged more points a game between them/.test([...qs][0]), [...qs][0]);
  /* The claim the card must never make. Five separate averages added up is not
   * a lineup's output, and the reveal has to say so. */
  ck("every reveal says the seasons are added, not played together",
     cards.every(c => /five separate seasons added together/.test(c.payload.detail)));
  ck("no reveal contains an em dash", cards.every(c => !/—|–/.test(c.payload.detail)));
  ck("nothing reads as a number that is not one",
     cards.every(c => !/\b(NaN|undefined|null)\b/.test(c.payload.question + " " + c.payload.detail)));
}

console.log("\nthe same build twice running");

{
  const out2 = path.join(dir, "pool2.json");
  execFileSync(process.execPath, [BUILDER, "--local", dir, "--out", out2],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const again = JSON.parse(fs.readFileSync(out2, "utf8")).cards;
  /* The feed remembers what a reader has seen by story_key. A pool that
   * reshuffles on every build is a different question wearing the same key. */
  ck("gives identical cards",
     JSON.stringify(cards.map(c => [c.story_key, c.payload.answer_idx,
       c.payload.squads.map(s => s.players.map(m => m.name))])) ===
     JSON.stringify(again.map(c => [c.story_key, c.payload.answer_idx,
       c.payload.squads.map(s => s.players.map(m => m.name))])));
  ck("and unique story keys", new Set(cards.map(c => c.story_key)).size === cards.length);
  ck("and unique ids", new Set(cards.map(c => c.id)).size === cards.length);
}

fs.rmSync(dir, { recursive: true, force: true });

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "a card would mark a right answer wrong, or print a total nobody can reproduce"
                 : "every card's answer is its own higher five, and the same tomorrow");
process.exit(fail ? 1 : 0);
