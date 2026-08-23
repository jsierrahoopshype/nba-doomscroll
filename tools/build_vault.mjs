#!/usr/bin/env node
/* NBA Doomscroll — Vault pool builder (step 5)
 *
 * Builds data/vault-pool.json from public data already in Jorge's repos:
 *
 *   salary cards   nba-player-data/salaries.json (1991-2026) measured against
 *                  the salary cap of that same season, from
 *                  salary-season-finder/salary_cap_info.csv. Cap share is used
 *                  instead of a CPI "worth $Y today" figure because it is
 *                  derivable entirely from these two files — no external
 *                  inflation source, nothing invented — and it says more to an
 *                  NBA reader ("123% of the entire cap") than a dollar figure.
 *
 *   ballot oddities  media-vote-tracker reporter ballots (2013-14 onward).
 *                  Auto-detected anomalies only: lone first-place votes,
 *                  unanimous winners, and the single most out-of-step voter on
 *                  an award. Every card states it counts TRACKED ballots,
 *                  because the tracker does not hold every ballot ever cast.
 *
 *   on this day    nba-attendance/data/Games.csv (73,279 games, 1946-2026).
 *                  Final scores and playoff round labels for every game;
 *                  arena and attendance exist for only ~1.9% of rows (the
 *                  2024-25 and 2025-26 schedules) so they are rendered only
 *                  when present. There are no player box scores in any repo,
 *                  so cards carry no "top performer" line.
 *
 * Every claim on a card is computed from those files. Nothing is estimated.
 *
 * Usage:
 *   node tools/build_vault.mjs --local <playerDataDir> <headshotsMetaDir> \
 *        <mvtDataDir> <capCsvPath> <gamesCsvPath>
 *
 * Historical games and old salaries do not change, so this is an on-demand
 * build rather than part of the weekly refresh. Re-run it when a season ends
 * to fold the new games in.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

const HEADSHOT_BASE = "https://jsierrahoopshype.github.io/nba-headshots/players/headshots/face/";
const LOGO_BASE = "https://jsierrahoopshype.github.io/nba-headshots/teams/logos/current/svg/";
const SILHOUETTE = "https://jsierrahoopshype.github.io/nba-headshots/fallbacks/player_silhouette.svg";

let seed = 20260822;
function rand() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }

const args = process.argv.slice(2);
if (args[0] !== "--local") {
  console.error("usage: node tools/build_vault.mjs --local <playerData> <headshotsMeta> <mvtData> <capCsv> <gamesCsv>");
  process.exit(1);
}
const [PD, HS, MVT, CAP_CSV, GAMES_CSV] = args.slice(1);

const readJson = p => JSON.parse(fs.readFileSync(p, "utf8"));
const money = n => "$" + Math.round(n).toLocaleString("en-US");
const num = v => { const n = parseFloat(String(v).replace(/[$,]/g, "")); return isNaN(n) ? 0 : n; };

function parseCsv(text) {
  // handles the quoted fields these exports use; no embedded newlines in them
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const split = line => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]);
  return lines.slice(1).map(l => {
    const cells = split(l), row = {};
    head.forEach((h, i) => { row[h] = cells[i] === undefined ? "" : cells[i]; });
    return row;
  });
}

const cards = [];
const push = (type, tab, tags, payload) =>
  cards.push({ id: `${type}-${cards.length + 1}`, type, tab, tags, payload });

/* ---------------- shared: headshots ---------------- */

const headMeta = readJson(path.join(HS, "players.json")).players || [];
const faceByName = new Map();
for (const p of headMeta) {
  if (p.headshot && p.headshot.face && p.headshot.filename) {
    faceByName.set(p.full_name, HEADSHOT_BASE + p.headshot.filename);
  }
}
const faceOf = name => faceByName.get(name) || SILHOUETTE;

/* ---------------- 1. salary cards ---------------- */

const salaries = readJson(path.join(PD, "salaries.json"));
const capRows = parseCsv(fs.readFileSync(CAP_CSV, "utf8"));
// "1997-1998" -> 1998, matching salaries.json YEAR (the season's ending year:
// Jordan's famous $33.14M is YEAR 1998 = the 1997-98 season).
const capByYear = new Map();
for (const r of capRows) {
  const end = parseInt(String(r.Season).split("-")[1], 10);
  const cap = num(r["Salary Cap"]);
  if (end && cap) capByYear.set(end, cap);
}
const seasonLabel = y => `${y - 1}-${String(y).slice(2)}`;

// award context: who was a genuine star that season (for bargain cards)
const awards = readJson(path.join(PD, "awards.json"));
const starSeason = new Set(); // "name|year"
const STAR_AWARDS = new Set(["All-Star", "All-NBA First Team", "All-NBA Second Team",
  "All-NBA Third Team", "Most Valuable Player", "Defensive Player of the Year", "Finals MVP"]);
