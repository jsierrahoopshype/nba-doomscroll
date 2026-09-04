#!/usr/bin/env node
/* Before and after, side by side, for the race tile crop.
 *
 * The contact sheet showed the problem: 752 tiles, heads at wildly different
 * sizes and heights, because the crop takes a fixed fraction of every source
 * regardless of how that source frames its subject. headRaceTile finds the
 * head via the cut-out's alpha channel and crops around it instead.
 *
 * Whether that is actually better is a question about pictures, and the only
 * honest way to answer it is to look. This renders one PNG: current crop on
 * top, head-normalised underneath, same players, same tile size, a red line at
 * the same height through both. Nothing is written to data/races - this only
 * produces an image to look at.
 *
 *   node tools/build_face_compare.mjs
 *   node tools/build_face_compare.mjs --faces "C:\path\to\assets\headshots"
 *   node tools/build_face_compare.mjs --worst 24   (default 16)
 *
 * Writes tools/face-compare.png
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decodePng, encodePng, resize, crop, raceFaceTile } from "./lib/png.mjs";
import { headRaceTile, foldedPngIndex, foldAccents } from "./lib/faces.mjs";
import { findFolders } from "./lib/find.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");
const FACE_DIR = path.join(REPO, "data", "races", "faces");
const OUT = path.join(__dirname, "face-compare.png");

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : null; };
const WANT = Math.max(4, Math.min(40, parseInt(flag("worst") || "16", 10) || 16));

/* The source folder, found the same way build_races finds it: most portraits
 * wins, because a deployment subset would silently narrow the comparison. */
let SRC = flag("faces");
if (!SRC) {
  const hits = findFolders([path.join("assets", "headshots")])
    .map(d => path.join(d, "assets", "headshots"))
    .map(dir => {
      let n = 0;
      try { n = fs.readdirSync(dir).filter(f => /\.png$/i.test(f)).length; } catch (e) {}
      return { dir, n };
    })
    .sort((a, b) => b.n - a.n);
  if (!hits.length) {
    console.error("No bar-chart-race headshots folder found. Pass --faces with its path.");
    process.exit(1);
  }
  SRC = hits[0].dir;
  console.log(`sources: ${SRC} (${hits[0].n} PNGs)`);
}

/* WHICH PLAYERS TO SHOW: the ones the contact sheet flags, not a random
 * sample. A random sample is mostly tiles that are already fine, which would
 * make any change look like it does nothing. */
function centroid(file) {
  const img = decodePng(file);
  if (!img) return null;
  const { w, h, data } = img;
  let total = 0, weighted = 0;
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4, j = (y * w + x - 1) * 4;
      sum += Math.abs(data[i] - data[j]) + Math.abs(data[i+1] - data[j+1]) + Math.abs(data[i+2] - data[j+2]);
    }
    total += sum; weighted += sum * y;
  }
  return total ? weighted / total / h : null;
}

let tiles = [];
try { tiles = fs.readdirSync(FACE_DIR).filter(f => /\.png$/i.test(f)); }
catch (e) { console.error(`No baked tiles at ${FACE_DIR}. Run build_races.mjs first.`); process.exit(1); }

const measured = [];
for (const f of tiles) {
  const c = centroid(path.join(FACE_DIR, f));
  if (c != null) measured.push({ slug: f.replace(/\.png$/i, ""), c });
}
const sortedC = measured.map(m => m.c).sort((a, b) => a - b);
const median = sortedC[Math.floor(sortedC.length / 2)];
measured.sort((a, b) => Math.abs(b.c - median) - Math.abs(a.c - median));

/* The tile slug is the source filename slugified, so the way back is the same
 * fold the builder uses - "jusuf-nurkic" has to reach "Jusuf Nurkić.png". */
const idx = foldedPngIndex(SRC);
const bySlug = new Map();
for (const [folded, file] of idx) {
  bySlug.set(folded.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), file);
}

const W = 112, H = 80, PAD = 6, GAP = 22;
const picks = [];
for (const m of measured) {
  if (picks.length >= WANT) break;
  const src = bySlug.get(m.slug);
  if (!src) continue;
  const before = raceFaceTile(src, W, H);
  const after = headRaceTile(src, W, H, { decodePng, encodePng, resize, crop });
  if (!before || !after) continue;          // no alpha: it would fall back anyway
  picks.push({ ...m, src, before, after: after.buf, head: after.head });
}

if (!picks.length) {
  console.error("Nothing to compare: no flagged tile resolved to a source with an alpha channel.");
  console.error("That is itself the answer - these sources are opaque, so head detection cannot run.");
  process.exit(1);
}

