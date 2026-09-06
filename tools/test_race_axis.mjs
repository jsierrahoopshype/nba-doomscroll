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

/* allSteps: an award axis has holes a stat axis never has.
 *
 * All-NBA and rings arrive in bursts. If none of a fixed ten-man field won
 * anything in career year 5, that year has no increment, and without a declared
 * axis it would not exist at all - the chart would run Year 4 straight into
 * Year 6 and quietly imply nothing happened in between by not being there. */
{
  const inc = [];
  for (const y of [1, 2, 3, 4, 6, 7, 8]) {           // nothing at all in year 5
    inc.push({ step: String(y).padStart(2, "0"), key: "A", value: 1 });
    inc.push({ step: String(y).padStart(2, "0"), key: "B", value: 1 });
  }
  const all = [1,2,3,4,5,6,7,8].map(n => String(n).padStart(2, "0"));
  const spec = {
    slug: "aw", group: "g", title: "aw", unit: "u", kind: "player",
    stepSort: (a, b) => Number(a) - Number(b), labelFor: s => "Year " + Number(s), minRows: 1
  };

  const without = buildRace(spec, inc, ent);
  ck("without allSteps the empty year is simply absent",
     without.labels.length === 7 && !without.labels.includes("Year 5"),
     without.labels.join(","));

  const with_ = buildRace({ ...spec, allSteps: all }, inc, ent);
  ck("with allSteps the empty year gets a frame",
     with_.labels.length === 8 && with_.labels[4] === "Year 5", with_.labels.join(","));
  ck("and the running totals carry into it unchanged",
     with_.f[4][0][1] === 4 && with_.f[3][0][1] === 4,
     [with_.f[3][0][1], with_.f[4][0][1], with_.f[5][0][1]].join(" -> "));
  ck("a declared step nobody has reached yet is still skipped at the front",
     with_.labels[0] === "Year 1");

  /* Declared steps must not resurrect a race that has no data. */
  const empty = buildRace({ ...spec, allSteps: all }, [], ent);
  ck("allSteps alone does not build a race out of nothing", empty === null);
}

console.log(fail ? "\n"+fail+" failure(s)" : "\nthe career-year axis sorts and labels correctly");
process.exit(fail?1:0);
