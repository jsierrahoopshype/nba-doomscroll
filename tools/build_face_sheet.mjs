#!/usr/bin/env node
/* A contact sheet for every baked race tile.
 *
 * WHY
 *
 * The aspect-ratio bug that made every head 17% too narrow was found by
 * rendering one tile and looking at it. What no one has ever done is look at
 * all of them at once, which is the only way to see the remaining problem:
 * the crop is the same 80% of every source, but the sources are not the same.
 * Some portraits fill the frame and lose the top of the head; others sit low
 * with an inch of dead space above. Each tile looks fine alone. Side by side
 * they do not belong to the same set.
 *
 * This writes one HTML page showing all of them, sorted worst-first by a
 * measurement rather than by name, with a fixed guide line so a head that
 * rides high or low is visible against something other than an impression.
 *
 * WHAT THE MEASUREMENT IS, AND WHAT IT IS NOT
 *
 * For each row of pixels it sums the horizontal contrast - how much
 * neighbouring pixels differ - and takes the centroid of that down the tile.
 * A row crossing eyes, nostrils and a jawline carries far more contrast than a
 * row of flat backdrop, so the centroid lands near the middle of the face.
 *
 * It is a proxy, not a face detector. A busy jersey pulls it down; a bright
 * background pulls it up. It is good enough to ORDER 737 tiles so the ones
 * worth looking at come first, and not good enough to decide anything on its
 * own. The page exists so a person makes the call.
 *
 *   node tools/build_face_sheet.mjs
 *   then open tools/face-sheet.html
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decodePng } from "./lib/png.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const FACE_DIR = path.join(REPO, "data", "races", "faces");
const OUT = path.join(__dirname, "face-sheet.html");

/** Vertical centroid of horizontal contrast, 0 (top) to 1 (bottom). */
function measure(file) {
  const img = decodePng(file);
  if (!img) return null;
  const { w, h, data } = img;
  let total = 0, weighted = 0, energy = 0;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4, j = (y * w + x - 1) * 4;
      sum += Math.abs(data[i] - data[j]) +
             Math.abs(data[i + 1] - data[j + 1]) +
             Math.abs(data[i + 2] - data[j + 2]);
    }
    total += sum;
    weighted += sum * y;
    energy += sum;
  }
  if (!total) return null;
  return { centroid: weighted / total / h, energy: energy / (w * h), w, h };
}

let files = [];
try { files = fs.readdirSync(FACE_DIR).filter(f => /\.png$/i.test(f)); }
catch (e) {
  console.error(`No tiles at ${FACE_DIR}. Run build_races.mjs first.`);
  process.exit(1);
}

const tiles = [];
for (const f of files) {
  const m = measure(path.join(FACE_DIR, f));
  if (m) tiles.push({ f, name: f.replace(/\.png$/i, "").replace(/-/g, " "), ...m });
}
if (!tiles.length) { console.error("No readable tiles."); process.exit(1); }

const sorted = tiles.map(t => t.centroid).sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
/* Distance from the median, not from an invented ideal. The set only has to
 * agree with itself: a tile is suspicious because it is unlike the other 736,
 * which is a fact about this data rather than a number someone chose. */
for (const t of tiles) t.off = t.centroid - median;
tiles.sort((a, b) => Math.abs(b.off) - Math.abs(a.off));

const q = p => sorted[Math.floor(p * (sorted.length - 1))];
const stats = {
  n: tiles.length, median,
  p05: q(0.05), p95: q(0.95), min: q(0), max: q(1),
  wide: tiles.filter(t => Math.abs(t.off) > 0.06).length
};

const esc = s => String(s).replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const cards = tiles.map(t => `
<figure class="t${Math.abs(t.off) > 0.06 ? " flag" : ""}" data-off="${t.off.toFixed(4)}" data-name="${esc(t.name)}">
  <div class="wrap"><img src="../data/races/faces/${encodeURIComponent(t.f)}" alt="${esc(t.name)}" loading="lazy"><span class="guide"></span></div>
  <figcaption>${esc(t.name)}<b>${t.off > 0 ? "+" : ""}${t.off.toFixed(3)}</b></figcaption>
</figure>`).join("");

