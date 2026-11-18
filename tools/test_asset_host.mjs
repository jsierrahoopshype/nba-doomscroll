/* Player faces and team logos load from hoopsmatic.com, not GitHub Pages.
 *
 *     node tools/test_asset_host.mjs
 *
 * WHY THIS EXISTS
 *
 * The feed lives at hoopsmatic.com/nba-doomscroll/. Every image it pulled from
 * jsierrahoopshype.github.io told GitHub which pages a reader was on. The
 * hoopsmatic-worker serves the same nba-headshots files at
 * https://hoopsmatic.com/img/nba-headshots/ (same paths), so faces and logos
 * point there: in the shipped JS, in the committed pools, and in the builders
 * that write those pools every week. A builder left on the old host would
 * quietly put the github.io URLs back on the next refresh.
 *
 * WHAT IS DELIBERATELY STILL ON PAGES. The worker route answers only for
 * players/headshots/ and teams/logos/. fallbacks/player_silhouette.svg and
 * players/metadata/players.json 404 there, so they stay on github.io until the
 * worker serves them. This file does not fail on those.
 *
 * No network: this is about which host the repo CHOOSES.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

const OLD = /https:\/\/jsierrahoopshype\.github\.io\/nba-headshots\/(players\/headshots|teams\/logos)\//;
const NEW = "https://hoopsmatic.com/img/nba-headshots/";

function walk(dir, keep, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, keep, out);
    else if (keep(p)) out.push(p);
  }
  return out;
}

const rel = p => path.relative(REPO, p);
const files = [
  ...walk(path.join(REPO, "js"), p => p.endsWith(".js")),
  ...walk(path.join(REPO, "data"), p => p.endsWith(".json")),
  /* Builders and their shared lib. Tests are skipped: test_hoopsmatic_routes
   * names a github.io headshot on purpose, to prove the link rewrite leaves it
   * alone. */
  ...walk(path.join(REPO, "tools"), p => p.endsWith(".mjs") && !path.basename(p).startsWith("test_"))
];

console.log("\nno face or logo URL on GitHub Pages");
const offenders = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  if (OLD.test(src)) offenders.push(rel(f));
}
ck(`${files.length} files scanned, none load a face or logo from github.io`,
   offenders.length === 0, offenders.slice(0, 10).join("  "));

console.log("\nthe places that build image URLs use the hoopsmatic route");
const MUST = [
  ["js/app.js", "LOGO"],
  ["js/trades.js", "LOGO_BASE"],
  ["js/trades.js", "HEADSHOT_BASE"],
  ["tools/lib/faces.mjs", "HEADSHOT_BASE"],
  ["tools/build_vault.mjs", "HEADSHOT_BASE"],
  ["tools/build_vault.mjs", "LOGO_BASE"],
  ["tools/build_races.mjs", "HEADSHOT_BASE"],
  ["tools/build_races.mjs", "LOGO_BASE"],
  ["tools/build_data.mjs", "HM_HEADSHOTS"]
];
for (const [f, name] of MUST) {
  const src = fs.readFileSync(path.join(REPO, f), "utf8");
  const m = src.match(new RegExp("(?:var|const|let)\\s+" + name + "\\s*=\\s*\\n?\\s*\"([^\"]+)\""));
  ck(`${f} ${name}`, !!m && m[1].indexOf(NEW) === 0, m ? m[1] : "(not found)");
}

console.log("\nand the pools actually carry the new host");
{
  const vault = fs.readFileSync(path.join(REPO, "data", "vault-pool.json"), "utf8");
  ck("vault-pool.json has hoopsmatic.com image URLs", vault.includes(NEW));
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
process.exit(fail ? 1 : 0);
