/* Build a trivia pool from the HoopsHype rumors archive's Frivolities tag.
 *
 *     node tools/build_frivolities.mjs --local <hoopshype-rumors> [options]
 *
 * WHY THIS IS A LOCAL BUILDER AND NOT SOMETHING I RAN
 *
 * The standing rule for this project is that the archive's contents are never
 * read, parsed or included in any output produced away from Jorge's machine.
 * This file was written without a single archive record being read: the schema
 * came from update_rumors.py in the archive repo, which declares the fields it
 * writes. That is the same arrangement build_lean.mjs and build_compare.mjs
 * already use for their private sources.
 *
 * The consequence worth being honest about: the pool this writes CONTAINS
 * ARCHIVE EXCERPTS. Whether that file belongs in a public repo is an editorial
 * and rights decision, and it is not one a build script gets to make. So the
 * default is --dry-run, which reports what it would build and writes nothing,
 * and shipping requires saying --write out loud.
 *
 * WHY THE QUESTIONS ARE MECHANICAL
 *
 * Every question here is derived from the structure of a record, never from an
 * interpretation of what it says. A question of the form "which of these
 * stories really happened?" needs somebody to invent the three that did not,
 * which is fabrication, and fabricated NBA anecdotes sitting beside real
 * HoopsHype reporting is exactly the failure the rumors tab already refuses to
 * risk. So the four families below all work by hiding something the record
 * already contains and asking the reader to name it:
 *
 *   who-is-this   the subject's name is blanked out of their own story
 *   which-team    the team is blanked out
 *   which-outlet  who reported it
 *   what-year     when it happened
 *
 * Each answer is verifiable against the source, which is linked on reveal.
 * Nothing is invented; the only editorial act is choosing what to hide.
 *
 * OPTIONS
 *   --local <dir>       the hoopshype-rumors checkout (required)
 *   --write             actually write the pool. Without it, nothing is written
 *   --out <file>        default data/frivolities-pool.json
 *   --limit <n>         cap the number of cards (default 400)
 *   --excerpt <n>       max characters of archive text per card (default 240)
 *   --sample            print three finished cards so the wording can be judged
 *                       before anything ships. Off by default so a routine run
 *                       prints statistics and no archive content at all.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}
const has = name => argv.includes("--" + name);

const SRC = arg("local", "");
const WRITE = has("write");
const SHOW_SAMPLE = has("sample");
const OUT = path.join(REPO, arg("out", "data/frivolities-pool.json"));
const LIMIT = parseInt(arg("limit", "400"), 10);
const EXCERPT = parseInt(arg("excerpt", "240"), 10);

if (!SRC) {
  console.error("usage: node tools/build_frivolities.mjs --local <hoopshype-rumors> [--write]");
  console.error("       without --write nothing is written; it reports what it would build.");
  process.exit(1);
}

/* ---------------- thresholds ----------------
 * Every one of these exists to stop a question that cannot be answered fairly
 * from reaching the feed. They are deliberately strict: a thin pool of good
 * questions beats a large pool with guesswork in it. */

const TAG = "frivolities";
const MIN_TEXT = 120;          // shorter than this and a redacted item says nothing
const MAX_TEXT = 900;          // longer than this and the card is a wall
const OPTIONS = 4;
const MIN_ERA_POOL = 12;       // distractors needed in an era before it can be used
const MIN_SUBJECT_ITEMS = 1;
const MAX_PER_SUBJECT = 6;     // no player dominates the pool
const MAX_PER_FAMILY = 0.45;   // no family may exceed this share of the pool

/* ---------------- load ---------------- */

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function loadParts(dir) {
  const out = [];
  const seen = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!/^hoopshype_rumors_part\d+\.json$/.test(f)) continue;
    let rows;
    try { rows = readJson(path.join(dir, f)); } catch (e) {
      console.error(`  could not read ${f}: ${e.message}`);
      continue;
    }
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      // source_url is the only stable identity a record has
      const key = r && r.source_url ? r.source_url : null;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

/* ---------------- the editorial filter, as the app applies it ----------------
 * Same blocklist file and the same matching rule as js/rumors.js, so a term
 * blocked in the Rumors tab cannot arrive through a quiz card instead. */

