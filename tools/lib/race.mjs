/* Turning a stream of increments into a bar-chart race.
 *
 * Lifted out of tools/build_races.mjs so it can be tested without the data:
 * the builder is a script that reads three repos on start-up, which makes
 * every rule inside it untestable in place. Nothing about the function
 * changed in the move.
 */

export const KEEP = 15;  // rows stored per step; the player shows 10 and lets
                         // the rest animate in and out of the frame

/** Which career year does a given season belong to, for one player?
 *
 * A career-year race asks what a man had done by his Nth season. Stats are easy
 * - a stat row IS a season. Awards are not, because an award can be stamped
 * with a season the player never played.
 *
 * MAGIC JOHNSON, 1992. He retired in November 1991, was voted into the February
 * 1992 All-Star Game anyway, played it and was named its MVP. It is his twelfth
 * selection and every reference counts it. But 1991-92 is not one of his
 * seasons - his are 1979-80 to 1990-91, then the 1995-96 comeback - so an exact
 * lookup finds no career year and the selection disappears. His chart ended on
 * eleven, which is not a number anyone recognises.
 *
 * The rule: count the seasons he had played by the award year, and if the award
 * year is not itself one of them, add one. Magic had played twelve seasons by
 * 1992 and 1991-92 was not one of them, so the selection lands on Year 13. It
 * is credited to the year he was selected, not backdated onto a season he
 * played eighteen months earlier.
 *
 * THE COST, STATED PLAINLY. Magic's Year 13 in this race is 1991-92; his Year
 * 13 in the points race is the 1995-96 comeback, because that race counts only
 * seasons played. Same man, same label, two different calendar years. The
 * alternative was making career year mean "seasons since debut" everywhere,
 * which would have put Jordan's two retirements on the chart as flat years and
 * changed all six races. That was considered and declined.
 *
 * A gap of several years with an award in each stacks them all on the same
 * slot. No such case exists among the ten, and every carried award is named in
 * the build output, so one would be visible the day it appeared.
 *
 * An award BEFORE a man's first season has nowhere sensible to go and returns
 * null for the caller to count and report.
 *
 * @param {number[]} seasonYears  his season end-years, ascending, deduped
 * @param {number} year  the season the award is stamped with
 * @returns {{careerYear: number, exact: boolean}|null}
 */
export function careerYearOf(seasonYears, year) {
  const ys = seasonYears || [];
  if (!ys.length || !year) return null;
  let best = -1;
  for (let i = 0; i < ys.length; i++) {
    if (ys[i] <= year) best = i; else break;
  }
  if (best < 0) return null;
  const exact = ys[best] === year;
  return { careerYear: best + 1 + (exact ? 0 : 1), exact };
}

/* Builds one race from a flat list of {step, key, value} increments.
 * Values accumulate step over step. Steps are emitted in sorted order and any
 * step where nothing has happened yet is skipped, so a race never opens on an
 * empty chart. */
export function buildRace(spec, increments, entityFor) {
  const perStep = new Map();       // step -> Map(key -> delta)
  for (const inc of increments) {
    if (!inc.step || !inc.key || !inc.value) continue;
    let m = perStep.get(inc.step);
    if (!m) { m = new Map(); perStep.set(inc.step, m); }
    m.set(inc.key, (m.get(inc.key) || 0) + inc.value);
  }
  /* Steps sort as strings, which is right for a 4-digit season and wrong for
   * anything else: career year 10 would land between 1 and 2. A spec that uses
   * a different axis brings its own comparator. */
  const seen = new Set(perStep.keys());
  /* A spec may declare the full axis. Without it the axis is only the steps
   * something happened in, which is right for a stat that ticks every season
   * and wrong for an award: if none of a fixed field won anything in career
   * year 22, that year would simply not exist and the axis would read
   * ... 20, 21, 23. Declared steps with no increment still get a frame, and
   * the running totals carry into it unchanged. */
  for (const s of spec.allSteps || []) seen.add(s);
  const steps = [...seen].sort(spec.stepSort || undefined);
  if (steps.length < 6) return null;

  const total = new Map();
  const labels = [];
  const frames = [];
  const usedKeys = new Set();

  for (const step of steps) {
    for (const [k, v] of (perStep.get(step) || [])) total.set(k, (total.get(k) || 0) + v);
    const rows = [...total.entries()]
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, KEEP);
    /* Thin opening seasons are skipped - unless the spec runs a fixed roster,
     * where a short field early on is the story rather than missing data. */
    if (rows.length < (spec.minRows == null ? 3 : spec.minRows)) continue;
    labels.push(spec.labelFor ? spec.labelFor(step) : String(step));
    frames.push(rows);
    rows.forEach(([k]) => usedKeys.add(k));
  }
  if (labels.length < 6) return null;

  // Only entities that ever made the top KEEP get shipped.
  const keys = [...usedKeys];
  const idx = new Map(keys.map((k, i) => [k, i]));
  const entities = keys.map(entityFor);

  return {
    slug: spec.slug,
    group: spec.group,
    title: spec.title,
    subtitle: spec.subtitle,
    unit: spec.unit,
    fmt: spec.fmt || "int",
    kind: spec.kind,
    tier: spec.tier || 2,
    note: spec.note || "",
    tags: spec.tags || {},
    labels,
    e: entities,
    f: frames.map(rows => rows.map(([k, v]) => [idx.get(k), Math.round(v * (spec.fmt === "float1" ? 10 : 1))]))
  };
}
