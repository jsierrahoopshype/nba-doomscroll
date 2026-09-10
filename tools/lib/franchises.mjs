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

/* key -> { eras: [[firstSeasonEndYear, city, nickname, singular|null], ...],
 *          codes: [codes rsStats might use] }
 *
 * eras are listed NEWEST FIRST; the lookup takes the first one whose year is
 * at or below the season asked about.
 *
 * The singular is null wherever there is no word for one of them. "the first
 * Heat player" is clumsy but correct; "the first Heat" is neither. */
export const FRANCHISES = {
  hawks: {
    codes: ["ATL", "STL", "MLH", "TRI"],
    eras: [[1969, "Atlanta", "Hawks", "Hawk"], [1956, "St. Louis", "Hawks", "Hawk"],
           [1952, "Milwaukee", "Hawks", "Hawk"]]
  },
  celtics: { codes: ["BOS"], eras: [[1947, "Boston", "Celtics", "Celtic"]] },
  nets: {
    codes: ["BKN", "BRK", "NJN", "NYN"],
    eras: [[2013, "Brooklyn", "Nets", "Net"], [1978, "New Jersey", "Nets", "Net"],
           [1977, "New York", "Nets", "Net"]]
  },
  /* The 2004 expansion team. Bobcats until 2014, when the Hornets name came
   * back from New Orleans. Nothing to do with the franchise below. */
  hornets: {
    codes: ["CHA", "CHO"],
    eras: [[2015, "Charlotte", "Hornets", "Hornet"], [2005, "Charlotte", "Bobcats", "Bobcat"]]
  },
  bulls: { codes: ["CHI"], eras: [[1967, "Chicago", "Bulls", "Bull"]] },
  cavaliers: { codes: ["CLE"], eras: [[1971, "Cleveland", "Cavaliers", "Cavalier"]] },
  mavericks: { codes: ["DAL"], eras: [[1981, "Dallas", "Mavericks", "Maverick"]] },
  nuggets: { codes: ["DEN"], eras: [[1977, "Denver", "Nuggets", "Nugget"]] },
  pistons: {
    codes: ["DET", "FTW"],
    eras: [[1958, "Detroit", "Pistons", "Piston"], [1949, "Fort Wayne", "Pistons", "Piston"]]
  },
  warriors: {
    codes: ["GSW", "GS", "SFW", "PHW"],
    eras: [[1972, "Golden State", "Warriors", "Warrior"],
           [1963, "San Francisco", "Warriors", "Warrior"],
           [1947, "Philadelphia", "Warriors", "Warrior"]]
  },
  rockets: {
    codes: ["HOU", "SDR"],
    eras: [[1972, "Houston", "Rockets", "Rocket"], [1968, "San Diego", "Rockets", "Rocket"]]
  },
  pacers: { codes: ["IND"], eras: [[1977, "Indiana", "Pacers", "Pacer"]] },
  clippers: {
    codes: ["LAC", "SDC", "BUF"],
    eras: [[1985, "Los Angeles", "Clippers", "Clipper"],
           [1979, "San Diego", "Clippers", "Clipper"],
           [1971, "Buffalo", "Braves", "Brave"]]
  },
  lakers: {
    codes: ["LAL", "MNL"],
    eras: [[1961, "Los Angeles", "Lakers", "Laker"], [1949, "Minneapolis", "Lakers", "Laker"]]
  },
  grizzlies: {
    codes: ["MEM", "VAN"],
    eras: [[2002, "Memphis", "Grizzlies", "Grizzly"], [1996, "Vancouver", "Grizzlies", "Grizzly"]]
  },
  heat: { codes: ["MIA"], eras: [[1989, "Miami", "Heat", null]] },
  bucks: { codes: ["MIL"], eras: [[1969, "Milwaukee", "Bucks", "Buck"]] },
  timberwolves: { codes: ["MIN"], eras: [[1990, "Minnesota", "Timberwolves", "Timberwolf"]] },
  /* Charlotte 1989-2002, New Orleans since - including the two seasons the
   * Hornets played in Oklahoma City after Katrina. */
  pelicans: {
    codes: ["NOP", "NOH", "NOK", "CHH"],
    eras: [[2014, "New Orleans", "Pelicans", "Pelican"],
           [2008, "New Orleans", "Hornets", "Hornet"],
           [2006, "Oklahoma City", "Hornets", "Hornet"],
           [2003, "New Orleans", "Hornets", "Hornet"],
           [1989, "Charlotte", "Hornets", "Hornet"]]
  },
  knicks: { codes: ["NYK", "NY"], eras: [[1947, "New York", "Knicks", "Knick"]] },
  thunder: {
    codes: ["OKC", "SEA"],
    eras: [[2009, "Oklahoma City", "Thunder", null], [1968, "Seattle", "SuperSonics", "Sonic"]]
  },
  magic: { codes: ["ORL"], eras: [[1990, "Orlando", "Magic", null]] },
  sixers: {
    codes: ["PHI", "SYR"],
    eras: [[1964, "Philadelphia", "76ers", "Sixer"], [1950, "Syracuse", "Nationals", null]]
  },
  suns: { codes: ["PHX", "PHO"], eras: [[1969, "Phoenix", "Suns", "Sun"]] },
  blazers: { codes: ["POR"], eras: [[1971, "Portland", "Trail Blazers", "Blazer"]] },
  kings: {
    codes: ["SAC", "KCK", "KCO", "CIN", "ROC"],
    eras: [[1986, "Sacramento", "Kings", "King"], [1976, "Kansas City", "Kings", "King"],
           [1973, "Kansas City-Omaha", "Kings", "King"],
           [1958, "Cincinnati", "Royals", "Royal"], [1949, "Rochester", "Royals", "Royal"]]
  },
  spurs: { codes: ["SAS", "SAN"], eras: [[1977, "San Antonio", "Spurs", "Spur"]] },
  raptors: { codes: ["TOR"], eras: [[1996, "Toronto", "Raptors", "Raptor"]] },
  jazz: {
    codes: ["UTA", "UTH", "NOJ"],
    eras: [[1980, "Utah", "Jazz", null], [1975, "New Orleans", "Jazz", null]]
  },
  wizards: {
    codes: ["WAS", "WSH", "WSB", "CAP", "BAL", "CHZ", "CHP"],
    eras: [[1998, "Washington", "Wizards", "Wizard"], [1975, "Washington", "Bullets", "Bullet"],
           [1974, "Capital", "Bullets", "Bullet"], [1964, "Baltimore", "Bullets", "Bullet"],
           [1963, "Chicago", "Zephyrs", "Zephyr"], [1962, "Chicago", "Packers", "Packer"]]
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
  return { key, city: era[1], nick: era[2], sing: era[3] || null, since: era[0] };
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
