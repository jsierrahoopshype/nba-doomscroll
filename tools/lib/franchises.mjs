/* Which franchise is this, and what was it called at the time?
 *
 * WHY THIS FILE EXISTS, IN ONE SENTENCE FROM THE LIVE SITE
 *
 *   "Scottie Barnes is the first Raptors player to finish in the top five for
 *    Defensive Player of the Year in 43 seasons of voting"
 *
 * Toronto joined the NBA in 1995-96. The 43 came from the award's own span -
 * Defensive Player of the Year voting starts in 1983 - so the sentence credits
 * the Raptors with thirteen seasons of not doing something they did not exist
 * for. The claim is true and the number is a fabrication, which is the worst
 * combination available: it reads as authoritative and it is checkable.
 *
 * A drought window is the OVERLAP of two spans, never one of them: the seasons
 * the award has been voted on, and the seasons the franchise has existed. This
 * file supplies the second, plus the thing that turns out to matter almost as
 * much: what the franchise was CALLED in the season being described.
 *
 * THE SPAN COMES FROM THE DATA, THE NAME COMES FROM HERE
 *
 * Deliberately split. The first and last season a franchise appears is a fact
 * in rsStats and the builder reads it there, so no hand-typed year can put a
 * team on the floor a season early. What rsStats cannot say is that KCK, CIN
 * and ROC are the same franchise as SAC, or that a 1974 Bullets player should
 * not be called a Wizard. That is a naming table and there is no way to derive
 * it, so it is written out below and tested against the codes the data
 * actually uses.
 *
 * ERA YEARS ARE SEASON END YEARS
 *
 * 1996 means the 1995-96 season, matching awardVotes.json's YEAR column. An
 * era's year is the first season under that name.
 *
 * A WRONG NICKNAME HERE IS COSMETIC; A WRONG LINEAGE IS A LIE
 *
 * Calling a 1963 Syracuse player a "76er" is a bad sentence. Merging two
 * franchises that were never the same one produces a drought claim that spans
 * a team that did not exist, which is the Raptors bug again by another route.
 * So the groupings below are relocations and renamings of a single continuous
 * franchise only. The two Charlotte teams are NOT one franchise - the 1988-2002
 * Hornets became the Pelicans, and the 2004 expansion team took the name back
 * in 2014 - and they are kept apart here, which is the whole reason the lookup
 * takes a year.
 */

/* key -> { eras: [[firstSeasonEndYear, city, nickname, singular|null, code], ...],
 *          codes: [codes rsStats might use] }
 *
 * The fifth element is the three-letter code the team went by in that era -
 * SEA for the Sonics, NJN for the New Jersey Nets, CHH for the first Charlotte
 * Hornets. It is what a card prints beside a season, so a 2004 Nets card says
 * NJN and not BKN. `codes` is the superset a stats file might use for the
 * franchise; the era code is the one that is right for a given year.
 *
 * eras are listed NEWEST FIRST; the lookup takes the first one whose year is
 * at or below the season asked about.
 *
 * The singular is null wherever there is no word for one of them. "the first
 * Heat player" is clumsy but correct; "the first Heat" is neither. */
