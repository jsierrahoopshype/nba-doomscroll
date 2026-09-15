/* What the sweep deletes, and what it refuses to.
 *
 *     node tools/test_sweep.mjs
 *
 * It unlinks committed files, so the interesting cases are the refusals: an
 * empty keep set, a keep name that is a path rather than a name, a folder that
 * is not there. Everything runs against a temp folder, never data/compare.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { sweepUnreferenced, sweepLine } from "./lib/sweep.mjs";

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* A folder of row files, some referenced and some not. */
function fixture(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-"));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return dir;
}
const ls = dir => fs.readdirSync(dir).sort();

console.log("\nthe dead files go, the live ones stay");

{
  const dir = fixture({
    "a-vs-b.json": "x".repeat(100),
    "c-vs-d.json": "x".repeat(100),
    "old-vs-gone.json": "x".repeat(500),
    "older-vs-gone.json": "x".repeat(500)
  });
  const r = sweepUnreferenced(dir, ["a-vs-b.json", "c-vs-d.json"]);
  ck("both unreferenced files are gone", r.swept.length === 2, r.swept.join(", "));
  ck("the referenced ones are still there",
     ls(dir).join(",") === "a-vs-b.json,c-vs-d.json", ls(dir).join(","));
  ck("it counts what it kept", r.kept === 2, String(r.kept));
  ck("it adds up the bytes it freed", r.bytes === 1000, String(r.bytes));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\na keep name for a file that is not there is not an error");

{
  /* The pool may reference a file written in this same build; the sweep runs
   * after the writes, but a keep list longer than the folder must not throw. */
  const dir = fixture({ "a-vs-b.json": "x", "dead-vs-weight.json": "x" });
  const r = sweepUnreferenced(dir, ["a-vs-b.json", "never-vs-written.json"]);
  ck("it sweeps what it can and ignores the rest", r.swept.length === 1, r.swept.join(", "));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\nit only ever touches the extension it was given");

{
  const dir = fixture({
    "a-vs-b.json": "x", "dead-vs-weight.json": "x",
    "README.md": "not mine", "index.html": "not mine"
  });
  sweepUnreferenced(dir, ["a-vs-b.json"]);
  ck("files of other kinds survive", ls(dir).join(",") === "README.md,a-vs-b.json,index.html",
     ls(dir).join(","));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\nthe refusals, which are the point");

{
  const dir = fixture({ "a-vs-b.json": "x", "c-vs-d.json": "x" });
  let threw = false;
  try { sweepUnreferenced(dir, []); } catch { threw = true; }
  ck("an empty keep set throws rather than emptying the folder", threw);
  ck("and nothing was deleted", ls(dir).length === 2, String(ls(dir).length));

  threw = false;
  try { sweepUnreferenced(dir, ["../../js/app.js"]); } catch { threw = true; }
  ck("a keep entry with a path in it is rejected", threw);

  threw = false;
  try { sweepUnreferenced(dir, ["sub/a-vs-b.json"]); } catch { threw = true; }
  ck("so is one in a subfolder", threw);
  ck("still nothing deleted", ls(dir).length === 2, String(ls(dir).length));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\na dry run touches nothing");

{
  const dir = fixture({ "a-vs-b.json": "x", "dead-vs-weight.json": "x".repeat(2048) });
  const r = sweepUnreferenced(dir, ["a-vs-b.json"], { dryRun: true });
  ck("it reports the file it would have deleted", r.swept.length === 1, r.swept.join(", "));
  ck("and the file is still on disk", ls(dir).length === 2, ls(dir).join(","));
  ck("the line says left in place", /left in place/.test(sweepLine(r)), sweepLine(r));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log("\nrubbish in");

ck("a folder that is not there is not an error",
   sweepUnreferenced(path.join(os.tmpdir(), "sweep-does-not-exist-" + Date.now()),
     ["a.json"]).swept.length === 0);
ck("nothing swept means no log line", sweepLine({ swept: [], bytes: 0 }) === "");
ck("no result at all means no log line", sweepLine(null) === "");

{
  const dir = fixture({ "a-vs-b.json": "x" });
  const r = sweepUnreferenced(dir, ["a-vs-b.json"]);
  ck("a build that changed nothing sweeps nothing", r.swept.length === 0 && r.kept === 1);
  ck("and says nothing", sweepLine(r) === "");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "do not let it near data/compare" : "it deletes the dead and only the dead");
process.exit(fail ? 1 : 0);
