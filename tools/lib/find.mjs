/* Find a builder's source folder instead of asking someone to type its path.
 *
 * WHY THIS EXISTS
 *
 * Every local-source builder here takes a path to a checkout on Jorge's
 * machine, and pasting those paths has been the single most reliable way to
 * lose an afternoon: a placeholder pasted verbatim, a trailing backslash that
 * cmd turned into an escaped quote, a folder that existed under a different
 * name than anyone remembered. The retile tool solved it by searching for the
 * files it needed, and two pools stayed unbuilt for weeks purely because
 * nobody had the path to hand.
 *
 * So a builder names the files it cannot work without, and this finds the
 * folder holding them. An explicit path still wins when one is given.
 *
 * MORE THAN ONE MATCH IS THE INTERESTING CASE, not an error. This machine has
 * two media-vote-tracker checkouts holding DIFFERENT datasets, and a build
 * that silently picked the wrong one produced 92 players instead of 99 and
 * said nothing. So every match is returned, newest content first, and the
 * caller is expected to show them all rather than quietly take one.
 */

import fs from "fs";
import os from "os";
import path from "path";

/* Bounded at six levels and skipping the directories that make a home folder
 * expensive to walk. Deep enough for ~/Documents/GitHub/repo/sub/data, which
 * is where these actually live. */
const MAX_DEPTH = 6;
const SKIP = new Set([
  "node_modules", ".git", ".venv", "venv", "__pycache__", ".cache", "AppData",
  "Library", "Windows", "Program Files", "Program Files (x86)", ".next",
  "dist", "build", "site-packages", ".gradle", "OneDrive"
]);

function walk(root, depth, visit) {
  if (depth > MAX_DEPTH) return;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { return; }                      // unreadable is not our business
  for (const e of entries) {
    if (!e.isDirectory() || SKIP.has(e.name) || e.name.startsWith(".")) continue;
    const full = path.join(root, e.name);
    visit(full);
    walk(full, depth + 1, visit);
  }
}

/** Folders directly containing every one of `markers`. Newest first. */
export function findFolders(markers, root) {
  const home = root || os.homedir();
  const hits = [];
  const check = dir => {
    for (const m of markers) {
      if (!fs.existsSync(path.join(dir, m))) return;
    }
    let mtime = 0;
    try { mtime = fs.statSync(path.join(dir, markers[0])).mtimeMs; } catch (e) {}
    hits.push({ dir, mtime });
  };
  check(home);
  walk(home, 0, check);
  return hits.sort((a, b) => b.mtime - a.mtime).map(h => h.dir);
}

/** Files anywhere under home with one of these exact names. Newest first. */
export function findFiles(names, root) {
  const home = root || os.homedir();
  const want = new Set(names.map(n => n.toLowerCase()));
  const hits = [];
  const scan = dir => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return; }
    for (const e of entries) {
      if (e.isFile() && want.has(e.name.toLowerCase())) {
        const full = path.join(dir, e.name);
        let mtime = 0;
        try { mtime = fs.statSync(full).mtimeMs; } catch (err) {}
        hits.push({ full, mtime });
      }
    }
  };
  scan(home);
  walk(home, 0, scan);
  return hits.sort((a, b) => b.mtime - a.mtime).map(h => h.full);
}

/* Windows hands paths back with debris on the end: a cmd FOR loop's %~dp
 * expansion finishes with a backslash, and "...\dir\" reaches the process as
 * ...dir" because cmd read the backslash as escaping the closing quote. */
export function cleanPath(p) {
  if (!p) return p;
  let s = String(p).trim().replace(/^["']+/, "").replace(/["']+$/, "");
  if (s.length > 3) s = s.replace(/[\\/]+$/, "");
  return s;
}

/* Resolves one source, printing what it looked at. Returns the chosen path, or
 * null having already explained why not - the caller just exits.
 *
 * `explicit` wins with no searching. Several matches are all printed and the
 * newest is used, because the alternative is choosing in silence. */
export function resolveSource(label, { explicit, markers, files }) {
  const given = cleanPath(explicit);
  if (given) {
    if (!fs.existsSync(given)) {
      console.error(`  ${label}: no such path: ${given}`);
      return null;
    }
    return given;
  }
  process.stdout.write(`  searching for ${label}...`);
  const hits = files ? findFiles(files) : findFolders(markers);
  console.log(` ${hits.length} found`);
  if (!hits.length) {
    console.error(`  Could not find ${label}. Expected a ${files ? "file called" : "folder containing"} ` +
      `${(files || markers).join(", ")} somewhere under ${os.homedir()}.`);
    return null;
  }
  hits.forEach((h, i) => console.log(`    ${i === 0 ? "using " : "also  "}${h}`));
  if (hits.length > 1) {
    console.log(`    (${hits.length} candidates, newest first. Pass --local to choose a different one.)`);
  }
  return hits[0];
}
