/* Build a single self-contained HTML preview of the app.
 *
 *     node tools/build_preview.mjs [--out preview.html] [--cards 6]
 *
 * WHY
 *
 * Patches get applied to a live site. Looking at the thing first is cheaper
 * than reverting it, and stills cannot show whether a race is paced right or
 * whether two animations fight each other - which are exactly the changes that
 * need judging.
 *
 * HOW
 *
 * Everything the app fetches is embedded and `fetch` is replaced before any
 * app script runs, so the page is one file with no network at all. Pools are
 * trimmed to a sample per type, the per-card detail files those samples point
 * at are inlined, and the headshots they use become data URIs.
 *
 * WHAT IS DELIBERATELY MISSING
 *
 * Rumors, Buzz and the live trade log are not stubbed. Inventing NBA content
 * for a preview risks it being read as real, and the honest failure states are
 * themselves worth seeing - the trade tab falls back to sample cards, which is
 * the path that now has to say "not a real user build".
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const outArg = arg("out", "preview.html");
const OUT = path.isAbsolute(outArg) ? outArg : path.join(REPO, outArg);
const PER_TYPE = parseInt(arg("cards", "6"), 10);

const read = p => fs.readFileSync(path.join(REPO, p), "utf8");
const exists = p => fs.existsSync(path.join(REPO, p));

/* ---------------- pick a sample ---------------- */

const files = {};                       // virtual path -> string contents
const faces = new Set();

function addJson(p, obj) { files[p] = JSON.stringify(obj); }

/* Deterministic pick so two builds of the same repo produce the same preview
 * and "it looked fine yesterday" means something. */
