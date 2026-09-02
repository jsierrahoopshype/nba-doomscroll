/* Does the link checker actually catch a link going wrong?
 *
 *     node tools/test_link_identity.mjs
 *
 * Exercises the comparison at the heart of tools/test_links.mjs against
 * invented responses, so the logic is proven without touching a real endpoint
 * and without needing the network at all.
 *
 * The middle case is the one that matters, and it is the reason this file
 * exists: a deep link that starts redirecting to a homepage still answers 200,
 * so no status checker sees it, and every VS card lands on the front page
 * while the dashboard stays green.
 *
 * It earned its keep immediately. The first version of `differences` skipped
 * any field recorded as null - which reads as reasonable and silently disabled
 * exactly that check, because a healthy deep link records redirected_to: null.
 * The one case the tool was built for was the one case it could not see.
 */
import fs from "fs";
const SRC = new URL("./test_links.mjs", import.meta.url).pathname;
const src = fs.readFileSync(SRC, "utf8");

// lift the two pure functions the checking rests on
const body = src.match(/function identity\(o(?:, link)?\) \{[\s\S]*?\n\}/)[0] +
             "\n" + src.match(/function differences\(want, got\) \{[\s\S]*?\n\}/)[0] +
             "\nreturn { identity, differences };";
const { identity, differences } = new Function(body)();

const healthy = { status: 200, type: "text/html", final: null, title: "Compare players · HoopsMatic", ms: 40 };
const recorded = identity(healthy, {});
console.log("  recorded identity:", JSON.stringify(recorded));

const cases = [
  ["unchanged", healthy, 0],
  ["deep link now redirects to the homepage",
   { ...healthy, final: "https://hoopsmatic.com/", title: "HoopsMatic" }, 2],
  ["tool renamed, title changed",
   { ...healthy, title: "Player Comparison · HoopsMatic" }, 1],
  ["now answers with JSON instead of a page",
   { status: 200, type: "application/json", final: null, shape: "error,code", ms: 20 }, 3],
  ["parked domain: 200 with a different title",
   { ...healthy, title: "This domain is for sale" }, 1]
];
let bad = 0;
for (const [name, got, wantDiffs] of cases) {
  const d = differences(recorded, identity(got, {}));
  const ok = d.length === wantDiffs;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name.padEnd(44)} ${d.length} difference(s)` +
    (ok ? "" : ` (want ${wantDiffs})`));
  d.forEach(x => console.log(`         ${x}`));
}
/* A site that redirects by region must not read as a broken link. hoopshype
 * sends a Madrid machine to eu.hoopshype.com and a US one somewhere else;
 * comparing that would fail whenever the check changed country. */
const varying = { status: 200, type: "text/html", final: "https://eu.hoopshype.com/rumors/", title: "NBA Rumors" };
const elsewhere = { ...varying, final: "https://hoopshype.com/rumors/" };
const withOptOut = differences(identity(varying, { redirect_varies: true }), identity(elsewhere, { redirect_varies: true }));
const without = differences(identity(varying, {}), identity(elsewhere, {}));
console.log(`  ${withOptOut.length === 0 ? "ok  " : "FAIL"} a geo-redirect is ignored when redirect_varies is set`);
console.log(`  ${without.length === 1 ? "ok  " : "FAIL"} and still compared when it is not`);
if (withOptOut.length !== 0 || without.length !== 1) bad++;

// a JSON endpoint that changes shape
const api = identity({ status: 200, type: "application/json", final: null, shape: "digest,days,generated" }, {});
const changed = differences(api, identity({ status: 200, type: "application/json", final: null, shape: "digest,generated" }, {}));
console.log(`  ${changed.length === 1 ? "ok  " : "FAIL"} a JSON endpoint dropping a top-level key is caught`);
if (changed.length !== 1) bad++;
console.log(bad ? `\n${bad} failed` : "\nthe identity comparison behaves");
process.exit(bad ? 1 : 0);
