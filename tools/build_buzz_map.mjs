#!/usr/bin/env node
/* NBA Doomscroll — buzz entity map
 *
 * The Buzz tab pulls live items from nba-content-stream's published feed. Those
 * items tag entities by SLUG ("luka-doncic", "new-york-knicks"), while every
 * other card here tags them by display name and team abbreviation ("Luka
 * Doncic", "NYK"). Without a translation the two never join: a Buzz card about
 * Luka would not surface for someone who likes Luka, and tapping his name on a
 * VS card would not show his news.
 *
 * Slugifying in the browser is not good enough — "shaquille-oneal" and
 * "nikola-jokic" do not round-trip to the right names — so the map is baked
 * here from nba-content-stream's own canonical files and shipped once. It is
 * small (roughly 20KB) and only changes when players enter the league.
 *
 * The names are then resolved against nba-player-data, because that is what
 * every other card in this app is tagged with. Matching is a ladder — exact,
 * then diacritics folded, then generational suffixes dropped, then both —
 * since the two sources disagree on "Bogdan Bogdanović" vs "Bogdan Bogdanovic"
 * and "Wendell Carter Jr." vs "Wendell Carter". A raw canonical name joined on
 * only 469 of 607 players; the ladder closes most of that gap. Anything still
 * unresolved keeps its canonical name: the card renders correctly, it just will
 * not cross-match, which is the honest outcome for a retired player who is not
 * in an active-roster file at all.
 *
 * Usage:
 *   node tools/build_buzz_map.mjs --local <nba-content-stream/data/canonical> <nba-player-data>
 *
 * Writes data/buzz-map.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

const args = process.argv.slice(2);
if (args[0] !== "--local" || !args[1] || !args[2]) {
  console.error("usage: node tools/build_buzz_map.mjs --local <nba-content-stream/data/canonical> <nba-player-data>");
  process.exit(1);
}
const CANON = args[1], PD = args[2];
const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));

const teamsRaw = readJson(path.join(CANON, "teams.json"));
const playersRaw = readJson(path.join(CANON, "players.json"));

const teams = {};
for (const [slug, t] of Object.entries(teamsRaw)) {
  if (slug === "_meta" || !t || !t.abbr) continue;
  teams[slug] = t.abbr;
}

/* nba-player-data is the naming authority: it is what vs-pool, quiz-pool, the
 * races and the salary cards are all tagged with. */
const fold = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const dropSuffix = s => s.replace(/\s+(Jr\.?|Sr\.?|I{2,3}|IV)$/i, "").trim();
const rsNames = new Set(JSON.parse(fs.readFileSync(path.join(PD, "rsStats.json"), "utf8"))
  .map(r => r.PLAYER).filter(Boolean));

// One lookup per normalisation, so each rung of the ladder is a hash hit.
const byFold = new Map(), bySuffix = new Map(), byBoth = new Map();
for (const n of rsNames) {
  const f = fold(n), d = dropSuffix(n);
  if (!byFold.has(f)) byFold.set(f, n);
  if (!bySuffix.has(d)) bySuffix.set(d, n);
  const b = dropSuffix(fold(n));
  if (!byBoth.has(b)) byBoth.set(b, n);
}

const players = {};
const stats = { exact: 0, folded: 0, suffix: 0, both: 0, unresolved: 0 };
const unresolved = [];
for (const [slug, p] of Object.entries(playersRaw)) {
  if (slug === "_meta" || !p) continue;
  const name = p.name || p.full_name;
  if (!name) continue;
  let resolved = null;
  if (rsNames.has(name)) { resolved = name; stats.exact++; }
  else if (byFold.has(fold(name))) { resolved = byFold.get(fold(name)); stats.folded++; }
  else if (bySuffix.has(dropSuffix(name))) { resolved = bySuffix.get(dropSuffix(name)); stats.suffix++; }
  else if (byBoth.has(dropSuffix(fold(name)))) { resolved = byBoth.get(dropSuffix(fold(name))); stats.both++; }
  else { resolved = name; stats.unresolved++; unresolved.push(name); }
  players[slug] = resolved;
}
console.log(`name join: ${stats.exact} exact, +${stats.folded} folded, ` +
  `+${stats.suffix} suffix, +${stats.both} both, ${stats.unresolved} unresolved`);
if (unresolved.length) console.log(`  unresolved e.g. ${unresolved.slice(0, 6).join(", ")}`);

const out = {
  built: new Date().toISOString().slice(0, 10),
  note: "slug -> display name / team abbreviation, from nba-content-stream/data/canonical",
  teams,
  players
};
const file = path.join(REPO, "data", "buzz-map.json");
fs.writeFileSync(file, JSON.stringify(out));
console.log(`wrote buzz-map.json: ${Object.keys(teams).length} teams, ` +
  `${Object.keys(players).length} players, ${Math.round(fs.statSync(file).size / 1024)}KB`);
