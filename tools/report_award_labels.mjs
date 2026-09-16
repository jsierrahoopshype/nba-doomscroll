#!/usr/bin/env node
/* Which rows of awardVotes.json have a truncated award label.
 *
 *     node tools/report_award_labels.mjs
 *     node tools/report_award_labels.mjs --local "C:\\Users\\...\\nba-player-data"
 *
 * WHY
 *
 * build_award_history.mjs prints this on every run:
 *
 *   labels: 12 rows said "Sixth" rather than "Sixth Man" - merged.
 *   That is a bug in awardVotes.json and it will recur.
 *
 * It normalises the label so the cards are right, and it is correct that the
 * fix belongs upstream - but "12 rows" is not something anyone can act on. The
 * rows live in the sheet that generates awardVotes.json, and to correct them
 * there you need to know which players and which season. That is all this
 * prints.
 *
 * It changes nothing, writes nothing and reads one file. Run it after a season
 * of voting lands, which is when the label goes wrong again.
 *
 * The detection is in lib/award_labels.mjs and does NOT hold a list of the
 * seven correct labels - build_award_history.mjs already has that table and a
 * second copy would drift from it the next time the league adds an award. It
 * looks for the shape the bug has instead: a label whose words are the opening
 * words of a longer label, on far fewer seasons.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveSource } from "./lib/find.mjs";
import { auditAwardLabels, awardLabelReport } from "./lib/award_labels.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const li = argv.indexOf("--local");

const PD = resolveSource("nba-player-data", {
  explicit: li >= 0 ? argv[li + 1] : null,
  markers: ["awardVotes.json", "rsStats.json"]
});
if (!PD) process.exit(1);

const file = path.join(PD, "awardVotes.json");
const votes = JSON.parse(fs.readFileSync(file, "utf8"));
console.log(`\n${votes.length} vote rows in ${file}\n`);

const audit = auditAwardLabels(votes);

console.log("every award label, most rows first:");
for (const l of audit.labels) {
  const span = l.seasons ? (l.seasons === 1 ? ` ${l.from}` : ` ${l.from}-${l.to}`) : "";
  console.log(`  ${l.label.padEnd(22)} ${String(l.rows).padStart(5)} rows  ` +
    `${String(l.seasons).padStart(2)} season${l.seasons === 1 ? " " : "s"}${span}`);
}

const lines = awardLabelReport(audit);
if (!lines.length) {
  console.log("\nNo label looks truncated. Nothing to report upstream.");
  process.exit(0);
}

console.log("\nprobably truncated:");
for (const line of lines) console.log("  " + line);

/* The rows themselves, which is the point of running this. Players and seasons
 * are what a person needs to find them in the source the JSON is generated
 * from - printing the count again would be no better than the build log. */
for (const s of audit.suspects) {
  console.log(`\nthe ${s.rows} rows labelled "${s.label}", so they can be corrected at source:`);
  const hits = votes.filter(r => String((r && r.AWARD) || "").trim() === s.label);
  for (const r of hits) {
    const rnk = r.RNK == null || r.RNK === "" ? "-" : r.RNK;
    console.log(`  ${String(r.YEAR).padEnd(6)} rank ${String(rnk).padEnd(4)} ${r.PLAYER || "(no player)"}`);
  }
}

console.log(`\nThe cards are unaffected: build_award_history.mjs maps the label before it` +
  `\nbuilds anything. This is upstream hygiene, and it will be wrong again next` +
  `\nseason unless the sheet that writes awardVotes.json is fixed.\n`);