export const FRANCHISES = {
  hawks: {
    codes: ["ATL", "STL", "MLH", "TRI"],
    /* The Tri-Cities era was missing, which is why a 1951 game resolved to
       nothing and, worse, why identity() would have called that team the
       Milwaukee Hawks by falling back to the oldest era it knew. Moline,
       Davenport and Rock Island: three cities, one team, one name. */
    eras: [[1969, "Atlanta", "Hawks", "Hawk", "ATL"], [1956, "St. Louis", "Hawks", "Hawk", "STL"],
           [1952, "Milwaukee", "Hawks", "Hawk", "MLH"],
           [1950, "Tri-Cities", "Blackhawks", "Blackhawk", "TRI"]]
  },
  celtics: { codes: ["BOS"], eras: [[1947, "Boston", "Celtics", "Celtic", "BOS"]] },
  nets: {
    codes: ["BKN", "BRK", "NJN", "NYN"],
    eras: [[2013, "Brooklyn", "Nets", "Net", "BKN"], [1978, "New Jersey", "Nets", "Net", "NJN"],
           [1977, "New York", "Nets", "Net", "NYN"]]
  },
  /* The 2004 expansion team. Bobcats until 2014, when the Hornets name came
   * back from New Orleans. Nothing to do with the franchise below. */
  hornets: {
    codes: ["CHA", "CHO"],
    eras: [[2015, "Charlotte", "Hornets", "Hornet", "CHA"], [2005, "Charlotte", "Bobcats", "Bobcat", "CHA"]]
  },
  bulls: { codes: ["CHI"], eras: [[1967, "Chicago", "Bulls", "Bull", "CHI"]] },
  cavaliers: { codes: ["CLE"], eras: [[1971, "Cleveland", "Cavaliers", "Cavalier", "CLE"]] },
  mavericks: { codes: ["DAL"], eras: [[1981, "Dallas", "Mavericks", "Maverick", "DAL"]] },
  nuggets: { codes: ["DEN"], eras: [[1977, "Denver", "Nuggets", "Nugget", "DEN"]] },
  pistons: {
    codes: ["DET", "FTW"],
    eras: [[1958, "Detroit", "Pistons", "Piston", "DET"], [1949, "Fort Wayne", "Pistons", "Piston", "FTW"]]
  },
  warriors: {
    codes: ["GSW", "GS", "SFW", "PHW"],
    eras: [[1972, "Golden State", "Warriors", "Warrior", "GSW"],
           [1963, "San Francisco", "Warriors", "Warrior", "SFW"],
           [1947, "Philadelphia", "Warriors", "Warrior", "PHW"]]
  },
  rockets: {
    codes: ["HOU", "SDR"],
    eras: [[1972, "Houston", "Rockets", "Rocket", "HOU"], [1968, "San Diego", "Rockets", "Rocket", "SDR"]]
  },
  pacers: { codes: ["IND"], eras: [[1977, "Indiana", "Pacers", "Pacer", "IND"]] },
  clippers: {
    codes: ["LAC", "SDC", "BUF"],
    eras: [[1985, "Los Angeles", "Clippers", "Clipper", "LAC"],
           [1979, "San Diego", "Clippers", "Clipper", "SDC"],
           [1971, "Buffalo", "Braves", "Brave", "BUF"]]
  },
  lakers: {
    codes: ["LAL", "MNL"],
    eras: [[1961, "Los Angeles", "Lakers", "Laker", "LAL"], [1949, "Minneapolis", "Lakers", "Laker", "MNL"]]
  },
  grizzlies: {
    codes: ["MEM", "VAN"],
    eras: [[2002, "Memphis", "Grizzlies", "Grizzly", "MEM"], [1996, "Vancouver", "Grizzlies", "Grizzly", "VAN"]]
  },
  heat: { codes: ["MIA"], eras: [[1989, "Miami", "Heat", null, "MIA"]] },
  bucks: { codes: ["MIL"], eras: [[1969, "Milwaukee", "Bucks", "Buck", "MIL"]] },
  timberwolves: { codes: ["MIN"], eras: [[1990, "Minnesota", "Timberwolves", "Timberwolf", "MIN"]] },
  /* Charlotte 1989-2002, New Orleans since - including the two seasons the
   * Hornets played in Oklahoma City after Katrina. */
  pelicans: {
    codes: ["NOP", "NOH", "NOK", "CHH"],
    eras: [[2014, "New Orleans", "Pelicans", "Pelican", "NOP"],
           [2008, "New Orleans", "Hornets", "Hornet", "NOH"],
           [2006, "Oklahoma City", "Hornets", "Hornet", "NOK"],
           [2003, "New Orleans", "Hornets", "Hornet", "NOH"],
           [1989, "Charlotte", "Hornets", "Hornet", "CHH"]]
  },
  knicks: { codes: ["NYK", "NY"], eras: [[1947, "New York", "Knicks", "Knick", "NYK"]] },
  thunder: {
    codes: ["OKC", "SEA"],
    eras: [[2009, "Oklahoma City", "Thunder", null, "OKC"], [1968, "Seattle", "SuperSonics", "Sonic", "SEA"]]
  },
  magic: { codes: ["ORL"], eras: [[1990, "Orlando", "Magic", null, "ORL"]] },
  sixers: {
    codes: ["PHI", "SYR"],
    eras: [[1964, "Philadelphia", "76ers", "Sixer", "PHI"], [1950, "Syracuse", "Nationals", null, "SYR"]]
  },
  suns: { codes: ["PHX", "PHO"], eras: [[1969, "Phoenix", "Suns", "Sun", "PHX"]] },
  blazers: { codes: ["POR"], eras: [[1971, "Portland", "Trail Blazers", "Blazer", "POR"]] },
  kings: {
    codes: ["SAC", "KCK", "KCO", "CIN", "ROC"],
    eras: [[1986, "Sacramento", "Kings", "King", "SAC"], [1976, "Kansas City", "Kings", "King", "KCK"],
           [1973, "Kansas City-Omaha", "Kings", "King", "KCO"],
           [1958, "Cincinnati", "Royals", "Royal", "CIN"], [1949, "Rochester", "Royals", "Royal", "ROC"]]
  },
  spurs: { codes: ["SAS", "SAN"], eras: [[1977, "San Antonio", "Spurs", "Spur", "SAS"]] },
  raptors: { codes: ["TOR"], eras: [[1996, "Toronto", "Raptors", "Raptor", "TOR"]] },
  jazz: {
    codes: ["UTA", "UTH", "NOJ"],
    eras: [[1980, "Utah", "Jazz", null, "UTA"], [1975, "New Orleans", "Jazz", null, "NOJ"]]
  },
  wizards: {
    codes: ["WAS", "WSH", "WSB", "CAP", "BAL", "CHZ", "CHP"],
    eras: [[1998, "Washington", "Wizards", "Wizard", "WAS"], [1975, "Washington", "Bullets", "Bullet", "WSB"],
           [1974, "Capital", "Bullets", "Bullet", "CAP"], [1964, "Baltimore", "Bullets", "Bullet", "BAL"],
           [1963, "Chicago", "Zephyrs", "Zephyr", "CHZ"], [1962, "Chicago", "Packers", "Packer", "CHP"]]
  }
};