const bl = readJson(path.join(REPO, "data", "rumor-blocklist.json"));
const BL_TERMS = (bl.blocked_keywords || []).map(t => String(t).toLowerCase());
const BL_WHOLE = new Set((bl.whole_word_only || []).map(t => String(t).toLowerCase()));

function blocked(entry) {
  let hay = [entry.text, entry.quote, entry.outlet].filter(Boolean).join(" ");
  if (Array.isArray(entry.tags)) hay += " " + entry.tags.join(" ");
  hay = hay.toLowerCase();
  const padded = " " + hay.replace(/[^a-z0-9]+/g, " ") + " ";
  for (const t of BL_TERMS) {
    if (BL_WHOLE.has(t)) { if (padded.includes(" " + t + " ")) return true; }
    else if (hay.includes(t)) return true;
  }
  return false;
}

/* ---------------- entities ----------------
 * Player and team names come from data/buzz-map.json, which is built from the
 * public player data and already ships in this repo. No new dependency, and
 * the quiz can only ever name a player the rest of the feed also knows. */

const map = readJson(path.join(REPO, "data", "buzz-map.json"));
const PLAYERS = Object.values(map.players || {});
const TEAMS = Object.keys(map.teams || {}).map(slug =>
  slug.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" "));

const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
const norm = s => fold(s).toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();

/* A surname has to appear as a whole word. "James" inside "Jamestown" is not a
 * LeBron James mention, and a quiz that redacts the wrong span produces a
 * question with no answer in it. */
function surnameOf(name) {
  const parts = norm(name).split(" ").filter(w => w && !/^(jr|sr|ii|iii|iv|v)$/.test(w));
  return parts[parts.length - 1] || "";
}
function mentions(hay, term) {
  if (!term) return false;
  return new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i").test(hay);
}

const PLAYER_INDEX = PLAYERS.map(n => ({ name: n, surname: surnameOf(n) }))
  .filter(p => p.surname.length >= 4);          // "Ball", "Bol" collide too easily

/* ---------------- helpers ---------------- */

function yearOf(rec) {
  const d = String(rec.archive_date || rec.date || "");
  const m = d.match(/(19|20)\d{2}/);
  return m ? parseInt(m[0], 10) : null;
}
const eraOf = y => (y ? (y - (y % 5)) + "" : "unknown");   // 5-year buckets

function clip(text, n) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (stop > n * 0.5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, "")) + "…";
}

