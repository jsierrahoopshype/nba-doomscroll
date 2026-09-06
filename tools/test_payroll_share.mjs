/* A payroll share is a division, and this one shipped with the wrong bottom.
 *
 *     node tools/test_payroll_share.mjs
 *
 * WHAT WENT WRONG
 *
 * "Luka Doncic was 47% of the LAL payroll in 2025-26" went out on the feed.
 * The real figure is 23%. The card summed eleven men to a $96.8M book; the
 * Lakers paid $197.1M to nineteen. LeBron James - the highest-paid player on
 * the team - was not in salaries.json at all, which is also why the card named
 * Austin Reaves as the next-highest earner.
 *
 * The builder did have a guard: a minimum roster COUNT. Eleven cleared it.
 * A count cannot tell you a payroll is complete, and the failure is silent -
 * every card still reads as a fact, because the arithmetic on the wrong
 * numbers is correct.
 *
 * WHAT CATCHES IT
 *
 * The money. Every NBA team must spend at least 90% of the cap or write a
 * cheque for the difference, so a team-season summing to less than that is
 * missing people. The two bad cards came in at 63% and 73% of cap; the four
 * that were right came in at 121% to 224%. Not a close call.
 *
 * This checks the SHIPPED pool rather than the builder, because the pool is
 * what readers see and it can go stale independently: a correct builder and a
 * pool built before it was fixed still puts a wrong number on the site.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pool = JSON.parse(fs.readFileSync(path.join(REPO, "data/salary-pool.json"), "utf8"));
const cards = pool.cards || pool;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   " + detail : ""));
  if (!ok) failures++;
}

const money = s => {
  const m = /\$?([\d.]+)M/.exec(String(s || ""));
  return m ? parseFloat(m[1]) : null;
};

/* The floor the builder enforces. Kept a touch under the real 90% so a team
 * genuinely at the floor is not dropped; see MIN_PAYROLL_OF_CAP in
 * tools/build_salary.mjs, which this mirrors deliberately. */
const MIN_OF_CAP = 0.80;
/* An NBA roster minimum is 14 under standard contracts. Used only where the
 * cap is not recoverable, as a weaker second-best. */
const MIN_MEN_MODERN = 14;

const payroll = cards.filter(c => /^salary:payroll-/.test(c.story_family || ""));

console.log("\nthe shipped pool");
check("there are payroll cards to check at all", payroll.length > 0,
  payroll.length + " found");

/* ---------------- 1. the book against the cap ---------------- */

console.log("\nevery book covers the salary floor");

for (const c of payroll) {
  const p = c.payload || {};
  const label = (p.team || (c.tags && c.tags.teams && c.tags.teams[0]) || "?") + " " +
                (p.season || (/in (\d{4}-\d{2})/.exec(p.headline || "") || [])[1] || "?");

  /* Preferred: the ratio the builder recorded. Cards built before that field
   * existed fall back to the cap they print, and the ones that print no cap
   * fall back to the roster count. Each rung is weaker than the last and the
   * output says which one ran, so a pool that can only be weakly checked
   * cannot look like one that passed the strong check. */
  if (typeof p.of_cap === "number") {
    check(label + " book vs cap (recorded)", p.of_cap >= MIN_OF_CAP,
      (p.of_cap * 100).toFixed(0) + "% of cap");
    continue;
  }

  const book = money(p.detail && /of a (\$[\d.]+M) book/.exec(p.detail) &&
                     /of a (\$[\d.]+M) book/.exec(p.detail)[1]) ?? money(p.subtitle);
  const cap = money(p.cap);
  if (book !== null && cap !== null && cap > 0) {
    check(label + " book vs cap (derived)", book / cap >= MIN_OF_CAP,
      "$" + book + "M book against a $" + cap + "M cap = " +
      (book / cap * 100).toFixed(0) + "%");
    continue;
  }

  const men = p.paid_players ??
    ((/across (\d+) paid players/.exec(p.detail || p.subtitle || "") || [])[1]);
  const modern = /20\d\d/.test(String(p.season || p.headline || "")) &&
                 !/19\d\d/.test(String(p.season || p.headline || ""));
  if (men && modern) {
    check(label + " roster size (no cap on the card)", +men >= MIN_MEN_MODERN,
      men + " paid players");
    continue;
  }
  check(label + " can be checked at all", false,
    "no of_cap, no cap, no roster count — this card cannot be verified");
}

/* ---------------- 2. the arithmetic on the card ---------------- */

console.log("\nthe stated share matches the numbers beside it");

for (const c of payroll.filter(c => c.story_family === "salary:payroll-concentration")) {
  const p = c.payload || {};
  const pct = (/was (\d+)% of the/.exec(p.headline || "") || [])[1];
  const salary = money(p.salary);
  const bookM = /of a (\$[\d.]+M) book/.exec(p.detail || "");
  const book = bookM ? money(bookM[1]) : null;
  if (pct === undefined || salary === null || book === null) {
    check((p.team || "?") + " " + (p.season || "?") + " has the parts to check", false,
      JSON.stringify([pct, p.salary, p.detail]).slice(0, 120));
    continue;
  }
  const real = Math.round(salary / book * 100);
  check((p.team || "?") + " " + (p.season || "?") + " headline % matches salary/book",
    Math.abs(real - +pct) <= 1, pct + "% stated, " + real + "% computed");
}

/* ---------------- 3. the specific card that was wrong ---------------- */

console.log("\nthe one that shipped");

{
  const bad = payroll.find(c => /Luka Doncic was 47% of the LAL payroll in 2025-26/
    .test((c.payload || {}).headline || ""));
  check("the 47% Lakers card is gone from the pool", !bad,
    bad ? "still present as " + bad.id : "");
}

console.log(failures
  ? "\n" + failures + " failure(s) — a payroll card is dividing by an incomplete book"
  : "\nevery payroll card divides by a book that covers the salary floor");
process.exit(failures ? 1 : 0);
