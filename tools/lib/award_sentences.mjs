/* The sentences themselves. One module, because the sentence was the bug.
 *
 * WHAT WENT OUT ON THE LIVE SITE
 *
 * Ten cards in a row, eight of them this:
 *
 *   "<Player> is the first <Team> player to finish in the top five for
 *    <Award> since <Year>"
 *   "He finished 5th. The last was <Name> in <Year>. <N> seasons of <Award>
 *    voting went by without another."
 *
 * The facts were right. The output was still bad, for four separate reasons,
 * and it is worth naming them because they are not the same problem:
 *
 *   1. ONE TEMPLATE. A slot-filled sentence reads as machine output by the
 *      third time you see it, however true it is. This is the same complaint
 *      as "One voter, and only one, named Jayson Tatum for MVP - that's lame
 *      and it's even more lame because you repeat that sentence all the time."
 *
 *   2. GRAMMAR. "The last was Shane Battier and Metta World Peace in 2009."
 *      Two men, one singular verb.
 *
 *   3. REDUNDANCY. The award's full name twice, the season count twice, and
 *      every detail line opening "He finished 5th."
 *
 *   4. A NUMBER THAT WAS NOT TRUE. "in 43 seasons of voting" for a franchise
 *      that has existed for 30. That one is fixed in lib/franchises.mjs and
 *      the builder; the rest are fixed here.
 *
 * SHAPES, NOT A TEMPLATE
 *
 * Each case offers several genuinely different sentence structures - the
 * subject first, the predecessor first, the drought first, the achievement
 * first - and which one a card gets is decided by a hash of its own facts, so
 * it is stable across builds and spread across the pool. The builder can also
 * ask for the next valid shape when one has been used too often, which is why
 * this exports a LIST rather than a string.
 *
 * These are structures, not synonyms. Rewording one sentence six ways is still
 * one sentence; what stops a feed reading as generated is the emphasis moving.
 *
 * HOUSE STYLE IS ENFORCED, NOT HOPED FOR
 *
 * No em-dashes, no "ever" (the data cannot support it - see the builder), no
 * hedged openers. checkText() below is the same function the builder's
 * verifier runs, so a sentence that breaks the rules fails the build rather
 * than reaching the feed.
 */

/* ---------------- small pieces ---------------- */

const ORD = ["", "first", "second", "third", "fourth", "fifth",
             "sixth", "seventh", "eighth", "ninth", "tenth"];

/** "fifth" up to tenth, then "14th". Spelled out is how a sentence reads;
 * digits are how a table reads. */