for (const a of awards) {
  if (STAR_AWARDS.has(a.AWARD) && a.YEAR) starSeason.add(a["PLAYER / COACH"] + "|" + a.YEAR);
}

// team payrolls per season, used only where the roster looks complete
const payroll = new Map(); // "TEAM|YEAR" -> {total, n}
for (const r of salaries) {
  if (r.TEAM === "TOT" || !r.TEAM) continue;
  const k = r.TEAM + "|" + r.YEAR;
  const e = payroll.get(k) || { total: 0, n: 0 };
  e.total += num(r.SALARY); e.n++;
  payroll.set(k, e);
}

const withCap = [];
for (const r of salaries) {
  const year = parseInt(r.YEAR, 10);
  const cap = capByYear.get(year);
  const sal = num(r.SALARY);
  if (!cap || !sal || !r.PLAYER) continue;
  withCap.push({ player: r.PLAYER, team: r.TEAM, year, sal, cap, pct: sal / cap * 100 });
}
console.log(`salary rows with a cap figure: ${withCap.length} of ${salaries.length}`);

// (a) biggest cap shares of all time
const topShares = withCap.slice().sort((a, b) => b.pct - a.pct).slice(0, 60);
for (const s of topShares) {
  // how many full team payrolls that same season came in under this one salary
  const same = [...payroll.entries()]
    .filter(([k, v]) => k.endsWith("|" + s.year) && v.n >= 10)
    .map(([k, v]) => ({ team: k.split("|")[0], total: v.total }));
  const under = same.filter(t => t.total < s.sal && t.team !== s.team).length;
  // Left empty when there is nothing extra to say — the card already prints
  // the cap on its own line, so repeating it there reads as a duplicate.
  const note = under >= 1
    ? `That one salary was bigger than ${under} entire team payroll${under === 1 ? "" : "s"} that season.`
    : "";
  push("salary", ["vault"],
    { content_type: "salary", players: [s.player], teams: [s.team], era: `${s.year - (s.year % 10)}s`, category: "cap-share" },
    {
      player: s.player, img: faceOf(s.player), team: s.team,
      season: seasonLabel(s.year), salary: money(s.sal),
      cap: money(s.cap), cap_pct: Math.round(s.pct), note
    });
}

// (b) bargains: a star season on a small slice of the cap.
// Guards against selling a partial stint as a season: Allen Iverson's 3-game
// Memphis cameo is a $161,386 row in a season he was voted an All-Star, which
// would otherwise read as "an All-Star season for 0.3% of the cap". So the
// player must have exactly one team row that season AND have actually played
// a real number of games.
const stintsPerSeason = new Map(); // "name|year" -> count of team rows
for (const s of withCap) {
  const k = s.player + "|" + s.year;
  stintsPerSeason.set(k, (stintsPerSeason.get(k) || 0) + 1);
}
const rsStats = readJson(path.join(PD, "rsStats.json"));
const gamesPlayed = new Map(); // "name|year" -> GP
for (const r of rsStats) {
  const k = r.PLAYER + "|" + parseInt(r.YEAR, 10);
  gamesPlayed.set(k, Math.max(gamesPlayed.get(k) || 0, num(r.GP)));
}
const MIN_GP_FOR_BARGAIN = 40;
const bargains = withCap
  .filter(s => {
    const k = s.player + "|" + s.year;
    return starSeason.has(k) && s.pct <= 8 && s.sal > 0 &&
      stintsPerSeason.get(k) === 1 &&
      (gamesPlayed.get(k) || 0) >= MIN_GP_FOR_BARGAIN;
  })
  .sort((a, b) => a.pct - b.pct)
  .slice(0, 60);
for (const s of bargains) {
  push("salary", ["vault"],
    { content_type: "salary", players: [s.player], teams: [s.team], era: `${s.year - (s.year % 10)}s`, category: "bargain" },
    {
      player: s.player, img: faceOf(s.player), team: s.team,
      season: seasonLabel(s.year), salary: money(s.sal),
      cap: money(s.cap), cap_pct: Math.round(s.pct * 10) / 10,
      bargain: true,
      note: `An All-Star-level season for ${Math.round(s.pct * 10) / 10}% of the cap.`
    });
}
console.log(`salary cards: ${topShares.length} cap-share, ${bargains.length} bargain`);

/* ---------------- 2. ballot oddities ---------------- */

const AWARD_LABEL = {
  MVP: "MVP", DPOY: "Defensive Player of the Year", ROY: "Rookie of the Year",
  SMOY: "Sixth Man of the Year", MIP: "Most Improved Player",
  COY: "Coach of the Year", CPOY: "Clutch Player of the Year"
};
const SOLO_AWARDS = Object.keys(AWARD_LABEL);

