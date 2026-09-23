/* Heights and positions, from nba-player-data's bio.json.
 *
 * WHY THIS EXISTS
 *
 * The Dream Team card lists five players, and it was listing them in scoring
 * order because scoring order is all rsStats.json can support: PLAYER, TEAM,
 * YEAR, GP, PTS and nothing else. Jorge asked for them in lineup order - point
 * guard to centre, or shortest to tallest.
 *
 * WHAT THE SOURCE CAN AND CANNOT DO, measured against the real file:
 *
 *   bio.json holds 5,105 rows of PLAYER, BIRTHDAY, POS, HEIGHT, WEIGHT,
 *   NATIONALITY, DRAFT. All 310 players in the current Dream Team pool are in
 *   it, every one with a height and a position, and PLAYER is unique across the
 *   whole file - so the join is by name and is unambiguous. That last point
 *   matters here specifically: this pool has already been bitten once by a
 *   birth-year disambiguator leaking into a card, and a bio file with duplicate
 *   names would have needed the same treatment.
 *
 *   POS is only G, F, C and the hyphenated pairs - G-F, F-G, F-C, C-F. There is
 *   no PG/SG or SF/PF split anywhere in the file. So POINT GUARD TO CENTRE IS
 *   NOT AVAILABLE from this source, and anything claiming to do it would be
 *   guessing which guard was the point guard. Shortest to tallest is exact and
 *   fully covered, so that is the order, with position breaking ties.
 */

import fs from "fs";
import path from "path";

/** Feet-inches as written in bio.json ("6-9") to inches. null if unparseable. */
export function heightInches(raw) {
  const m = /^\s*(\d+)\s*-\s*(\d{1,2})\s*$/.exec(String(raw == null ? "" : raw));
  if (!m) return null;
  const ft = parseInt(m[1], 10), inch = parseInt(m[2], 10);
  /* A sanity band rather than a blind parse: 47 rows in the file have an empty
   * HEIGHT, and a typo like "69-0" would otherwise sort a guard above a centre
   * and look like a scheduler bug rather than a data one. */
  if (!(ft >= 4 && ft <= 8) || !(inch >= 0 && inch <= 11)) return null;
  return ft * 12 + inch;
}

/* Guards before forwards before centres, with the hyphenated pairs sitting
 * between their two halves. Only a tie-break: two players of the same height
 * should still read as a lineup rather than as whatever order the source
 * happened to be in. */
const POS_RANK = {
  "G": 0, "GF": 1, "G-F": 1, "F-G": 2, "F": 3, "F-C": 4, "C-F": 5, "C": 6
};

/** 0 (guard) to 6 (centre). null when POS is blank or unrecognised. */
export function posRank(raw) {
  const k = String(raw == null ? "" : raw).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(POS_RANK, k) ? POS_RANK[k] : null;
}

/**
 * Read bio.json and index it by player name.
 *
 * @param {string} dir  the nba-player-data directory
 * @returns {{ get: function(string): (object|null), size: number, file: string }}
 */
export function loadBio(dir) {
  const file = path.join(dir, "bio.json");
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  const byName = new Map();
  let dupes = 0;
  for (const r of rows) {
    const n = r && r.PLAYER;
    if (!n) continue;
    if (byName.has(n)) dupes++;
    byName.set(n, {
      name: n,
      pos: String(r.POS || "").trim() || null,
      posRank: posRank(r.POS),
      height: String(r.HEIGHT || "").trim() || null,
      heightIn: heightInches(r.HEIGHT)
    });
  }
  return {
    file,
    size: byName.size,
    /* Reported rather than swallowed: the join is by name, and a duplicate name
     * means one of the two is being silently discarded. */
    duplicates: dupes,
    get: (name) => byName.get(name) || null
  };
}

/**
 * Five players in lineup order: shortest first, position breaking ties.
 *
 * A player the bio file does not cover keeps its place relative to the others
 * rather than being dropped or sorted to an end - a missing 1950s guard should
 * cost the sort on that one card and nothing else. Stable, so equal keys come
 * out in the order they went in.
 *
 * @param {Array} players  objects carrying at least { name }
 * @param {object} bio     from loadBio()
 */
export function lineupOrder(players, bio) {
  const keyed = players.map((p, i) => {
    const b = bio ? bio.get(p.name) : null;
    return {
      p, i,
      h: b && b.heightIn != null ? b.heightIn : null,
      r: b && b.posRank != null ? b.posRank : null
    };
  });
  const known = keyed.filter(k => k.h != null);
  /* Nothing to sort by: hand the list back untouched rather than half-sorted,
   * which would look deliberate and be arbitrary. */
  if (known.length < 2) return players.slice();
  return keyed.slice().sort((a, b) => {
    if (a.h == null && b.h == null) return a.i - b.i;
    if (a.h == null) return 1;
    if (b.h == null) return -1;
    if (a.h !== b.h) return a.h - b.h;
    if (a.r != null && b.r != null && a.r !== b.r) return a.r - b.r;
    return a.i - b.i;
  }).map(k => k.p);
}

/** Annotate a player with what the bio file knows, leaving it alone if absent. */
export function withBio(player, bio) {
  const b = bio ? bio.get(player.name) : null;
  if (!b) return player;
  const out = Object.assign({}, player);
  if (b.pos) out.pos = b.pos;
  if (b.height) out.height = b.height;
  return out;
}
