/* The race axis: sorting, labelling, and the opening-frame rule.
 *
 *     node tools/test_race_axis.mjs
 *
 * Every race in this project ran on calendar time, where steps are 4-digit
 * years and sorting them as strings is correct by accident. The HoopsHype top
 * 10 races on CAREER year instead - Year 1 against Year 1 - and there "10"
 * sorts between "1" and "2", which would have put Year 10 near the start of
 * the chart and looked like a rendering bug rather than a sorting one.
 *
 * So buildRace takes an optional comparator and label function. The cases
 * below check the new axis works AND that a race with no hooks comes out
 * exactly as it did before, which is the half that protects the twenty-odd
 * calendar races already shipped.
 *
 * buildRace lives in tools/lib/race.mjs for this: the builder around it reads
 * three repos on start-up and cannot be imported without them.
 */

import { buildRace } from "./lib/race.mjs";
const ent = n => ({ n });
let fail = 0;
const ck = (name, ok, d) => { console.log((ok?"  ok   ":"  FAIL ")+name+(d?"   "+d:"")); if(!ok) fail++; };

/* Ten men, 24 career years, zero-padded steps. */
const inc = [];
for (let cy = 1; cy <= 24; cy++)
  for (const p of ["A","B","C"])
    inc.push({ step: String(cy).padStart(2,"0"), key: p, value: cy * (p==="A"?3:p==="B"?2:1) });

const r = buildRace({
  slug:"t", group:"g", title:"t", unit:"u", kind:"player",
  stepSort: (a,b) => Number(a)-Number(b),
  labelFor: s => "Year " + Number(s),
  minRows: 2
}, inc, ent);

ck("the race builds", !!r);
ck("24 frames, one per career year", r.labels.length === 24, String(r.labels.length));
ck("labels read as years, not zero-padded strings",
   r.labels[0] === "Year 1" && r.labels[9] === "Year 10" && r.labels[23] === "Year 24",
   [r.labels[0], r.labels[9], r.labels[23]].join(" | "));
ck("Year 10 comes after Year 9, which string sorting would break",
   r.labels.indexOf("Year 10") > r.labels.indexOf("Year 9"));
ck("the leader is the one accumulating fastest", r.f[23][0][0] === r.e.findIndex(e => e.n === "A"));

/* Default behaviour must be untouched for the calendar races. */
const cal = [];
for (const y of [1998,1999,2000,2001,2002,2003])
  for (const p of ["A","B","C"]) cal.push({ step: String(y), key: p, value: 10 });
const c = buildRace({ slug:"c", group:"g", title:"c", unit:"u", kind:"player" }, cal, ent);
ck("a calendar race with no hooks is unchanged",
   c && c.labels.length === 6 && c.labels[0] === "1998", c && c.labels.join(","));

/* minRows defaulting: a two-man frame is dropped without the hook. */
const thin = [];
thin.push({step:"1998",key:"A",value:1},{step:"1998",key:"B",value:1});
for (const y of [1999,2000,2001,2002,2003,2004])
  for (const p of ["A","B","C"]) thin.push({step:String(y),key:p,value:1});
const d = buildRace({ slug:"d", group:"g", title:"d", unit:"u", kind:"player" }, thin, ent);
ck("without minRows a two-man opening frame is still skipped",
   d && d.labels[0] === "1999", d && d.labels[0]);
const e2 = buildRace({ slug:"e", group:"g", title:"e", unit:"u", kind:"player", minRows: 2 }, thin, ent);
ck("with minRows:2 it is kept", e2 && e2.labels[0] === "1998", e2 && e2.labels[0]);

console.log(fail ? "\n"+fail+" failure(s)" : "\nthe career-year axis sorts and labels correctly");
process.exit(fail?1:0);
