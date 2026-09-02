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
import { resolveSource, findFolders } from "./lib/find.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
}
const has = name => argv.includes("--" + name);

/* The archive folder is found rather than typed - run it with no arguments:
 *
 *     node tools/build_frivolities.mjs --sample
 *
 * --local still overrides when the search finds the wrong checkout. */
const SRC = resolveSource("the HoopsHype rumors archive", {
  explicit: arg("local", ""),
  markers: ["hoopshype_rumors_part1.json"]
});
const WRITE = has("write");
const SHOW_SAMPLE = has("sample");
const OUT = path.join(REPO, arg("out", "data/frivolities-pool.json"));
const LIMIT = parseInt(arg("limit", "400"), 10);
const EXCERPT = parseInt(arg("excerpt", "240"), 10);

if (!SRC) {
  console.error("       Pass --local <folder> if the archive is somewhere the search cannot reach.");
  console.error("       Without --write nothing is written; it reports what it would build.");
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
/* Accent-insensitive matching, on the ORIGINAL text.
 *
 * The archive writes "González" and the index holds "gonzalez", so a folded
 * comparison is the only way they meet. Folding the text before matching is
 * not enough on its own though - redaction has to blank a span of the text a
 * reader actually sees, and the leak guard has to search that same text. When
 * matching folded and redacting raw, an accented name matched, escaped the
 * blanking and escaped the guard: a card shipped naming "Eiza González" in
 * full while asking which player it was about.
 *
 * So each ASCII letter in a term is expanded to match its accented forms, and
 * one pattern serves matching, redaction and the leak check alike. The card
 * keeps the spelling the reporter used, which on a page about Dončić and
 * Jokić is not a small thing. */
const ACCENTS = {
  a: "aàáâãäåāă", c: "cçćčĉ", d: "dđď", e: "eèéêëēėę", g: "gğĝ", i: "iìíîïīį",
  l: "lł", n: "nñńň", o: "oòóôõöøō", r: "rř", s: "sśšş", t: "tťţ",
  u: "uùúûüūů", y: "yýÿ", z: "zźżž"
};
function accentPattern(term) {
  return String(term).split("").map(ch => {
    const set = ACCENTS[ch];
    if (set) return "[" + set + set.toUpperCase() + "]";
    return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
}
/* \\b is ASCII-only, so it fails immediately after an accented letter: the
 * pattern for "doncic" matched "Dončić" up to the final "ć" and then looked
 * for a word boundary that a non-ASCII letter does not provide. "Dončić"
 * therefore went unredacted. These boundaries count accented letters as
 * letters, which is the entire point. */
const NB = "[A-Za-zÀ-ÿ0-9]";
function bounded(term) {
  return "(?<!" + NB + ")" + accentPattern(term) + "(?!" + NB + ")";
}
function mentions(hay, term) {
  if (!term) return false;
  return new RegExp(bounded(term), "i").test(hay);
}

/* Surnames that are also ordinary words - especially in basketball prose,
 * which is full of them.
 *
 * A whole-word surname match is not evidence for any of these. "a paint-ball
 * outing", "green light", "young players", "rose to the occasion", "out west",
 * "day to day" all match a player's surname while saying nothing about him.
 *
 * This is not hypothetical. A Matt Bonner story containing "a paint-ball
 * outing" was tagged as being about LaMelo Ball, and the card went out as
 * "Which player is this about?" with Bonner's name sitting unredacted in the
 * excerpt and LaMelo Ball marked correct. The length filter that used to guard
 * this said "Ball, Bol collide too easily" and then tested `>= 4`, which lets
 * "ball" through - the comment named the exact case the code allowed.
 *
 * For a name on this list the FULL name has to appear in the text. */
const WORD_SURNAMES = new Set([
  "ball", "bird", "black", "best", "bell", "banks", "brown", "brooks",
  "cook", "cross", "day", "east", "fields", "ford", "gold", "green", "hill",
  "hood", "king", "lane", "land", "little", "long", "love", "may", "moon",
  "north", "price", "reed", "rice", "rivers", "rose", "sharp", "short",
  "small", "snow", "star", "strong", "swift", "wall", "waters", "wells",
  "west", "white", "wise", "wood", "young"
]);

const PLAYER_INDEX = PLAYERS.map(n => {
  const surname = surnameOf(n);
  return { name: n, surname, full: norm(n), strict: WORD_SURNAMES.has(surname) };
}).filter(p => p.surname.length >= 4);

/* True when the text actually names this player. A strict name needs all of
 * it; everyone else is found on the surname, as before. */
/* A surname carrying somebody else's first name in front of it belongs to
 * somebody else.
 *
 * "Eiza González and Ben Simmons enjoyed dinner" produced a card asking which
 * PLAYER it was about, answer Hugo Gonzalez - because an actress shares his
 * surname and the archive names far more people than the 607 players this
 * builder knows. The same rule separates Jeff Green from Draymond Green, and
 * Seth from Steph, which surname matching alone never could.
 *
 * A bare surname still counts: "Bonner, who was a 41.4 percent shooter" is how
 * reporters write, and requiring the full name everywhere would empty the
 * pool. What is rejected is the surname appearing ONLY ever after a different
 * capitalised first name - at that point the text is about someone else and
 * the match is a coincidence of spelling. */
function namesPlayer(hay, p) {
  if (p.strict) return mentions(hay, p.full);
  if (!mentions(hay, p.surname)) return false;
  const first = String(p.full).split(" ")[0];
  /* Every capitalised word sitting directly before the surname. Accents are
   * part of a name, so they count as name characters here. */
  const re = new RegExp("([A-Za-zÀ-ÿ'’.-]+)\\s+" + accentPattern(p.surname) + "(?!" + NB + ")", "g");
  let m, sawBare = false, sawHis = false, sawOther = false;
  while ((m = re.exec(hay))) {
    const before = m[1];
    // Lowercase before the surname means it is not part of a name: "with Green".
    if (!/^[A-ZÀ-Ý]/.test(before)) { sawBare = true; continue; }
    if (fold(before).toLowerCase().replace(/[^a-z]/g, "") === first) sawHis = true;
    else sawOther = true;
  }
  /* No preceding word at all - surname opens the excerpt, or follows
   * punctuation - is the commonest shape and stays valid. */
  if (!sawBare && !sawHis && !sawOther) return true;
  return sawHis || sawBare;
}

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
  return text.replace(new RegExp(bounded(term), "gi"), "█████");
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

  /* The archive's text comes out of HTML with paragraph boundaries lost, so
   * sentences run together: "in the ESPN booth.Awful Announcing". A space
   * after sentence punctuation is safe to restore.
   *
   * The other seam - a lowercase letter straight against a capital, as in
   * "for some odd reasonIn the 4th quarter" - is deliberately left alone.
   * NBA names are full of that shape (McGee, DeRozan, LaMelo, JaVale), and
   * breaking a player's name to tidy a sentence is the worse trade. */
  const text = String(r.text || r.quote || "")
    .replace(/\s+/g, " ")
    .replace(/([.!?])([A-Z])/g, "$1 $2")
    .trim();
  if (text.length < MIN_TEXT) { stats.tooShort++; continue; }
  if (text.length > MAX_TEXT) { stats.tooLong++; continue; }

  /* Which players does this item actually name?
   *
   * Matched against a NORMALISED copy of the text, not the raw one. Surnames
   * come out of norm() with their diacritics folded, so "Dončić" in the
   * archive never met "doncic" in the index and those players were invisible
   * to this builder - the same folding mistake that left six race tiles
   * unrebuilt, in a different file. */
  /* Matched against the ORIGINAL text, not a folded copy. Accents are handled
   * inside the pattern now, and capitalisation is the signal that separates
   * "Eiza González" from Hugo Gonzalez - folding first threw it away. */
  const named = PLAYER_INDEX.filter(p => namesPlayer(text, p));
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

/* ---------------- career teams (optional) ----------------
 *
 * A which-team card asks which team a player was with, and it was drawing its
 * three wrong answers from all thirty franchises. For a journeyman that
 * regularly offers a team he ALSO played for: a dry run asked which team
 * Kenyon Martin was with for the popcorn-prank story - the answer is Denver,
 * and New York was among the options. Martin played for both. The better a
 * reader knows his career the less answerable the question gets, which is the
 * exact inverse of what a quiz should do.
 *
 * The arithmetic: with three distractors drawn from twenty-nine teams, a
 * player with six franchises behind him has a 45% chance of being offered one
 * of his own. Across 144 which-team cards that is not an edge case.
 *
 * nba-player-data's rsStats.json is a team-season per row, which is a career
 * team list for free, and it is already on the machine for the salary
 * builder. OPTIONAL: absent, this does nothing and the cards are built exactly
 * as before, because a builder that refuses to run without a source it never
 * used to need is worse than one that is occasionally less strict. */
const CODE_TO_TEAM = new Map();
for (const [slug, code] of Object.entries(map.teams || {})) {
  CODE_TO_TEAM.set(code, slug.split("-").map(w => w[0].toUpperCase() + w.slice(1)).join(" "));
}
/* Relocations and renames, folded onto the current franchise. A Seattle season
 * is not an Oklahoma City season to a fan, but for the purpose of "do not
 * offer this man a team he has played for" the conservative reading is the
 * right one: it excludes more, and excluding too much only costs a card. */
const CODE_ALIAS = {
  NJN: "BKN", BRK: "BKN", NOH: "NOP", NOK: "NOP", NOJ: "UTA", SEA: "OKC",
  CHH: "CHA", CHO: "CHA", WSB: "WAS", PHO: "PHX", VAN: "MEM", KCK: "SAC",
  SDC: "LAC", BUF: "LAC", SFW: "GSW", NYN: "BKN", CIN: "SAC", STL: "ATL",
  BAL: "WAS", MNL: "LAL", PHW: "GSW", SYR: "PHI", ROC: "SAC", FTW: "DET",
  TRI: "ATL", CAP: "WAS", NOP: "NOP"
};

const careerTeams = new Map();       // normalised player name -> Set of team names
(function loadCareerTeams() {
  const hits = findFolders(["rsStats.json", "bio.json"]);
  if (!hits.length) {
    console.log("  career teams: nba-player-data not found, which-team distractors unfiltered");
    return;
  }
  let rows;
  try { rows = readJson(path.join(hits[0], "rsStats.json")); }
  catch (e) {
    console.log(`  career teams: could not read rsStats.json (${e.message})`);
    return;
  }
  if (!Array.isArray(rows)) return;
  for (const r of rows) {
    if (!r || !r.PLAYER || !r.TEAM) continue;
    const raw = String(r.TEAM).toUpperCase();
    const code = CODE_ALIAS[raw] || raw;
    const full = CODE_TO_TEAM.get(code);
    if (!full) continue;
    const key = norm(r.PLAYER);
    if (!careerTeams.has(key)) careerTeams.set(key, new Set());
    careerTeams.get(key).add(full);
  }
  console.log(`  career teams: ${careerTeams.size} players from ${path.basename(hits[0])}`);
})();

function distractors(pool, answer, n, seed) {
  const opts = shuffle(pool.filter(x => x && x !== answer), seed).slice(0, n);
  return opts.length === n ? opts : null;
}

/* Every family returns null rather than a weak question. That is the whole
 * discipline here: the pool is allowed to be small. */
/* Phrases that place a story in time for a reader who knows the league.
 *
 * Each of these is an event that happened once to a given player - a debut, a
 * retirement, a title, a trade - so combined with the name in the excerpt it
 * gives someone a way to reason toward a year. Deliberately excludes anything
 * relative to publication ("last year", "this season"), which pins nothing for
 * a reader who does not already know when the piece was written, and that is
 * the whole difficulty.
 *
 * Matched as plain substrings against the FULL record text, not the clipped
 * excerpt: an anchor a sentence past the cut still helps nobody, but requiring
 * it inside 240 characters thinned the family to almost nothing in testing.
 * If these cards still read as coin flips, tightening that to the excerpt is
 * the next lever. */
const TIME_ANCHORS = [
  "rookie", "drafted", "draft night", "nba draft", "debut", "first season",
  "first year in", "retired", "retirement", "retiring", "final season",
  "last dance", "farewell", "comeback", "unretire",
  "the finals", "championship", "won the title", "all-star game",
  "all-star weekend", "olympics", "world cup", "lockout", "the bubble",
  "hall of fame", "mvp season", "won mvp",
  "traded to", "signed with", "free agency", "waived", "released by"
];

/* "Twitter @GaryPayton_20", "Instagram", "@wojespn" - none of these is an
 * outlet that reported anything, and a handle generally belongs to the person
 * the story is about. */
const SOCIAL_OUTLET = /(^|\s)@|twitter|instagram|facebook|tiktok|threads|snapchat|youtube channel|podcast/i;

const skipped = { noAnchor: 0, thinTeamPool: 0, teamNotInExcerpt: 0, socialOutlet: 0 };

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
    /* The EXCERPT is the evidence, not the full record. A subject named only
     * in the part that gets clipped away leaves the reader a question with
     * nothing in it to reason from - and the redaction blanks nothing, which
     * is the visible symptom: no █████ anywhere on a card that is supposed to
     * be a name with a hole in it. */
    const excerptRaw = clip(it.text, EXCERPT);
    if (!namesPlayer(excerptRaw, subject)) return null;
    const eraPool = [...(byEra.get(it.era) || [])].filter(n => {
      const sn = surnameOf(n);
      if (!sn || sn === subject.surname) return false;
      /* Same word-surname rule as above, or every candidate called Green or
       * Young would be struck off any excerpt containing "green light" or
       * "young players" and the pool would thin for no reason. */
      return !namesPlayer(excerptRaw, { surname: sn, full: norm(n), strict: WORD_SURNAMES.has(sn) });
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
    /* Never offer a team the subject actually played for. See the career-team
     * index above: without this, a story about Kenyon Martin in Denver came
     * with New York on the ballot, and he played there too. Every player the
     * excerpt names contributes, because "was with the ..." need not be about
     * the first one listed. */
    let pool = TEAMS;
    if (careerTeams.size) {
      const own = new Set();
      for (const p of it.named) {
        const teams = careerTeams.get(norm(p.name));
        if (teams) for (const t of teams) own.add(t);
      }
      own.delete(team);                       // the answer is his, and stays
      if (own.size) pool = TEAMS.filter(t => !own.has(t));
    }
    if (pool.length < OPTIONS) { skipped.thinTeamPool++; return null; }
    const wrong = distractors(pool, team, OPTIONS - 1, it.rec.source_url + "t");
    if (!wrong) return null;
    /* The whole name first, then every word in it - including the short ones.
     *
     * This used to redact words of five characters or more, which left "the
     * Los █████ █████'" on a card whose only Los Angeles option was the
     * answer. Same shape as the "ball" bug: a length threshold standing in for
     * a judgement it cannot make. City prefixes are exactly the words that are
     * too short to pass and exactly the words that give a team away. */
    /* The team has to be IN the excerpt, not merely somewhere in the record.
     * 27 cards shipped asking "which team was this?" over text with no blank
     * anywhere in it, because the team was named past the 240-character cut.
     * Same oversight as the subject check in who-is-this, which got this right
     * a fix earlier and was not carried across. */
    let body = clip(it.text, EXCERPT);
    if (!mentions(body, team) && !team.split(" ").some(w => w.length >= 5 && mentions(body, w))) {
      skipped.teamNotInExcerpt++;
      return null;
    }
    body = redact(body, team);
    for (const w of team.split(" ")) if (w.length >= 3) body = redact(body, w);
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
    /* A social handle is not an outlet, and asking which one "reported" a
     * story is a category error dressed as a question. Worse, a handle is
     * usually the subject's own: the pool shipped "Twitter @GaryPayton_20" as
     * the correct answer to a story about Gary Payton, so the option named the
     * man the excerpt was about. Both the answer and the distractors are
     * filtered, since a handle is no better as a wrong answer. */
    if (SOCIAL_OUTLET.test(it.outlet)) { skipped.socialOutlet++; return null; }
    const key = it.outlet.split(/\s+/)[0];
    if (key.length >= 4 && mentions(it.text, key)) return null;
    const wrong = distractors(outlets.filter(o => !SOCIAL_OUTLET.test(o)),
      it.outlet, OPTIONS - 1, it.rec.source_url + "o");
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
    /* The excerpt has to give a reader something to date the story BY.
     *
     * "Before Dwyane Wade's last dance had ever begun" is a fair question:
     * Wade retired once, and anyone who follows the league can place it. "He
     * owned a Harley Davidson and showed off his closet for GQ" is a
     * one-in-four guess wearing a question mark, and that shape was 45% of the
     * pool.
     *
     * An explicit year cannot serve as the anchor - the guard below already
     * refuses any excerpt containing one, because a year in the text answers
     * the question outright. So what is left is career and league events,
     * which is the right axis anyway: each of these pins a moment for a reader
     * who knows the player, and knowing the player is the game. */
    if (!TIME_ANCHORS.some(a => it.text.toLowerCase().includes(a))) {
      skipped.noAnchor++;
      return null;
    }
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

  /* The last and most important guard: after redaction, nothing left in the
   * text may tell the options apart.
   *
   * It used to test the LAST word of each option at four characters or more,
   * which is why "the Los █████ █████'" shipped from a dry run: "Lakers" was
   * redacted, the guard looked only at "Lakers", and "Los" - the one word on
   * the card that named the answer - was both too short to check and too short
   * to have been redacted.
   *
   * So the test is now about what a token DOES rather than where it sits. A
   * token is discriminating when it appears in some options and not all: "los"
   * belongs to one option of four, so seeing it is seeing the answer, while
   * "matt" across two Matts tells a reader nothing. Any discriminating token
   * still visible rejects the card.
   *
   * Deliberately strict. It will throw away cards whose body happens to
   * contain "love" or "ball" against an option named Love or Ball, and that is
   * the correct outcome: for the reader those cards are ambiguous, which is
   * indistinguishable from unfair. */
  /* Both sides tokenised the SAME way. The guard used to normalise the option
   * (dropping punctuation, so "Twitter @GaryPayton_20" became the single token
   * "garypayton20") and then search the RAW body, where the text says
   * "@GaryPayton_20" - so they never met and the answer sat in plain view.
   * Splitting punctuation to spaces on both sides makes them comparable, and
   * keeps "paint-ball" as two words so "ball" is still caught. */
  const words = t => fold(String(t || "")).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const hayWords = new Set(words(q.body));
  const tokenSets = q.options.map(o => new Set(words(o).filter(w => w.length >= 3)));
  const discriminating = new Set();
  for (const set of tokenSets) {
    for (const t of set) {
      if (!tokenSets.every(other => other.has(t))) discriminating.add(t);
    }
  }
  let leaked = false;
  for (const t of discriminating) {
    if (hayWords.has(t)) { leaked = true; break; }
  }
  if (leaked) { rejected.answerLeak++; continue; }

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
console.log(`  what-year skipped for want of a datable anchor: ${skipped.noAnchor}`);
if (skipped.thinTeamPool) console.log(`  which-team skipped for too few teams left after excluding his own: ${skipped.thinTeamPool}`);
if (skipped.teamNotInExcerpt) console.log(`  which-team skipped, team not inside the excerpt: ${skipped.teamNotInExcerpt}`);
if (skipped.socialOutlet) console.log(`  which-outlet skipped, the "outlet" is a social handle: ${skipped.socialOutlet}`);
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
console.log(`js/app.js already lists it in TAB_POOLS and ALL_POOLS, so it reaches the Quiz tab as soon as this file is deployed.`);