/* CHA is the awkward one. Basketball-Reference, which nba-player-data follows,
 * uses CHH for the first Charlotte Hornets and CHA/CHO for the expansion team -
 * but a dataset that normalises everything to CHA would silently hand the
 * 1990s Hornets to the wrong franchise, and that is a drought spanning a team
 * that did not exist. So the year decides, and only for codes where two
 * franchises have a real claim. */
const YEAR_OVERRIDE = [
  { code: "CHA", before: 2003, key: "pelicans" },
  { code: "CHO", before: 2003, key: "pelicans" }
];

const BY_CODE = new Map();
for (const [key, f] of Object.entries(FRANCHISES)) {
  for (const c of f.codes) BY_CODE.set(c, key);
}

/** rsStats team code (plus the season, for the two Charlottes) -> franchise key. */
export function franchiseKey(code, year) {
  const c = String(code == null ? "" : code).trim().toUpperCase();
  if (!c) return null;
  const y = parseInt(year, 10);
  if (isFinite(y)) {
    for (const o of YEAR_OVERRIDE) if (o.code === c && y < o.before) return o.key;
  }
  return BY_CODE.get(c) || null;
}

/**
 * What the franchise was called in a given season.
 *
 * @returns {null | { key, city, nick, sing, since }}
 *          `since` is the first season of that identity, which is how a
 *          sentence can notice that the name has changed since the last time
 *          this happened.
 */
