/* Sweeping the row files a build stopped referencing.
 *
 * WHY THIS IS ITS OWN FILE
 *
 * It deletes things. data/compare holds one JSON file per comparison card and
 * the builder had been writing the new set without removing the old one: 2,465
 * files on disk, 1,500 referenced, 965 dead and committed, and another layer
 * every time a full build ran. The draw is deterministic, so this is not
 * randomness - the INPUT moves. nba-player-data gains an All-Star, or the
 * weekly job refreshes vs-pool.json and changes which pairings are already
 * taken, and a different 1,500 come out.
 *
 * Code that unlinks files earns a test, and build_compare.mjs cannot run
 * without a checkout of nba-player-data beside it, so the rule lives here
 * where a test can hand it a temp folder and check exactly what went.
 *
 * THE RULE
 *
 * A file is dead when the pool just written does not name it. Nothing else
 * reads that folder: vs-pool.json references none of it, and the feed reaches a
 * row file only through a card's payload.file. Anything not on the keep list
 * is therefore served to nobody.
 *
 * WHAT IT REFUSES TO DO
 *
 *   an empty keep set      - a build that produced no cards is a failed build,
 *                            and emptying the folder on the way out would turn
 *                            it into a data loss
 *   files outside the dir  - a keep name containing a separator is rejected
 *                            rather than resolved
 *   anything but .json     - the extension is the contract
 *
 * dryRun reports without touching the disk, which is what --keep-orphans uses.
 */

import fs from "fs";
import path from "path";

/**
 * @param {string} dir        folder of row files
 * @param {Iterable<string>} keep  basenames the pool references
 * @param {object} [opts]     { dryRun:boolean, ext:string }
 * @returns {{ swept:string[], bytes:number, kept:number, dryRun:boolean }}
 * @throws if keep is empty, or a keep entry is not a plain basename
 */
export function sweepUnreferenced(dir, keep, opts) {
  const o = Object.assign({ dryRun: false, ext: ".json" }, opts || {});
  const keepSet = new Set(keep || []);

  if (keepSet.size === 0) {
    throw new Error("sweepUnreferenced: refusing to sweep against an empty keep set " +
      "- a build that referenced nothing is a failed build, not an empty folder");
  }
  for (const k of keepSet) {
    if (k !== path.basename(k)) {
      throw new Error(`sweepUnreferenced: keep entry is not a basename: ${k}`);
    }
  }
  if (!fs.existsSync(dir)) return { swept: [], bytes: 0, kept: 0, dryRun: o.dryRun };

  const swept = [];
  let bytes = 0, kept = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(o.ext)) continue;
    if (keepSet.has(f)) { kept++; continue; }
    const p = path.join(dir, f);
    let size = 0;
    try { size = fs.statSync(p).size; } catch { continue; }
    if (!o.dryRun) fs.unlinkSync(p);
    swept.push(f);
    bytes += size;
  }
  return { swept, bytes, kept, dryRun: o.dryRun };
}

/** One line for the build log, or "" when there was nothing to say. */
export function sweepLine(r) {
  if (!r || !r.swept.length) return "";
  const mb = (r.bytes / 1024 / 1024).toFixed(1);
  return r.dryRun
    ? `  ${r.swept.length} unreferenced row files left in place (${mb}MB, --keep-orphans)`
    : `  swept ${r.swept.length} row files this build no longer references ` +
      `(${mb}MB). They will show as deletions in git.`;
}