const html = `<!doctype html>
<meta charset="utf-8">
<title>Race face tiles — ${stats.n}</title>
<style>
  :root { color-scheme: dark; --bg:#111114; --fg:#e8e8ea; --dim:#8a8a92; --flag:#e0603c; }
  body { margin:0; background:var(--bg); color:var(--fg);
         font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  header { position:sticky; top:0; background:var(--bg); border-bottom:1px solid #2a2a30;
           padding:14px 18px; z-index:2; }
  h1 { margin:0 0 6px; font-size:16px; font-weight:600; }
  p { margin:0; color:var(--dim); font-size:13px; max-width:70ch; }
  .controls { margin-top:10px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
  input[type=search] { background:#1c1c22; border:1px solid #33333c; color:var(--fg);
                       padding:6px 9px; border-radius:5px; font:inherit; width:220px; }
  label { color:var(--dim); font-size:13px; display:flex; align-items:center; gap:5px; }
  main { display:grid; grid-template-columns:repeat(auto-fill,minmax(126px,1fr));
         gap:10px; padding:16px 18px 60px; }
  figure { margin:0; }
  .wrap { position:relative; line-height:0; background:#000; border-radius:3px; overflow:hidden; }
  .wrap img { width:100%; display:block; image-rendering:auto; }
  /* The fixed reference. Every head is judged against the same line rather
     than against whichever tile happens to sit beside it. */
  .guide { position:absolute; left:0; right:0; top:50%; height:1px;
           background:rgba(255,70,70,.85); pointer-events:none; }
  body.noguide .guide { display:none; }
  figcaption { font-size:11px; color:var(--dim); margin-top:4px;
               display:flex; justify-content:space-between; gap:6px; }
  figcaption b { font-variant-numeric:tabular-nums; font-weight:600; color:#6a6a74; }
  .flag figcaption b { color:var(--flag); }
  .flag .wrap { outline:1px solid var(--flag); }
  body.onlyflag figure:not(.flag) { display:none; }
  figure.hide { display:none; }
</style>
<header>
  <h1>Race face tiles — ${stats.n}, sorted by how far each sits from the set</h1>
  <p>Number is the vertical centre of detail minus the median (${stats.median.toFixed(3)}).
     Negative means the head rides high in the frame, positive means it sits low.
     Range ${stats.min.toFixed(3)} to ${stats.max.toFixed(3)};
     ${stats.wide} tiles are more than 0.06 off, outlined in orange.
     The measurement orders the sheet — it does not decide anything. Your eye does.</p>
  <div class="controls">
    <input type="search" id="q" placeholder="filter by name" autocomplete="off">
    <label><input type="checkbox" id="guide" checked> centre line</label>
    <label><input type="checkbox" id="only"> only the flagged ${stats.wide}</label>
  </div>
</header>
<main id="grid">${cards}</main>
<script>
  const grid = document.getElementById("grid");
  document.getElementById("guide").onchange = e =>
    document.body.classList.toggle("noguide", !e.target.checked);
  document.getElementById("only").onchange = e =>
    document.body.classList.toggle("onlyflag", e.target.checked);
  document.getElementById("q").oninput = e => {
    const v = e.target.value.trim().toLowerCase();
    for (const f of grid.children)
      f.classList.toggle("hide", v && !f.dataset.name.toLowerCase().includes(v));
  };
</script>
`;

fs.writeFileSync(OUT, html);
console.log(`${stats.n} tiles measured.`);
console.log(`  median centre of detail ${stats.median.toFixed(3)}, ` +
  `p05 ${stats.p05.toFixed(3)}, p95 ${stats.p95.toFixed(3)}, ` +
  `range ${stats.min.toFixed(3)}-${stats.max.toFixed(3)}`);
console.log(`  ${stats.wide} tiles more than 0.06 from the median.`);
console.log(`\nwrote ${OUT}`);
console.log("Open it and look at the first two rows: those are the tiles least like the rest.");