const COLS = Math.min(8, picks.length);
const rows = Math.ceil(picks.length / COLS);
const cellH = H * 3 + PAD * 2 + GAP;
const cw = COLS * (W + PAD) + PAD;
const ch = rows * cellH + PAD;
const out = Buffer.alloc(cw * ch * 4);
for (let i = 0; i < out.length; i += 4) { out[i] = 18; out[i+1] = 18; out[i+2] = 22; out[i+3] = 255; }

/* decodePng reads a PATH, and both tile builders hand back an encoded PNG in
 * memory, so the buffer goes through one reused scratch file rather than
 * teaching the decoder a second input shape it has no other use for. */
const TMP = path.join(__dirname, ".face-compare-tmp.png");
function blit(pngBuf, ox, oy) {
  fs.writeFileSync(TMP, pngBuf);
  const img = decodePng(TMP);
  if (!img) return;
  for (let y = 0; y < Math.min(H, img.h); y++) for (let x = 0; x < Math.min(W, img.w); x++) {
    const s = (y * img.w + x) * 4, d = ((oy + y) * cw + ox + x) * 4;
    const a = img.data[s + 3] / 255;
    out[d]     = Math.round(img.data[s]     * a + out[d]     * (1 - a));
    out[d + 1] = Math.round(img.data[s + 1] * a + out[d + 1] * (1 - a));
    out[d + 2] = Math.round(img.data[s + 2] * a + out[d + 2] * (1 - a));
  }
  const mid = oy + Math.round(H * 0.5);
  for (let x = 0; x < W; x++) {
    const d = (mid * cw + ox + x) * 4;
    out[d] = 255; out[d + 1] = 60; out[d + 2] = 60;
  }
}

/* THE DIAGNOSTIC ROW.
 *
 * When a crop comes out wrong there are two different questions - was the head
 * found in the wrong place, or found correctly and placed badly - and they
 * need different fixes. The first attempt at this shipped a crop that zoomed
 * into foreheads, and telling those two apart cost a whole round trip. So the
 * third row is the source itself, letterboxed to the tile, with green lines
 * where the code believes the crown and the neck are and a blue line down the
 * head's centre. If those lines are wrong, detection is wrong. If they are
 * right and the tile above still looks bad, the constants are wrong. */
function blitSourceWithHead(p, ox, oy) {
  const img = decodePng(p.src);
  if (!img) return;
  const s = Math.min(W / img.w, H / img.h);
  const dw = Math.max(1, Math.round(img.w * s)), dh = Math.max(1, Math.round(img.h * s));
  const small = resize(img, dw, dh);
  const px = Math.round((W - dw) / 2), py = Math.round((H - dh) / 2);
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const si = (y * dw + x) * 4, d = ((oy + py + y) * cw + ox + px + x) * 4;
    const a = small.data[si + 3] / 255;
    out[d]     = Math.round(small.data[si]     * a + out[d]     * (1 - a));
    out[d + 1] = Math.round(small.data[si + 1] * a + out[d + 1] * (1 - a));
    out[d + 2] = Math.round(small.data[si + 2] * a + out[d + 2] * (1 - a));
  }
  const line = (yFrac, r, g, b) => {
    const yy = oy + py + Math.round(yFrac * dh);
    if (yy < oy || yy >= oy + H) return;
    for (let x = 0; x < dw; x++) {
      const d = (yy * cw + ox + px + x) * 4;
      out[d] = r; out[d + 1] = g; out[d + 2] = b;
    }
  };
  if (p.head) {
    line(p.head.top, 60, 230, 90);
    line(p.head.neck, 60, 230, 90);
    const xx = ox + px + Math.round(p.head.cx * dw);
    for (let y = 0; y < dh; y++) {
      const d = ((oy + py + y) * cw + xx) * 4;
      out[d] = 80; out[d + 1] = 160; out[d + 2] = 255;
    }
  }
}

picks.forEach((p, i) => {
  const ox = PAD + (i % COLS) * (W + PAD);
  const oy = PAD + Math.floor(i / COLS) * cellH;
  blit(p.before, ox, oy);
  blit(p.after, ox, oy + H + PAD);
  blitSourceWithHead(p, ox, oy + (H + PAD) * 2);
});

try { fs.unlinkSync(TMP); } catch (e) { /* already gone */ }
fs.writeFileSync(OUT, encodePng({ w: cw, h: ch, data: out }));
console.log(`\n${picks.length} of the ${WANT} most out-of-set tiles had an alpha source.`);
console.log("  row 1 of each group: the crop as it ships now");
console.log("  row 2:               cropped around the head");
console.log("  row 3:               the source, with the detected crown, neck and centre");
const shoulderless = picks.filter(p => p.head && !p.head.hasShoulders).length;
if (shoulderless) console.log(`  ${shoulderless} source(s) read as head-only, with no shoulder line to find.`);
console.log(`\nwrote ${OUT}`);
console.log("Look at it before anything is changed. If the bottom rows are not");
console.log("plainly better, the constants are wrong or the approach is.");