export function ordWord(n) {
  const i = parseInt(n, 10);
  if (!isFinite(i) || i < 1) return "";
  if (i <= 10) return ORD[i];
  const s = ["th", "st", "nd", "rd"], v = i % 100;
  return i + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "an MVP vote", "a top-five finish". Only the acronym needs thinking about. */
export function withArticle(noun) {
  return (/^(MVP|MIP)\b/.test(noun) ? "an " : "a ") + noun;
}

/**
 * A list of predecessors, and whether it takes a plural verb.
 * "The last WAS Shane Battier and Metta World Peace" shipped; this is why.
 */
export function nameList(list) {
  const n = (list || []).map(s => String(s || "").trim()).filter(Boolean);
  if (!n.length) return null;
  if (n.length === 1) return { text: n[0], plural: false, count: 1 };
  if (n.length === 2) return { text: n[0] + " and " + n[1], plural: true, count: 2 };
  if (n.length === 3) return { text: n[0] + ", " + n[1] + " and " + n[2], plural: true, count: 3 };
  return { text: n[0] + " and " + (n.length - 1) + " others", plural: true, count: n.length };
}

/* A particle belongs to the surname. "Norm Van Lier" is not "Lier", and
 * "Metta World Peace" is certainly not "Peace". */
const PARTICLES = new Set(["Van", "van", "De", "de", "Del", "Della", "Dos", "Da",
                           "La", "Le", "St.", "World", "Ter", "Der"]);
const SUFFIX = /^(Jr\.?|Sr\.?|II|III|IV|V)$/i;

/** The name a sentence uses on second mention. Display form, not the folded
 * lower-case one js/player-resolver.js produces for matching. */
export function displaySurname(name) {
  const w = String(name == null ? "" : name).trim().split(/\s+/).filter(Boolean)
    .filter(t => !SUFFIX.test(t));
  if (!w.length) return "";
  const last = w[w.length - 1];
  if (w.length >= 2 && PARTICLES.has(w[w.length - 2])) return w[w.length - 2] + " " + last;
  return last;
}

/* THE NAME HE HAD AT THE TIME.
 *
 * awardVotes.json carries current names, so a 2009 card read "the last was
 * Shane Battier and Metta World Peace in 2009" - he was Ron Artest until 2011
 * and the sentence dates itself to a season under a name that did not exist
 * yet. There is no way to derive this, so it is a table, and it is short on
 * purpose: only players whose renaming lands inside a season the awards data
 * covers, which is a handful. Add to it when one shows up. */
const PAST_NAMES = [
  { now: /^Metta (World Peace|Sandiford-Artest)$/, until: 2011, then: "Ron Artest" },
  { now: /^Metta Sandiford-Artest$/, until: 2020, then: "Metta World Peace" },
  { now: /^Kareem Abdul-Jabbar$/, until: 1971, then: "Lew Alcindor" },
  { now: /^World B\. Free$/, until: 1981, then: "Lloyd Free" },
  { now: /^Mahmoud Abdul-Rauf$/, until: 1993, then: "Chris Jackson" }
];

/** The player's name as of a given season. Unchanged for everyone not listed. */
export function pastName(name, year) {
  const n = String(name == null ? "" : name).trim();
  const y = parseInt(year, 10);
  if (!n || !isFinite(y)) return n;
  for (const r of PAST_NAMES) if (r.now.test(n) && y <= r.until) return r.then;
  return n;
}

/* Stable, so a card keeps the same sentence between builds. FNV-1a, plus a
 * finaliser, and the finaliser is not optional.
 *
 * WORTH RECORDING, BECAUSE IT LOOKED LIKE IT WORKED
 *
 * Shape selection is `hash % shapes.length`. With plain FNV-1a and four
 * shapes, nine of the first ten real cards picked shape zero. FNV's low bits
 * barely move: the prime it multiplies by ends in 0x93, so the last byte of
 * the input dominates them, and `% 4` reads only the lowest two. The hash was
 * fine and the way it was being used was not - a distribution bug that shows
 * up as "the cards all look the same", which is exactly the complaint this
 * whole module exists to answer.
 *
 * The avalanche below is murmur3's finaliser. It mixes the high bits down, so
 * every bit of the output depends on every bit of the input and `% n` is as
 * good as any other slice. test_award_sentences.mjs asserts the spread.
 */
export function hashOf(s) {
  let h = 0x811c9dc5;
  const t = String(s == null ? "" : s);
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/* ---------------- what "it" is, per scope ---------------- */

/* A vote, a top-five finish and a win are three different claims and the
 * strongest one the data supports is the one worth making. Each needs its own
 * verb forms; assembling them from a shared stem produced "a All-NBA vote"
 * once already. */
function verbs(scope, label) {
  if (scope === "win") {
    return {
      inf: "win " + label,
      bareInf: "win it",
      barePast: "won it",
      did: "won " + label,
      noun: label + " win"
    };
  }
  if (scope === "top") {
    return {
      inf: "finish in the top five for " + label,
      bareInf: "crack the top five",
      barePast: "finished in the top five",
      did: "finished in the top five for " + label,
      noun: "top-five " + label + " finish"
    };
  }
  return {
    inf: "receive a vote for " + label,
    bareInf: "receive one",
    barePast: "received a vote",
    did: "received votes for " + label,
    noun: label + " vote"
  };
}

/* "He finished fifth." is fine as a closing clause and was awful as an opener,
 * which is where it used to sit. Empty for a win, where the headline has
 * already said it. */
function rankBit(fact) {
  if (fact.scope === "win") return "";
  const r = parseInt(fact.rank, 10);
  if (!isFinite(r)) return "";
  if (r === 1) return " He won the award outright.";
  return " He finished " + ordWord(r) + ".";
}

/* The franchise changed its name or its city between the two appearances. This
 * is real colour rather than a caveat: "back then the franchise was the
 * Seattle SuperSonics" is the kind of thing that makes a reader stop, and it
 * also stops the sentence calling a 1979 Sonic a Thunder player. */
function renameNote(fact) {
  const a = fact.id, b = fact.sinceId;
  if (!a || !b) return "";
  if (a.nick === b.nick && a.city === b.city) return "";
  return " Back then the franchise was the " + b.city + " " + b.nick + ".";
}

/* ---------------- the shapes ---------------- */

/**
 * Every sentence pair this fact can support, best-ordered and then rotated by
 * a hash of the fact itself.
 *
 * @param {object} fact
 *   player, surname, label, year, rank, scope, kind, id {city,nick,sing}
 *   first-since:      gap, sinceSeasons, sinceYear, sinceNames[], sinceRank, sinceId, sinceSurname
 *   first-in-window:  seasonsCovered, windowFrom, wholeHistory, sameIdentityThroughout
 * @returns {Array<{shape:string, head:string, detail:string}>} possibly empty
 */
export function sentenceShapes(fact) {
  if (!fact || !fact.player || !fact.label || !fact.id) return [];
  const v = verbs(fact.scope, fact.label);
  const id = fact.id;
  const theOne = id.sing || (id.nick + " player");
  /* Always "Rockets players", never "Rockets": "the last Rockets to finish top
   * five were Battier and Artest" reads as the team having finished twice. */
  const thePlural = id.nick + " players";
  const rb = rankBit(fact);
  const rn = renameNote(fact);
  const out = [];

  if (fact.kind === "first-since") {
    const Q = nameList(fact.sinceNames);
    if (!Q) return [];
    const wasWere = Q.plural ? "were" : "was";
    const S = fact.sinceSeasons, G = fact.gap, Y = fact.sinceYear;

    /* A: subject first, dated. The old template's descendant, kept because it
     * is the clearest of the four - just no longer the only one. Needs a
     * single predecessor: "between A and B and him" is not a sentence. */
    if (!Q.plural) {
      out.push({
        shape: "since-subject",
        head: `${fact.player} is the first ${theOne} to ${v.inf} since ${Y}`,
        detail: `${G} seasons of voting went by between ${Q.text} and him.${rb}${rn}`
      });
    }

    /* B: predecessor first. Puts the name a reader knows at the front, which
     * is often the more interesting half of the fact. */
    out.push({
      shape: "since-predecessor",
      head: Q.plural
        ? `The last ${thePlural} to ${v.inf} were ${Q.text}, in ${Y}`
        : `The last ${theOne} to ${v.inf} was ${Q.text} in ${Y}`,
      detail: `${S} seasons later, ${fact.player} is the next.${rb}${rn}`
    });

    /* C: the drought first, with the city as the subject. Reads as a fact
     * about a place rather than about a leaderboard.
     *
     * The number here is the GAP, not the seasons since. A 2006 predecessor
     * with a gap of 19 means 2007 through 2025 went without one and it
     * happened in the twentieth - so "had gone 19 seasons without" is right
     * and "had gone 20" overstates it by the season the card is about. */
    out.push({
      shape: "since-drought",
      head: `${id.city} had gone ${G} seasons without ${withArticle(v.noun)}. ` +
            `${fact.surname || fact.player} ended it`,
      detail: `${Q.text} ${wasWere} the last, in ${Y}.${rb}${rn}`
    });

    /* D: the achievement first. Only offered when the achievement is worth
     * leading with - a win, or a genuine top-three finish.
     *
     * THE ACHIEVEMENT IS DESCRIBED AT THE GRANULARITY OF THE DROUGHT, and
     * that is not a style choice. An earlier draft said "finished second,
     * which no Piston had managed since 2006" off a TOP-FIVE history. The
     * sentence implies a Piston finished second in 2006; what the data says
     * is that one finished top five that year. Rank-specific phrasing needs a
     * rank-specific history, which does not exist here, so the exact finish
     * goes in the detail as a standalone fact instead. */
    const r = parseInt(fact.rank, 10);
    if (fact.scope === "win" || (isFinite(r) && r <= 3)) {
      let qNote = "";
      /* Pointless when the drought is a drought of wins: "Henderson was the
       * last to do it" already says he won. */
      if (fact.scope !== "win" && !Q.plural &&
          isFinite(parseInt(fact.sinceRank, 10)) && fact.sinceSurname) {
        const qr = parseInt(fact.sinceRank, 10);
        qNote = " " + fact.sinceSurname +
          (qr === 1 ? " won it that year." : " finished " + ordWord(qr) + " that year.");
      }
      out.push({
        shape: "since-feat",
        head: `${fact.player} ${v.did}, which no ${theOne} had managed since ${Y}`,
        detail: `${Q.text} ${wasWere} the last to do it, ${S} seasons ago.${qNote}${rn}`
      });
    }
  } else if (fact.kind === "first-in-window") {
    const N = fact.seasonsCovered, W = fact.windowFrom;

    /* F: the strongest version of this card, and only sayable when the
     * franchise is younger than the award. Nothing is hedged: the award has
     * been voted on in every season this team has existed. */
    if (fact.wholeHistory) {
      out.push({
        shape: "never-franchise",
        head: `${fact.player} is the first ${theOne} in franchise history to ${v.inf}`,
        /* The award is named in the headline and must not be named again. An
         * earlier version said "finish in the top five for Defensive Player of
         * the Year" and then "without a top-five Defensive Player of the Year
         * finish", which is the redundancy Jorge flagged, twice in two lines. */
        detail: (fact.sameIdentityThroughout ? `The ${id.nick} had` : "The franchise had") +
          ` played ${N} seasons without one.${rb}`
      });
    }

    /* G: the count, with the window stated. "In N seasons" is a claim about a
     * span, so the span is in the sentence.
     *
     * PHRASED AS AN ABSENCE, NOT AS A FIRST-SINCE. The earlier version read
     * "X is the first Timberwolf to win Defensive Player of the Year in 34
     * seasons", which any reader takes to mean the last one was 34 seasons
     * ago - when what the data says is that there has never been one. The
     * detail corrected it and the headline is what gets shared, so the
     * headline has to be the one that cannot be misread. */
    out.push({
      shape: "never-count",
      head: `No ${theOne} had ${v.did} in ${N} seasons. ${fact.player} is the first`,
      detail: fact.wholeHistory
        ? `That is every season the franchise has played.${rb}`
        : `Going back to ${W}, nobody had managed it.${rb}`
    });

    /* H: the city waiting. Needs the city and nickname to have held for the
     * whole window, or it credits the wait to the wrong town. */
    if (fact.sameIdentityThroughout) {
      out.push({
        shape: "never-city",
        head: `${id.city} waited ${N} seasons for ${withArticle(v.noun)}. ` +
              `${fact.surname || fact.player} delivered it`,
        detail: fact.wholeHistory
          ? `The franchise had never had one.${rb}`
          : `No ${theOne} had done it in any season from ${W} on.${rb}`
      });
    }
  }

  if (out.length < 2) return out;
  /* Rotate by the fact's own hash: stable between builds, spread across the
   * pool, and not the same first choice for every card. */
  const k = hashOf([fact.player, fact.label, fact.year, fact.scope].join("|")) % out.length;
  return out.slice(k).concat(out.slice(0, k));
}

/** The first shape, for callers that do not care which. */
export function awardSentence(fact) {
  const all = sentenceShapes(fact);
  return all.length ? all[0] : null;
}

/* ---------------- house style, checked ---------------- */

/* Jorge's editorial rules, as assertions. The build fails rather than the feed
 * carrying it: a bad sentence that ships is worth more round trips than a
 * build that stops.
 *
 * "ever" is here because it came back twice. Rookie of the Year voting began
 * in 1953 and this data starts in 1964, so "the first Kings player ever" is a
 * sentence about eleven seasons nobody here has seen. */
const BANNED = [
  [/\bever\b/i, "says 'ever', which this data cannot support"],
  [/[—–]/, "contains an em-dash or en-dash"],
  [/\bNaN\b|\bundefined\b|\bInfinity\b|\bnull\b/, "carries a failed calculation"],
  [/\bit's not just\b/i, "uses the 'not just X, it's Y' construction"],
  [/\bit's worth noting\b|\bit's important to\b/i, "opens with a hedge"],
  [/\bin 0 seasons\b|\bgone 0 seasons\b|\bsince 0\b/, "has a zero-length span"],
  [/ {2}|\s[,.]| \.$/, "has stray whitespace or punctuation"],
  [/\.\./, "has a doubled period"],
  [/\b(\w+) and (\w+) was\b/, "gives a plural subject a singular verb"]
];

/**
 * Is this pair fit to ship?
 * @returns {string[]} reasons, empty when it is fine.
 */
export function checkText(head, detail) {
  const bad = [];
  const h = String(head == null ? "" : head);
  const d = String(detail == null ? "" : detail);
  if (!h.trim()) bad.push("empty headline");
  if (!d.trim()) bad.push("empty detail");
  for (const [re, why] of BANNED) {
    if (re.test(h)) bad.push("headline " + why);
    if (re.test(d)) bad.push("detail " + why);
  }
  if (h.trim().endsWith(".")) bad.push("headline ends in a period");
  if (d.trim() && !/[.!?]$/.test(d.trim())) bad.push("detail does not end in a period");
  /* Long enough to say something specific, short enough to stay a headline.
   * Two names and a full award title reaches 130 and still reads as one
   * sentence; past 140 it is a paragraph wearing a headline's clothes. */
  if (h.length > 140) bad.push("headline is " + h.length + " characters");
  if (h && !/^[A-Z0-9"']/.test(h.trim())) bad.push("headline does not start with a capital");
  return bad;
}

/* ---------------- when a drought is worth a card ---------------- */

/* "Haywoode Workman cost $340 per assist in 1990-91" was the salary pool's
 * version of this: arithmetic that clears a threshold nobody thought about.
 *
 * A gap is only remarkable relative to how many players get votes at all.
 * Fifteen players draw MVP votes in a season, so a team going eight without
 * one is genuinely unusual. Five players finish top five, which across thirty
 * teams is one appearance per team per six years, so an eight-season gap there
 * is close to chance and a card about it teaches the reader that the label
 * means nothing. Rookie of the Year is the extreme case: five names a year and
 * the field turns over completely, so gaps are the normal state.
 *
 * These are deliberately high. False negatives cost cards; false positives
 * cost the feed's credibility.
 */
export const MIN_GAP = {
  MVP: { win: 15, top: 12, any: 8 },
  DPOY: { win: 15, top: 12, any: 10 },
  MIP: { win: 15, top: 14, any: 10 },
  "Sixth Man": { win: 15, top: 14, any: 10 },
  ROY: { win: 18, top: 15, any: 12 },
  default: { win: 18, top: 15, any: 12 }
};

export function minGapFor(awardKey, scope) {
  const row = MIN_GAP[awardKey] || MIN_GAP.default;
  return row[scope] == null ? MIN_GAP.default[scope] : row[scope];
}

/* A "nobody has done this here" card needs a window long enough for the
 * absence to mean something.
 *
 * WIN WAS EXCLUDED HERE AND THAT WAS WRONG.
 *
 * The reasoning was that twenty-odd franchises have never won Most Improved
 * Player, so the card would exist for all of them and say nothing about any
 * player. That only holds if cards are generated for teams that did NOT win.
 * They are not: a card is only ever built for the player who just did it, so a
 * franchise-first win can happen at most once per franchise per award, in the
 * season it happens.
 *
 * What the exclusion actually cost showed up in the first real build. Rudy
 * Gobert won Defensive Player of the Year for a Minnesota team that had never
 * won it, and the card had to fall back to the top-five drought instead:
 *
 *   "Minnesota had gone 20 seasons without a top-five Defensive Player of the
 *    Year finish. Gobert ended it. Kevin Garnett was the last, in 2003. He won
 *    the award outright."
 *
 * True, and the better sentence was sitting unused two lines away. */
export const MIN_NEVER_WINDOW = { win: 20, top: 20, any: 20 };

/** An award needs a history before a drought inside it is a fact worth
 * printing. Clutch Player (4 seasons) and the Hustle Award (8) do not have
 * one, and no gate downstream would have caught that on its own. */
export const MIN_AWARD_SEASONS = 20;
