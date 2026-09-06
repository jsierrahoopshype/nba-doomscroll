/* Turning a stream of increments into a bar-chart race.
 *
 * Lifted out of tools/build_races.mjs so it can be tested without the data:
 * the builder is a script that reads three repos on start-up, which makes
 * every rule inside it untestable in place. Nothing about the function
 * changed in the move.
 */

export const KEEP = 15;  // rows stored per step; the player shows 10 and lets
                         // the rest animate in and out of the frame

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
  const steps = [...perStep.keys()].sort(spec.stepSort || undefined);
  if (steps.length < 6) return null;

  const total = new Map();
  const labels = [];
  const frames = [];
  const usedKeys = new Set();

  for (const step of steps) {
    for (const [k, v] of perStep.get(step)) total.set(k, (total.get(k) || 0) + v);
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