export function identity(key, year) {
  const f = FRANCHISES[key];
  if (!f) return null;
  const y = parseInt(year, 10);
  const eras = f.eras;
  /* eras are newest-first, so find() returns the identity in force that
   * season. A season BEFORE the first era falls back to the OLDEST identity,
   * not the newest: the table's earliest entry may simply predate what it
   * records, and calling a 1950 Tri-Cities player a Hawk is a small error
   * where calling him an Atlanta Hawk is a nonsense. */
  const era = (isFinite(y) ? eras.find(e => y >= e[0]) : null) || eras[eras.length - 1];
  return { key, city: era[1], nick: era[2], sing: era[3] || null, since: era[0], code: era[4] };
}

/** Was this franchise in the league that season, as far as this table knows?
 * identity() deliberately answers for any year; this does not. The name
 * matcher below needs the strict answer, or "Charlotte" in 1998 would match
 * both Charlottes. */
export function existedIn(key, year) {
  const f = FRANCHISES[key];
  const y = parseInt(year, 10);
  if (!f || !isFinite(y)) return false;
  return y >= f.eras[f.eras.length - 1][0];
}

/** The code the franchise goes by today. */
export function currentCode(key) {
  const f = FRANCHISES[key];
  return f ? f.eras[0][4] : null;
}

/* ---------------- a name, in a season, to a franchise ---------------- */

/* "FT. WAYNE" IS FORT WAYNE, AND THAT COST 665 ROWS.
 *
 * The loose pass needs the text to contain both the city and the nickname. The
 * league's own game log spells the Pistons' first home "Ft. Wayne Zollner
 * Pistons", and this table says "Fort Wayne", so the nickname matched and the
 * city did not: 665 games of the Detroit franchise's own history resolved to
 * nothing, which in the records builder means those seasons could not be judged
 * at all. Abbreviations are expanded before matching rather than adding a
 * second spelling of every era, because the next file will abbreviate something
 * else the same way.
 *
 * THE WORD BOUNDARIES ARE LOAD-BEARING. Written once without them, /st/
 * turned "pistons" into "pisaintons" and the nickname stopped matching
 * anything: a fix for one franchise quietly breaking every other. Only a
 * whole word is an abbreviation. */
const ABBREV = [
  [/\bft\b/g, "fort"],
  [/\bst\b/g, "saint"],
  [/\bmt\b/g, "mount"]
];
const fold = s => {
  let t = String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const [re, to] of ABBREV) t = t.replace(re, to);
  return t;
};

/**
 * Which franchise is this text talking about, in this season?
 *
 * WHY A YEAR IS REQUIRED
 *
 * "Charlotte" in 1998 is the franchise that is now the Pelicans; "Charlotte"
 * in 2010 is the Bobcats. "New Orleans" in 1977 is the Jazz. "Oklahoma City"
 * in 2006 is the Hornets, displaced by Katrina, and in 2010 it is the Thunder.
 * "Chicago" in 1963 is the Zephyrs, who are now the Wizards. Without the year
 * none of those has an answer, and a matcher that guessed would put a payroll
 * on the wrong team's record.
 *
 * WHAT IT ACCEPTS
 *
 * A code (BKN, SEA, or CHA with the year deciding which Charlotte), a full
 * name as a game log spells it ("New Jersey Nets", "Seattle SuperSonics"), a
 * city as a salary file spells it ("Vancouver", "LA Lakers"), or a nickname.
 * Bare "Los Angeles" is refused as ambiguous rather than guessed, and so is
 * any text that matches two franchises in the same season - it should not
 * happen, but the table is typed by hand.
 *
 * WHAT WAS BROKEN WITHOUT IT
 *
 * The salary side keys old seasons by the franchise's CURRENT city, so a 2004
 * New Jersey payroll arrives as Brooklyn and a 2008 Seattle payroll as
 * Oklahoma City. The game log says what the team was called that night. The
 * join was on a code derived from each side's own string, so every pre-move
 * season of every relocated franchise failed to join - silently, which is how
 * the SuperSonics came to have no cost-per-win history at all.
 *
 * @returns {string|null} franchise key
 */