function redact(text, term) {
  if (!term) return text;
  return text.replace(new RegExp("\\b" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi"), "█████");
}

/* Deterministic shuffle so two runs of the same archive produce the same pool
 * and the diff is meaningful. */
function rng(seed) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
}
function shuffle(list, seed) {
  const r = rng(seed), a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ---------------- gather ---------------- */

console.log(`reading ${SRC}`);
const all = loadParts(SRC);
if (!all.length) {
  console.error("no hoopshype_rumors_part*.json files found under --local");
  process.exit(1);
}

const stats = { total: all.length, tagged: 0, blocked: 0, tooShort: 0, tooLong: 0, noSubject: 0, noSource: 0 };

const items = [];
for (const r of all) {
  const tags = Array.isArray(r.tags) ? r.tags.map(t => String(t).toLowerCase()) : [];
  if (!tags.includes(TAG)) continue;
  stats.tagged++;
  if (!r.source_url) { stats.noSource++; continue; }
  if (blocked(r)) { stats.blocked++; continue; }

  const text = String(r.text || r.quote || "").replace(/\s+/g, " ").trim();
  if (text.length < MIN_TEXT) { stats.tooShort++; continue; }
  if (text.length > MAX_TEXT) { stats.tooLong++; continue; }

  // Which players does this item actually name? Whole-word surname match only.
  const named = PLAYER_INDEX.filter(p => mentions(text, p.surname));
  if (!named.length) { stats.noSubject++; continue; }

  const teams = TEAMS.filter(t => {
    const last = t.split(" ").pop();
    return last.length >= 5 && mentions(text, last);
  });

  items.push({
    rec: r,
    text,
    year: yearOf(r),
    era: eraOf(yearOf(r)),
    named,
    teams,
    outlet: String(r.outlet || "").trim()
  });
}

console.log(`  ${stats.total} records, ${stats.tagged} tagged ${TAG}`);
console.log(`  dropped: ${stats.blocked} blocked, ${stats.tooShort} too short, ` +
  `${stats.tooLong} too long, ${stats.noSubject} nobody named, ${stats.noSource} no source url`);
console.log(`  usable: ${items.length}`);

/* Era pools for distractors: a 2011 story should offer 2011 names. */
const byEra = new Map();
for (const it of items) {
  for (const p of it.named) {
    if (!byEra.has(it.era)) byEra.set(it.era, new Set());
    byEra.get(it.era).add(p.name);
  }
}
const outlets = [...new Set(items.map(i => i.outlet).filter(Boolean))];

/* ---------------- question families ---------------- */

function distractors(pool, answer, n, seed) {
  const opts = shuffle(pool.filter(x => x && x !== answer), seed).slice(0, n);
  return opts.length === n ? opts : null;
}

/* Every family returns null rather than a weak question. That is the whole
 * discipline here: the pool is allowed to be small. */
const FAMILIES = {
  /* The subject's own name, blanked out of their own story. */
  "who-is-this": (it) => {
    if (it.named.length !== 1) return null;      // two names is two possible answers
    const subject = it.named[0];
    /* Distractors come from the same era, but never from the same family name.
     *
     * The subject's surname is blanked out of the excerpt, so an option that
     * shares it fits the redacted text exactly as well as the answer does:
     * offer "Seth Curry" against a blanked Curry story and there are two
     * defensible answers, which makes it a bad question rather than a hard one.
     * Also drop anyone whose surname is still sitting in the excerpt, which
     * would hand the reader an elimination for free. */
    const body0 = clip(it.text, EXCERPT).toLowerCase();
    const eraPool = [...(byEra.get(it.era) || [])].filter(n => {
      const sn = surnameOf(n);
      if (!sn || sn === subject.surname) return false;
      return !mentions(body0, sn);
    });
    if (eraPool.length < MIN_ERA_POOL) return null;
    const wrong = distractors(eraPool, subject.name, OPTIONS - 1, it.rec.source_url + "w");
    if (!wrong) return null;
    let body = clip(it.text, EXCERPT);
    body = redact(body, subject.surname);
    // the first name can give it away just as completely
    const first = norm(subject.name).split(" ")[0];
    if (first && first.length >= 4) body = redact(body, first);
    return {
      family: "who-is-this",
      question: "Which player is this about?",
      body,
      answer: subject.name,
      options: [subject.name, ...wrong],
      subject: subject.name,
      teams: it.teams
    };
  },

  /* Same trick on the team. */
  "which-team": (it) => {
    if (it.teams.length !== 1) return null;
    const team = it.teams[0];
    const wrong = distractors(TEAMS, team, OPTIONS - 1, it.rec.source_url + "t");
    if (!wrong) return null;
    let body = clip(it.text, EXCERPT);
    for (const w of team.split(" ")) if (w.length >= 5) body = redact(body, w);
    return {
      family: "which-team",
      question: "Which team was this?",
      body,
      answer: team,
      options: [team, ...wrong],
      subject: it.named[0] ? it.named[0].name : "",
      teams: [team]
    };
  },

  /* Who reported it. Only when the outlet is not written into the text, which
   * would hand the answer over. */
  "which-outlet": (it) => {
    if (!it.outlet || outlets.length < OPTIONS + 4) return null;
    const key = it.outlet.split(/\s+/)[0];
    if (key.length >= 4 && mentions(it.text, key)) return null;
    const wrong = distractors(outlets, it.outlet, OPTIONS - 1, it.rec.source_url + "o");
    if (!wrong) return null;
    return {
      family: "which-outlet",
      question: "Which outlet reported this?",
      body: clip(it.text, EXCERPT),
      answer: it.outlet,
      options: [it.outlet, ...wrong],
      subject: it.named[0] ? it.named[0].name : "",
      teams: it.teams
    };
  },

  /* When. Distractors are near years, so it is a real judgement about the era
   * rather than a choice between 2013 and 1974. */
  "what-year": (it) => {
    if (!it.year) return null;
    const near = [];
    for (let d = -4; d <= 4; d++) if (d !== 0) near.push(String(it.year + d));
    const wrong = distractors(near, String(it.year), OPTIONS - 1, it.rec.source_url + "y");
    if (!wrong) return null;
    let body = clip(it.text, EXCERPT);
    // a year written into the text answers the question for the reader
    if (/\b(19|20)\d{2}\b/.test(body)) return null;
    return {
      family: "what-year",
      question: "What year was this?",
      body,
      answer: String(it.year),
      options: [String(it.year), ...wrong],
      subject: it.named[0] ? it.named[0].name : "",
      teams: it.teams
    };
  }
};

/* ---------------- build ---------------- */

const FAMILY_ORDER = ["who-is-this", "which-team", "which-outlet", "what-year"];
const perSubject = new Map();
const usedSource = new Set();
const cards = [];
const rejected = { noFamily: 0, answerLeak: 0, dupe: 0, subjectCap: 0, familyCap: 0 };
const familyCount = new Map();

for (const it of shuffle(items, "frivolities-v1")) {
  if (cards.length >= LIMIT) break;
  if (usedSource.has(it.rec.source_url)) { rejected.dupe++; continue; }

  /* Which family to try first is rotated per item rather than fixed.
   *
   * A fixed order meant the first family that could build anything always won,
   * and since nearly every usable item names exactly one player, "who is this
   * about?" took 71% of the pool on the first run. Rotating by a hash of the
   * source URL keeps the choice deterministic - the same archive builds the
   * same pool - while spreading the formats.
   *
   * The cap is measured against the pool actually built, not against LIMIT: a
   * ceiling of 45% of 400 never binds on a pool of 55, which is exactly when
   * the monotony is most obvious. */
  const rot = Math.floor(rng(it.rec.source_url + "fam")() * FAMILY_ORDER.length);
  const order = FAMILY_ORDER.slice(rot).concat(FAMILY_ORDER.slice(0, rot));
  let q = null;
  for (const fam of order) {
    if (cards.length >= 20 &&
        (familyCount.get(fam) || 0) / cards.length >= MAX_PER_FAMILY) continue;
    const built = FAMILIES[fam](it);
    if (built) { q = built; break; }
  }
  if (!q) { rejected.noFamily++; continue; }

  /* The last and most important guard: after redaction, no option may still be
   * findable in the text. A question whose answer is printed inside it is not
   * a question, and this catches the cases the redaction missed - a nickname,
   * a possessive, a second spelling. */
  const hay = q.body.toLowerCase();
  if (q.options.some(o => {
    const last = norm(o).split(" ").pop();
    return last.length >= 4 && mentions(hay, last);
  })) { rejected.answerLeak++; continue; }

  if (q.subject) {
    const n = perSubject.get(q.subject) || 0;
    if (n >= MAX_PER_SUBJECT) { rejected.subjectCap++; continue; }
    perSubject.set(q.subject, n + 1);
  }

  usedSource.add(it.rec.source_url);
  familyCount.set(q.family, (familyCount.get(q.family) || 0) + 1);

  /* Quality: length of the evidence, how unusual the subject is in this pool,
   * and whether the item carries a direct quote. Used as a feed weighting
   * signal, not as a filter - everything here already passed the filters. */
  const rarity = 1 - Math.min(1, (perSubject.get(q.subject) || 1) / MAX_PER_SUBJECT);
  const meat = Math.min(1, q.body.length / EXCERPT);
  const quality = Math.round((0.45 * meat + 0.35 * rarity + (it.rec.quote ? 0.2 : 0)) * 100) / 100;

  const year = it.year || 0;
  cards.push({
    id: "friv-" + Buffer.from(it.rec.source_url).toString("base64url").slice(-16),
    type: "friv",                         // its own chip, the ballot card's renderer
    tab: ["quiz"],
    tags: {
      content_type: "trivia",
      players: q.subject ? [q.subject] : [],
      teams: (q.teams || []).slice(0, 3),
      era: year ? (year - (year % 10)) + "s" : "2020s",
      category: "frivolities"
    },
    quality_score: quality,
    story_family: "frivolities:" + q.family,
    story_key: "frivolities|" + q.family + "|" + (q.subject || "-") + "|" + (year || "-"),
    payload: {
      /* The card prints this above the question as context. For every family
       * but one that is useful; for "what year was this?" it is the answer,
       * printed two lines above the options. Caught by rendering the card and
       * looking at it, which is why the verification below now checks the
       * header as well as the body. */
      season: (q.family === "what-year") ? "" : (year ? String(year) : ""),
      question: q.question,
      body: q.body,
      options: shuffle(q.options, it.rec.source_url).map(String),
      answer_idx: 0,                       // fixed below, after the shuffle
      source_url: it.rec.source_url,
      source_outlet: it.outlet || "",
      source_date: it.rec.date || it.rec.archive_date || "",
      // shown only after answering
      detail: q.family === "which-outlet"
        ? "Reported by " + (it.outlet || "the outlet named") + "."
        : ""
    }
  });
  const c = cards[cards.length - 1];
  c.payload.answer_idx = c.payload.options.indexOf(q.answer);
  if (c.payload.answer_idx < 0) { cards.pop(); rejected.answerLeak++; }
}

/* ---------------- verify ---------------- */

let bad = 0;
for (const c of cards) {
  const p = c.payload;
  if (p.answer_idx < 0 || p.answer_idx >= p.options.length) { console.error(`  ${c.id}: answer_idx out of range`); bad++; }
  if (new Set(p.options).size !== p.options.length) { console.error(`  ${c.id}: duplicate options`); bad++; }
  if (!p.source_url) { console.error(`  ${c.id}: no source url`); bad++; }
  const answer = p.options[p.answer_idx] || "";
  const last = norm(answer).split(" ").pop();
  if (last.length >= 4 && mentions(p.body.toLowerCase(), last)) {
    console.error(`  ${c.id}: the answer is still visible in the body`); bad++;
  }
  /* Everything the reader can see before answering, not just the excerpt.
   * source_date is deliberately absent: the card renders it beside the source
   * link, which is hidden until the question has been answered. If that ever
   * changes, this list has to change with it. */
  const visible = [p.season, p.question].filter(Boolean).join(" ").toLowerCase();
  if (answer && visible.includes(String(answer).toLowerCase())) {
    console.error(`  ${c.id}: the answer "${answer}" is printed in the card header`); bad++;
  }
}
if (bad) {
  console.error(`FAILED: ${bad} cards are unanswerable or give themselves away`);
  process.exit(1);
}

/* ---------------- report ---------------- */

console.log(`\nbuilt ${cards.length} cards`);
const famRows = [...familyCount.entries()].sort((a, b) => b[1] - a[1]);
for (const [f, n] of famRows) console.log(`  ${f.padEnd(14)} ${n}  (${Math.round(n / cards.length * 100)}%)`);
console.log(`  rejected: ${rejected.noFamily} no family fit, ${rejected.answerLeak} answer visible, ` +
  `${rejected.dupe} duplicate source, ${rejected.subjectCap} subject at cap`);
console.log(`  distinct subjects: ${perSubject.size}`);
const q = cards.map(c => c.quality_score).sort((a, b) => a - b);
if (q.length) console.log(`  quality: min ${q[0]}  median ${q[Math.floor(q.length / 2)]}  max ${q[q.length - 1]}`);

if (SHOW_SAMPLE) {
  console.log("\n--- sample cards (archive content follows) ---");
  for (const c of cards.slice(0, 3)) {
    console.log(`\n[${c.story_family}] ${c.payload.question}`);
    console.log(`  ${c.payload.body}`);
    c.payload.options.forEach((o, i) => console.log(`    ${i === c.payload.answer_idx ? "*" : " "} ${o}`));
    console.log(`  source: ${c.payload.source_url}`);
  }
}

if (!WRITE) {
  console.log(`\nNOTHING WRITTEN. This is a dry run.`);
  console.log(`The pool would contain archive excerpts, which is an editorial and`);
  console.log(`rights decision rather than a build decision. Add --write when you`);
  console.log(`have decided that excerpt length and attribution are publishable,`);
  console.log(`and --sample to read a few before you do.`);
  process.exit(0);
}

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  source: "hoopshype-rumors, Frivolities tag",
  note: "Every card is grounded in one archive item and links to it. No question " +
        "text is invented: each hides something the record already contains.",
  cards
}));
console.log(`\nwrote ${path.relative(REPO, OUT)} (${cards.length} cards, ` +
  `${Math.round(fs.statSync(OUT).size / 1024)}KB)`);
console.log(`Add it to TAB_POOLS in js/app.js to put it in the feed.`);