function sample(list, n, seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0;
    const j = h % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

function collectFaces(o) {
  if (!o) return;
  if (typeof o === "string") { if (/^data\/(faces|races\/faces|races\/logos)\//.test(o)) faces.add(o); return; }
  if (Array.isArray(o)) { o.forEach(collectFaces); return; }
  if (typeof o === "object") Object.values(o).forEach(collectFaces);
}

const POOLS = [
  "data/quiz-pool.json", "data/trivia-pool.json", "data/ballot-pool.json",
  "data/vault-pool.json", "data/vs-pool.json", "data/race-pool.json",
  "data/ballotrace-pool.json", "data/teammates-pool.json",
  "data/compare-pool.json", "data/lean-pool.json", "data/dummy-cards.json",
  /* Optional pools, built by the local-source builders. Absent is normal and
   * the loop above skips them with a note rather than failing. */
  "data/oddity-pool.json", "data/salary-pool.json", "data/frivolities-pool.json"
];

let detailCount = 0;
for (const p of POOLS) {
  if (!exists(p)) { console.log(`  skip ${p} (absent)`); continue; }
  const pool = JSON.parse(read(p));
  const cards = pool.cards || [];
  // dummy cards are the trade fallback; keep them all, there are only a few
  const keep = p.includes("dummy") ? cards : sample(cards, PER_TYPE, p);
  addJson(p, { ...pool, cards: keep });
  collectFaces(keep);
  for (const c of keep) {
    const f = c.payload && c.payload.file;
    if (f && exists(f)) {
      files[f] = read(f);
      collectFaces(JSON.parse(files[f]));
      detailCount++;
    }
  }
  console.log(`  ${p}: ${keep.length} of ${cards.length} cards`);
}

// small config files the app reads directly
for (const p of ["data/buzz-map.json", "data/rumor-blocklist.json", "data/buzz-sources.json"]) {
  if (exists(p)) files[p] = read(p);
}

/* ---------------- images ---------------- */

let imgBytes = 0, imgCount = 0;
const images = {};
for (const rel of faces) {
  const abs = path.join(REPO, rel);
  if (!fs.existsSync(abs)) continue;
  const buf = fs.readFileSync(abs);
  imgBytes += buf.length; imgCount++;
  const ext = path.extname(rel).slice(1).toLowerCase();
  const mime = ext === "svg" ? "image/svg+xml" : "image/" + (ext === "jpg" ? "jpeg" : ext);
  images[rel] = "data:" + mime + ";base64," + buf.toString("base64");
}
console.log(`  ${imgCount} images inlined (${Math.round(imgBytes / 1024)}KB raw)`);

/* ---------------- assemble ---------------- */

const JS_ORDER = [
  "js/pacing.js", "js/media.js", "js/engine.js", "js/cards.js", "js/vs-score.js",
  "js/race-player.js", "js/mates-player.js", "js/compare-player.js", "js/lean-player.js",
  "js/share-image.js", "js/live-vs.js", "js/rumors.js", "js/buzz.js",
  "js/bsky-video.js", "js/trades.js", "js/app.js"
];

const html = read("index.html");
// take the body markup as it stands, minus the script tags we inline ourselves
const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
let body = bodyMatch ? bodyMatch[1] : html;
body = body.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/gi, "");

const shim = `
/* Offline shim. Installed before any app script so every fetch the app makes
 * is answered from the embedded map. Anything not embedded - the rumors API,
 * the Content Stream, the trade log - fails the way it would with no network,
 * which is a state worth seeing rather than hiding. */
(function () {
  var FILES = __FILES__;
  var IMAGES = __IMAGES__;
  /* Keys are repo-relative ("data/quiz-pool.json"). Resolving against
   * location.href gave "/home/.../out/data/quiz-pool.json" under file:// and a
   * gallery path when hosted, neither of which matched. Anchoring on the last
   * "data/" makes the lookup work from any origin, which is the point of a
   * single file that has to run wherever it is opened. */
  function norm(u) {
    u = String(u).split("?")[0].split("#")[0];
    var i = u.lastIndexOf("data/");
    if (i >= 0) return u.slice(i);
    try { u = new URL(u, location.href).pathname; } catch (e) {}
    return u.replace(/^.*\\//, "");
  }
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (input, init) {
    var url = typeof input === "string" ? input : (input && input.url) || "";
    var key = norm(url);
    if (Object.prototype.hasOwnProperty.call(FILES, key)) {
      return Promise.resolve(new Response(FILES[key], {
        status: 200, headers: { "Content-Type": "application/json" }
      }));
    }
    /* Anything genuinely remote fails like a dead network, which is the state
     * the Rumors and Buzz tabs are built to explain. Anything local but not
     * embedded 404s, which is how an optional pool reports absence. */
    if (/^(https?:)?\\/\\//.test(url)) {
      return Promise.reject(new TypeError("preview: offline (" + url + ")"));
    }
    return Promise.resolve(new Response("", { status: 404 }));
  };
  /* Images are referenced by relative path in the markup the cards build, so
   * they are swapped as they are inserted rather than rewritten in the data. */
  function swap(el) {
    var imgs = el.querySelectorAll ? el.querySelectorAll("img[src]") : [];
    for (var i = 0; i < imgs.length; i++) {
      var s = imgs[i].getAttribute("src");
      var k = norm(s);
      if (IMAGES[k]) imgs[i].setAttribute("src", IMAGES[k]);
      else if (!/^data:/.test(s)) { imgs[i].removeAttribute("src"); imgs[i].style.visibility = "hidden"; }
    }
  }
  new MutationObserver(function (recs) {
    recs.forEach(function (r) {
      for (var i = 0; i < r.addedNodes.length; i++) {
        var n = r.addedNodes[i];
        if (n.nodeType === 1) swap(n);
      }
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  /* The canvas players load images through new Image(), not the DOM, so the
   * constructor is patched to resolve embedded paths too. */
  var NativeImage = window.Image;
  window.Image = function () {
    var img = new NativeImage();
    var setter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    Object.defineProperty(img, "src", {
      get: function () { return setter.get.call(img); },
      set: function (v) {
        var k = norm(v);
        setter.set.call(img, IMAGES[k] || v);
      }
    });
    return img;
  };
  window.Image.prototype = NativeImage.prototype;
})();
`;

let bundle = shim
  .replace("__FILES__", JSON.stringify(files))
  .replace("__IMAGES__", JSON.stringify(images));

for (const j of JS_ORDER) {
  if (!exists(j)) { console.log(`  skip ${j} (absent)`); continue; }
  bundle += "\n/* ===== " + j + " ===== */\n" + read(j) + "\n";
}

const banner = `
<div class="preview-banner">
  <b>Sandbox preview</b> — the app as it stands, running entirely inside this page.
  Rumors, Buzz and the live trade feed are offline here, so those tabs show their
  real failure states and Trades falls back to sample cards.
</div>`;

/* The stylesheet link lives in index.html's <head>, which the body-only
 * extraction above deliberately drops - so it is carried over explicitly.
 * Without it the whole page silently falls back to system faces and the
 * preview misrepresents the thing it exists to show. */
const fontLink = (html.match(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/i) || [""])[0];

const out = `<title>NBA Doomscroll Sandbox</title>
${fontLink}
<style>
${read("css/styles.css")}
.preview-banner{
  max-width:46rem; margin:0 auto .9rem; padding:.6rem .8rem;
  border:1px solid var(--border); border-left:3px solid var(--accent);
  border-radius:8px; background:var(--surface); font-size:.78rem;
  line-height:1.5; color:var(--text-secondary);
}
.preview-banner b{ color:var(--text) }
</style>
${banner}
${body}
<script>
${bundle}
</script>
`;

fs.writeFileSync(OUT, out);
console.log(`\nwrote ${path.relative(REPO, OUT)} — ${Math.round(fs.statSync(OUT).size / 1024)}KB, ` +
  `${Object.keys(files).length} data files, ${detailCount} card detail files, ${imgCount} images`);