const reporters = readJson(path.join(MVT, "reporters.json"));
const slugs = (reporters.reporters || reporters || []).map(r => r.slug || r);
const standings = new Map();  // award|season -> Map(player -> {pts, firsts, voters})
let ballotCount = 0;
for (const slug of slugs) {
  let rf;
  try { rf = readJson(path.join(MVT, "reporter", slug + ".json")); } catch (e) { continue; }
  for (const b of rf.ballots || []) {
    ballotCount++;
    const key = b.award + "|" + b.season;
    if (!standings.has(key)) standings.set(key, new Map());
    const m = standings.get(key);
    for (const pick of b.picks || []) {
      if (!m.has(pick.player)) m.set(pick.player, { pts: 0, firsts: 0, firstBy: [] });
      const e = m.get(pick.player);
      e.pts += num(pick.pts);
      if (String(pick.slot) === "1") { e.firsts++; e.firstBy.push(rf.voter); }
    }
  }
}
console.log(`ballot aggregates: ${slugs.length} reporters, ${ballotCount} ballots, ${standings.size} award-seasons`);

let oddities = 0;
for (const [key, m] of standings) {
  const [award, season] = key.split("|");
  if (!SOLO_AWARDS.includes(award)) continue;
  const rows = [...m.entries()].map(([player, e]) => ({ player, ...e })).sort((a, b) => b.pts - a.pts);
  if (rows.length < 3) continue;
  const winner = rows[0];
  const totalFirsts = rows.reduce((s, r) => s + r.firsts, 0);
  if (totalFirsts < 8) continue; // too few tracked ballots to call anything odd

  // lone first-place vote for someone who did not win
  for (const r of rows.slice(1)) {
    if (r.firsts === 1) {
      push("oddity", ["vault"],
        { content_type: "oddity", players: [r.player, winner.player], teams: [], era: seasonEra(season), category: "ballot-oddity" },
        {
          season, award: AWARD_LABEL[award],
          headline: `Exactly one voter put ${r.player} first for ${AWARD_LABEL[award]}`,
          detail: `${r.firstBy[0]} was the only tracked ballot with ${r.player} at No. 1 in ${season}. ` +
                  `${winner.player} took ${winner.firsts} of the ${totalFirsts} first-place votes.`,
          scope: `${totalFirsts} tracked first-place votes`
        });
      oddities++;
      break; // one per award-season keeps the feed varied
    }
  }

  // unanimous winner
  if (winner.firsts === totalFirsts && totalFirsts >= 15) {
    push("oddity", ["vault"],
      { content_type: "oddity", players: [winner.player], teams: [], era: seasonEra(season), category: "ballot-oddity" },
      {
        season, award: AWARD_LABEL[award],
        headline: `${winner.player} was unanimous for ${AWARD_LABEL[award]} in ${season}`,
        detail: `All ${totalFirsts} tracked first-place votes went to him. ` +
                `${rows[1].player} finished second with ${rows[1].pts} points and no first-place votes.`,
        scope: `${totalFirsts} tracked first-place votes`
      });
    oddities++;
  }
}
console.log(`ballot oddity cards: ${oddities}`);

function seasonEra(season) {
  const y = parseInt(season, 10);
  return isNaN(y) ? "2010s" : `${y - (y % 10)}s`;
}

/* ---------------- 3. on this day ---------------- */

const teamsMeta = readJson(path.join(HS, "..", "..", "teams", "metadata", "teams.json"));
const logoById = new Map(teamsMeta.map(t => [String(t.team_id), LOGO_BASE + String(t.team_id) + ".svg"]));
const abbrById = new Map(teamsMeta.map(t => [String(t.team_id), t.abbrev]));

const games = parseCsv(fs.readFileSync(GAMES_CSV, "utf8"));
const ROUND_RANK = { "NBA Finals": 100, "East - Conf. Finals": 80, "West - Conf. Finals": 80,
  "East - Conf. Semifinals": 60, "West - Conf. Semifinals": 60,
  "East - First Round": 40, "West - First Round": 40 };

// The seriesGameNumber column is not consistent across eras: recent rows say
// "Game 5", older rows carry a bare number that reads as "4.0". Normalize both
// to "Game N" so labels and the Game 7 bonus below work on every season.
function gameNo(g) {
  const raw = String(g.seriesGameNumber || "").trim();
  if (!raw) return "";
  if (/^game\s*\d+$/i.test(raw)) return "Game " + raw.replace(/\D+/g, "");
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? "Game " + Math.round(n) : "";
}

