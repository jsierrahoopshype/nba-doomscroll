/* PROPOSED additive routes for the hoopshype-rumors-api Worker.
 * Not deployed. Nothing in that repo has been changed.
 *
 *   GET /api/rumors/on-this-day?limit=20   (today only; see the date window)
 *   GET /api/rumors/random?limit=25
 *
 * Both read one small precomputed object written daily to R2 by
 * build_otd_index.py. No scanning of the part files at request time — that is
 * the whole point of the offline index (a Worker has 128 MB of memory; parsing
 * a ~90K-entry part file would OOM).
 *
 * HOW TO ADD, in two places in your existing Worker:
 *
 * 1. Paste everything below the divider into the file.
 * 2. In fetch(), before your existing routing, add:
 *
 *      if (url.pathname === "/api/rumors/on-this-day") {
 *        return handleOnThisDay(request, env, url);
 *      }
 *      if (url.pathname === "/api/rumors/random") {
 *        return handleRandomRumors(request, env, url);
 *      }
 *
 * These handlers return fully-formed Responses with their own CORS headers, so
 * they do not depend on your existing withCors()/API-key middleware — which is
 * deliberate, since a browser cannot carry the X-API-Key.
 *
 * REQUIRES an R2 binding in wrangler.toml. If yours is named something other
 * than RUMORS_BUCKET, change the constant below.
 *
 *   [[r2_buckets]]
 *   binding = "RUMORS_BUCKET"
 *   bucket_name = "hoopshype-rumors"
 */

/* ------------------------------------------------------------------ */

const RUMORS_R2_BINDING = "RUMORS_BUCKET";

// Keyless but origin-locked: the Doomscroll page runs in readers' browsers and
// cannot hold a secret, so the origin check is friction, not a wall. The real
// protection is upstream — the R2 day files hold 280-char excerpts with a
// link back, never full archive records, and the date window below keeps the
// calendar from being walked. The key-gated /api/rumors/part/* endpoints are
// untouched and stay private.
const DOOMSCROLL_ORIGINS = [
  "https://hoopsmatic.com",
  "https://www.hoopsmatic.com",
  "https://jsierrahoopshype.github.io",
];

const OTD_MAX = 20;
const RANDOM_MAX = 25;
// A scraper's ceiling. The endpoint serves only dates within a day of today,
// so the calendar cannot be walked in one sitting — collecting the full set
// would take a year of daily requests, for excerpts that already link back.
const OTD_DAY_WINDOW = 1;
const EDGE_TTL = 21600; // 6h; the index only changes once a day

function doomCors(origin) {
  const allowed = DOOMSCROLL_ORIGINS.includes(origin) ? origin : DOOMSCROLL_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function doomJson(body, status, origin, cacheable) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    ...doomCors(origin),
  };
  // CORS headers go on error paths too: a 500 without them is invisible in the
  // browser and shows up only as a network-tab mystery.
  headers["Cache-Control"] = cacheable
    ? `public, max-age=600, s-maxage=${EDGE_TTL}`
    : "no-store";
  return new Response(JSON.stringify(body), { status, headers });
}

function doomOriginAllowed(request) {
  const origin = request.headers.get("Origin") || "";
  // Same-origin GETs and direct navigation send no Origin header; allow those
  // so the endpoint stays testable from a browser address bar.
  return !origin || DOOMSCROLL_ORIGINS.includes(origin);
}

function mmdd(d) {
  return String(d.getUTCMonth() + 1).padStart(2, "0") + "-" +
         String(d.getUTCDate()).padStart(2, "0");
}

/** Is MM-DD within OTD_DAY_WINDOW days of today (UTC)? The window exists so
 *  readers west of UTC still see "today", not so the calendar can be browsed. */
function withinDayWindow(md, today) {
  for (let off = -OTD_DAY_WINDOW; off <= OTD_DAY_WINDOW; off++) {
    const d = new Date(today.getTime() + off * 86400000);
    if (mmdd(d) === md) return true;
  }
  return false;
}

async function r2Json(env, key) {
  const bucket = env[RUMORS_R2_BINDING];
  if (!bucket) throw new Error(`R2 binding ${RUMORS_R2_BINDING} is not configured`);
  const obj = await bucket.get(key);
  if (!obj) return null;
  return obj.json();
}

function clampLimit(url, fallback, max) {
  const n = parseInt(url.searchParams.get("limit"), 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : fallback;
}

/** GET /api/rumors/on-this-day?md=MM-DD&limit=20 (md must be within a day of today) */
async function handleOnThisDay(request, env, url) {
  const origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: doomCors(origin) });
  }
  if (!doomOriginAllowed(request)) {
    return doomJson({ error: "origin not allowed" }, 403, origin, false);
  }

  const today = new Date();
  let md = url.searchParams.get("md") || "";
  if (!/^\d{2}-\d{2}$/.test(md) || !withinDayWindow(md, today)) {
    // Out-of-window dates silently fall back to today rather than erroring:
    // a reader whose clock straddles UTC midnight should still get a feed.
    md = mmdd(today);
  }
  const limit = clampLimit(url, OTD_MAX, OTD_MAX);

  // Cache API in front of R2: the index changes once a day, so a hit costs
  // nothing and a miss costs one small object read.
  const cacheKey = new Request(`https://otd.cache/${md}`, { method: "GET" });
  const cache = caches.default;
  let hit = await cache.match(cacheKey);
  let data;
  if (hit) {
    data = await hit.json();
  } else {
    try {
      data = await r2Json(env, `otd/${md}.json`);
    } catch (err) {
      return doomJson({ error: err.message }, 500, origin, false);
    }
    if (!data) {
      return doomJson({ date: md, count: 0, entries: [], note: "no index for that date" },
                      200, origin, true);
    }
    await cache.put(cacheKey, new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${EDGE_TTL}` },
    }));
  }

  const entries = (data.entries || []).slice(0, limit);
  return doomJson({ date: md, count: entries.length, entries }, 200, origin, true);
}

/** GET /api/rumors/random?limit=25 */
async function handleRandomRumors(request, env, url) {
  const origin = request.headers.get("Origin") || "";
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: doomCors(origin) });
  }
  if (!doomOriginAllowed(request)) {
    return doomJson({ error: "origin not allowed" }, 403, origin, false);
  }
  const limit = clampLimit(url, 25, RANDOM_MAX);

  const cacheKey = new Request("https://otd.cache/random-pool", { method: "GET" });
  const cache = caches.default;
  let hit = await cache.match(cacheKey);
  let data;
  if (hit) {
    data = await hit.json();
  } else {
    try {
      data = await r2Json(env, "random-pool.json");
    } catch (err) {
      return doomJson({ error: err.message }, 500, origin, false);
    }
    if (!data) return doomJson({ count: 0, entries: [] }, 200, origin, true);
    await cache.put(cacheKey, new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${EDGE_TTL}` },
    }));
  }

  // Sample without replacement from the cached pool. Cheap: the pool is ~800
  // excerpt-only entries, and the draw only touches `limit` of them.
  const pool = (data.entries || []).slice();
  const out = [];
  for (let i = 0; i < limit && pool.length; i++) {
    const j = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(j, 1)[0]);
  }
  // Randomised per request, so this response must not be cached downstream.
  return doomJson({ count: out.length, entries: out }, 200, origin, false);
}