export function franchiseOf(text, year) {
  const raw = String(text == null ? "" : text).trim();
  const y = parseInt(year, 10);
  if (!raw || !isFinite(y)) return null;

  /* A code first: unambiguous, and CHA's year override lives in franchiseKey. */
  if (/^[A-Za-z]{2,4}$/.test(raw)) {
    const k = franchiseKey(raw, y);
    if (k) return k;
  }

  const t = fold(raw);
  if (!t) return null;
  const exact = [], loose = [];
  for (const key of FRANCHISE_KEYS) {
    if (!existedIn(key, y)) continue;
    const id = identity(key, y);
    const city = fold(id.city), nick = fold(id.nick);
    const full = city + " " + nick;
    const la = city === "los angeles" ? "la " + nick : null;
    if (t === full || t === nick || t === city || (la && t === la) || t === fold(id.code)) {
      exact.push(key);
      continue;
    }
    /* "New Orleans/Oklahoma City Hornets" is how one source spells the two
     * displaced seasons: the city and the nickname are both in there. */
    if (t.includes(nick) && t.includes(city)) loose.push(key);
  }
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  if (loose.length === 1) return loose[0];
  if (loose.length > 1) return null;

  /* SECOND PASS: TODAY'S NAME ON AN OLD SEASON.
   *
   * This is the case the salary file actually presents - "Brooklyn" against a
   * 2004 payroll, "Oklahoma City" against 2008 - and the first pass cannot
   * see it, because in 2004 the Nets' name was New Jersey. So try each
   * franchise's CURRENT name, still only for franchises that existed in the
   * season asked about. Current name only, deliberately: matching every name
   * a franchise has ever had would send "Charlotte 2004" to the old Hornets,
   * who were in New Orleans by then, when the honest answer is that there
   * was no Charlotte team in 2004 at all. */
  const today = [];
  for (const key of FRANCHISE_KEYS) {
    if (!existedIn(key, y)) continue;
    const id = identity(key, 9999);
    const city = fold(id.city), nick = fold(id.nick);
    const la = city === "los angeles" ? "la " + nick : null;
    if (t === city + " " + nick || t === nick || t === city || (la && t === la) ||
        t === fold(id.code)) today.push(key);
  }
  return today.length === 1 ? today[0] : null;
}

/**
 * How a card names the team for a season, without ambiguity. Two franchises
 * in one city that season - Los Angeles, or New York in 1976-77 - get the
 * city and the nickname; everyone else gets the city, which is what the
 * salary cards already print.
 */
export function displayCity(key, year) {
  const id = identity(key, year);
  if (!id) return null;
  const y = parseInt(year, 10);
  const shared = FRANCHISE_KEYS.some(k => k !== key && existedIn(k, y) &&
    identity(k, y).city === id.city);
  if (!shared) return id.city;
  return (id.city === "Los Angeles" ? "LA" : id.city) + " " + id.nick;
}

/** "a Piston", "a Heat player". Every singular in the table starts with a
 * consonant sound, so the article is never in question. */
export function oneOf(id) {
  if (!id) return "a player";
  return id.sing ? "a " + id.sing : "a " + id.nick + " player";
}

/** "Piston", "Heat player" - for "the first Piston to ...". */
export function theOneOf(id) {
  if (!id) return "player";
  return id.sing ? id.sing : id.nick + " player";
}

export const FRANCHISE_KEYS = Object.keys(FRANCHISES);
export const KNOWN_CODES = [...BY_CODE.keys()];