function gameScore(g) {
  const hs = parseInt(g.homeScore, 10), as = parseInt(g.awayScore, 10);
  if (!hs || !as) return null;
  const label = g.gameLabel || "";
  let rank = ROUND_RANK[label] || 0;
  if (!rank && g.gameType === "Playoffs") rank = 30;
  if (!rank && g.gameType === "All-Star Game") rank = 35;
  if (!rank && g.gameType === "Play-in Tournament") rank = 25;
  const combined = hs + as, margin = Math.abs(hs - as);
  // regular-season games earn their place by being extreme
  if (!rank) {
    if (combined >= 300) rank = 20 + (combined - 300) / 10;
    else if (margin >= 45) rank = 18 + (margin - 45) / 5;
    else if (margin === 1) rank = 8;
    else rank = 0;
  } else {
    const gn = gameNo(g);
    if (gn === "Game 7") rank += 9;
    else if (gn === "Game 6") rank += 4;
    if (margin <= 2) rank += 3;
  }
  return rank;
}

function story(g) {
  const hs = parseInt(g.homeScore, 10), as = parseInt(g.awayScore, 10);
  const homeWon = hs > as;
  const winCity = homeWon ? g.hometeamCity : g.awayteamCity;
  const winName = homeWon ? g.hometeamName : g.awayteamName;
  const margin = Math.abs(hs - as), combined = hs + as;
  const who = `${winCity} ${winName}`;
  if (margin === 1) return `${who} won it by a single point.`;
  if (combined >= 300) return `The two sides combined for ${combined} points.`;
  if (margin >= 45) return `${who} won by ${margin}.`;
  if (gameNo(g) === "Game 7") return `${who} took Game 7.`;
  if (margin <= 3) return `${who} held on by ${margin}.`;
  return `${who} won by ${margin}.`;
}

const byDate = new Map();
for (const g of games) {
  if (g.gameType === "Preseason") continue;
  const d = g.gameDate || "";
  if (d.length < 10) continue;
  const rank = gameScore(g);
  if (!rank) continue;
  const md = d.slice(5, 10);
  (byDate.get(md) || byDate.set(md, []).get(md)).push({ g, rank });
}

let otd = 0;
const PER_DATE = 8;
for (const [md, list] of byDate) {
  list.sort((a, b) => b.rank - a.rank);
  for (const { g } of list.slice(0, PER_DATE)) {
    const year = parseInt(g.gameDate.slice(0, 4), 10);
    const hs = parseInt(g.homeScore, 10), as = parseInt(g.awayScore, 10);
    const gn = gameNo(g);
    const label = g.gameLabel
      ? g.gameLabel + (gn ? " · " + gn : "")
      : (g.gameType === "Regular Season" ? "Regular season" : g.gameType);
    const att = parseInt(g.attendance, 10);
    push("otd", ["vault"],
      {
        content_type: "otd", players: [],
        teams: [abbrById.get(g.hometeamId), abbrById.get(g.awayteamId)].filter(Boolean),
        era: `${year - (year % 10)}s`, category: "on-this-day"
      },
      {
        date: md, year, label,
        home: abbrById.get(g.hometeamId) || g.hometeamName,
        home_name: `${g.hometeamCity} ${g.hometeamName}`.trim(),
        home_score: hs, home_logo: logoById.get(g.hometeamId) || "",
        away: abbrById.get(g.awayteamId) || g.awayteamName,
        away_name: `${g.awayteamCity} ${g.awayteamName}`.trim(),
        away_score: as, away_logo: logoById.get(g.awayteamId) || "",
        arena: g.arenaName || "",
        attendance: att && att > 0 ? att.toLocaleString("en-US") : "",
        story: story(g)
      });
    otd++;
  }
}
console.log(`on this day cards: ${otd} across ${byDate.size} calendar dates`);

/* ---------------- 4. bar chart race clips ---------------- */

// Races moved out of the Vault and into their own tab. tools/build_races.mjs
// owns them now and writes data/race-pool.json; emitting them here as well
// would put the same card in two pools under two ids.
//
// The old path read data/races/races.json (the MP4 manifest from
// tools/render_races.py). That renderer and its clips are left on disk
// untouched, but nothing in the app reads them any more.
console.log("bar chart race cards: owned by tools/build_races.mjs (data/race-pool.json)");

/* ---------------- write ---------------- */

const outPath = path.join(REPO, "data", "vault-pool.json");
fs.writeFileSync(outPath, JSON.stringify({
  generated: "vault build",
  note: "Every figure is computed from nba-player-data, media-vote-tracker and nba-attendance. Nothing estimated.",
  cards
}));
console.log(`wrote vault-pool.json: ${(fs.statSync(outPath).size / 1024).toFixed(0)} KB, ${cards.length} cards`);
