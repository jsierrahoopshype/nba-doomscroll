#!/usr/bin/env python3
"""Generate data/dummy-cards.json — the synthetic card pool used to build and
test the feed shell before real data sources are wired in (steps 3-5).

Card schema (shared by every type):
  id           stable string id (used for share links ?card=)
  type         trade | rumor | vs | trivia | quiz | salary | ballot | otd | race
  tab          list of tabs the card can surface in (foryou is implicit everywhere)
  tags         personalization tags: content_type, players, teams, era, category
  payload      type-specific display data
  dummy        true while the source is synthetic (real wiring replaces these)

Rumor text here is INVENTED placeholder content (never real archive data) —
it only mimics the real schema: archive_date / outlet / source_url / text /
quote / tags.

Usage: python3 tools/gen_dummy_cards.py  (run from repo root; needs the
nba-headshots players.json path below, or falls back to a built-in list)
"""

import json
import os
import random

random.seed(41)  # deterministic output

HEADSHOT_BASE = "https://jsierrahoopshype.github.io/nba-headshots/players/headshots/face/"
LOGO_BASE = "https://jsierrahoopshype.github.io/nba-headshots/teams/logos/current/svg/"
SILHOUETTE = "https://jsierrahoopshype.github.io/nba-headshots/fallbacks/player_silhouette.svg"

PLAYERS_JSON = os.environ.get(
    "PLAYERS_JSON",
    os.path.join(os.path.dirname(__file__), "..", "..", "ref", "nba-headshots", "players", "metadata", "players.json"),
)

TEAMS = {
    "ATL": "Atlanta Hawks", "BOS": "Boston Celtics", "BKN": "Brooklyn Nets",
    "CHA": "Charlotte Hornets", "CHI": "Chicago Bulls", "CLE": "Cleveland Cavaliers",
    "DAL": "Dallas Mavericks", "DEN": "Denver Nuggets", "DET": "Detroit Pistons",
    "GSW": "Golden State Warriors", "HOU": "Houston Rockets", "IND": "Indiana Pacers",
    "LAC": "LA Clippers", "LAL": "Los Angeles Lakers", "MEM": "Memphis Grizzlies",
    "MIA": "Miami Heat", "MIL": "Milwaukee Bucks", "MIN": "Minnesota Timberwolves",
    "NOP": "New Orleans Pelicans", "NYK": "New York Knicks", "OKC": "Oklahoma City Thunder",
    "ORL": "Orlando Magic", "PHI": "Philadelphia 76ers", "PHX": "Phoenix Suns",
    "POR": "Portland Trail Blazers", "SAC": "Sacramento Kings", "SAS": "San Antonio Spurs",
    "TOR": "Toronto Raptors", "UTA": "Utah Jazz", "WAS": "Washington Wizards",
}

# Legends without headshots (silhouette fallback) for cross-era content
LEGENDS = [
    ("Michael Jordan", "CHI", "1990s"), ("Magic Johnson", "LAL", "1980s"),
    ("Larry Bird", "BOS", "1980s"), ("Kareem Abdul-Jabbar", "LAL", "1970s"),
    ("Wilt Chamberlain", "PHI", "1960s"), ("Bill Russell", "BOS", "1960s"),
    ("Hakeem Olajuwon", "HOU", "1990s"), ("Shaquille O'Neal", "LAL", "1990s"),
    ("Tim Duncan", "SAS", "2000s"), ("Kobe Bryant", "LAL", "2000s"),
    ("Allen Iverson", "PHI", "2000s"), ("Dirk Nowitzki", "DAL", "2000s"),
    ("Charles Barkley", "PHX", "1990s"), ("Karl Malone", "UTA", "1990s"),
    ("Oscar Robertson", "MIL", "1960s"), ("Julius Erving", "PHI", "1970s"),
]

DUMMY_OUTLETS = ["Sample Ledger", "Placeholder Post", "Test Tribune", "Mock Gazette", "Demo Dispatch"]

def load_modern_players(n=40):
    try:
        with open(PLAYERS_JSON, encoding="utf-8") as f:
            data = json.load(f)
        pool = [p for p in data["players"] if p.get("headshot", {}).get("face")]
        random.shuffle(pool)
        out = []
        for p in pool[:n]:
            out.append({
                "name": p["full_name"],
                "team": p.get("team_abbrev") or "FA",
                "era": era_from(p.get("seasons_from", "2015")),
                "img": HEADSHOT_BASE + p["headshot"]["filename"],
                "nba_id": p["nba_id"],
            })
        return out
    except Exception:
        # minimal fallback so the generator always runs
        fallback = [("LeBron James", "LAL", "2010s", 2544), ("Stephen Curry", "GSW", "2010s", 201939),
                    ("Nikola Jokic", "DEN", "2020s", 203999), ("Jayson Tatum", "BOS", "2020s", 1628369)]
        return [{"name": n_, "team": t, "era": e, "img": SILHOUETTE, "nba_id": i} for n_, t, e, i in fallback]

def era_from(year_str):
    y = int(str(year_str)[:4])
    return f"{y - (y % 10)}s"

def tags(ctype, players=None, teams=None, era=None, category=None):
    return {
        "content_type": ctype,
        "players": players or [],
        "teams": teams or [],
        "era": era or "2020s",
        "category": category or ctype,
    }

cards = []
_id = 0
def add(type_, tab, tg, payload):
    global _id
    _id += 1
    cards.append({"id": f"dummy-{type_}-{_id}", "type": type_, "tab": tab,
                  "tags": tg, "payload": payload, "dummy": True})

modern = load_modern_players(40)

# ---------------- trades ----------------
for i in range(14):
    a, b = random.sample(list(TEAMS.keys()), 2)
    pa = random.sample([p for p in modern if p["team"] not in (b,)], random.choice([1, 1, 2]))
    pb = random.sample([p for p in modern if p["team"] not in (a,) and p not in pa], random.choice([1, 2]))
    sal_a = [round(random.uniform(3, 45), 1) for _ in pa]
    sal_b = [round(random.uniform(3, 45), 1) for _ in pb]
    tot_a, tot_b = sum(sal_a), sum(sal_b)
    balance = round(min(tot_a, tot_b) / max(tot_a, tot_b) * 100)
    verdict = ("Dead-even money" if balance >= 95 else
               "Salaries line up" if balance >= 85 else
               "Someone is stretching the rules")
    add("trade", ["trades"],
        tags("trade", [p["name"] for p in pa + pb], [a, b], "2020s", "trade-machine"),
        {"sides": [
            {"team": a, "team_name": TEAMS[a], "logo": LOGO_BASE + a.lower() + ".svg",
             "gets": [{"name": p["name"], "img": p["img"], "salary": s} for p, s in zip(pb, sal_b)]},
            {"team": b, "team_name": TEAMS[b], "logo": LOGO_BASE + b.lower() + ".svg",
             "gets": [{"name": p["name"], "img": p["img"], "salary": s} for p, s in zip(pa, sal_a)]},
        ], "balance_pct": balance, "verdict": verdict,
         "built_ago": random.choice(["2h ago", "5h ago", "yesterday", "2 days ago"])})

# ---------------- rumors (synthetic text only) ----------------
RUMOR_TEMPLATES = [
    ("{p} has 'real interest' in a reunion, league sources say", "There is mutual interest, but nothing is close."),
    ("Rival executives expect {t} to be aggressive at the deadline", "They have been calling around on almost everyone."),
    ("{p} declined to address free agency after the game", "I'm focused on this season. That's it."),
    ("{t} viewed as a sleeper destination for {p}", None),
    ("Front office meeting scheduled as {t} weigh a roster shakeup", None),
    ("{p} trade market described as 'lukewarm at best'", "You'd be surprised how few teams have called."),
]
for yr in [2012, 2014, 2016, 2018, 2019, 2021, 2022, 2023, 2024, 2025]:
    p = random.choice(modern + [{"name": n_, "team": t, "era": e, "img": SILHOUETTE} for n_, t, e in LEGENDS[:6]])
    t_abbr = random.choice(list(TEAMS.keys()))
    tmpl, quote = random.choice(RUMOR_TEMPLATES)
    text = "[SAMPLE DATA] " + tmpl.format(p=p["name"], t=TEAMS[t_abbr])
    add("rumor", ["rumors"],
        tags("rumor", [p["name"]], [t_abbr], era_from(str(yr)), "rumor-history"),
        {"archive_date": f"{yr}-08-10", "outlet": random.choice(DUMMY_OUTLETS),
         "source_url": "https://hoopshype.com/rumors/",
         "text": text, "quote": quote, "on_this_day": True, "years_ago": 2026 - yr})

# ---------------- vs (comparison) ----------------
for i in range(10):
    cross = i % 3 == 0
    if cross:
        l = random.choice(LEGENDS)
        p1 = {"name": l[0], "team": l[1], "era": l[2], "img": SILHOUETTE}
        p2 = random.choice(modern)
    else:
        p1, p2 = random.sample(modern, 2)
    s1, s2 = random.randint(38, 88), random.randint(38, 88)
    if s1 == s2: s2 += 3
    win = p1 if s1 > s2 else p2
    add("vs", ["vs"],
        tags("vs", [p1["name"], p2["name"]], [p1["team"], p2["team"]],
             p1["era"] if cross else "2020s", "comparison"),
        {"p1": {"name": p1["name"], "img": p1["img"], "team": p1["team"], "score": s1},
         "p2": {"name": p2["name"], "img": p2["img"], "team": p2["team"], "score": s2},
         "headline": f"{win['name']} takes it {max(s1,s2)}-{min(s1,s2)}",
         "sections": [
            {"label": "Accolades", "p1": random.randint(0, 12), "p2": random.randint(0, 12)},
            {"label": "Career averages", "p1": random.randint(2, 9), "p2": random.randint(2, 9)},
            {"label": "Career totals", "p1": random.randint(2, 9), "p2": random.randint(2, 9)},
            {"label": "Season peaks", "p1": random.randint(2, 9), "p2": random.randint(2, 9)}],
         "biggest_wins": [
            {"who": "p1", "stat": "All-NBA selections", "val": f"{random.randint(3,11)} vs {random.randint(0,2)}"},
            {"who": "p2", "stat": "Career 3PM", "val": f"{random.randint(1200,3200)} vs {random.randint(100,900)}"}],
         "compare_url": f"https://hoopsmatic.com/compare?p1={p1['name']}&p2={p2['name']}"})

# ---------------- trivia (two players, one stat) ----------------
STATS = ["points", "assists", "rebounds", "steals", "blocks", "3-pointers made", "games played", "triple-doubles"]
for i in range(8):
    p1, p2 = random.sample(modern + [{"name": n_, "team": t, "era": e, "img": SILHOUETTE} for n_, t, e in LEGENDS], 2)
    v1, v2 = sorted(random.sample(range(2000, 39000, 137), 2), reverse=True)
    stat = random.choice(STATS)
    add("trivia", ["vs"],
        tags("trivia", [p1["name"], p2["name"]], [p1["team"], p2["team"]], p1["era"], "trivia"),
        {"stat": stat, "question": f"Who has more career {stat}?",
         "a": {"name": p1["name"], "img": p1["img"], "value": v1},
         "b": {"name": p2["name"], "img": p2["img"], "value": v2},
         "answer": "a"})

# ---------------- quiz (guess the player silhouette) ----------------
DIFF = ["easy", "easy", "medium", "medium", "hard"]
for i in range(10):
    p = random.choice(modern)
    wrong = random.sample([m["name"] for m in modern if m["name"] != p["name"]], 3)
    opts = wrong + [p["name"]]
    random.shuffle(opts)
    add("quiz", ["quiz"],
        tags("quiz", [p["name"]], [p["team"]], p["era"], "guess-the-player"),
        {"img": p["img"], "options": opts, "answer": p["name"],
         "difficulty": DIFF[i % len(DIFF)],
         "hint": f"Plays for {TEAMS.get(p['team'], 'a mystery team')}"})

# ---------------- ballot trivia (quiz tab) ----------------
BALLOT_Q = [
    ("Which award did voters split hardest on in {y}?", ["MVP", "DPOY", "ROY", "MIP"], 0),
    ("How many first-place MVP votes went to the runner-up in {y}?", ["0", "3", "11", "27"], 2),
    ("Which outlet's voters most often backed the eventual MVP?", ["Sample Ledger", "Test Tribune", "Mock Gazette", "Demo Dispatch"], 1),
]
for i, yr in enumerate([2016, 2019, 2022, 2024]):
    q, opts, ans = BALLOT_Q[i % len(BALLOT_Q)]
    add("ballot", ["quiz", "vault"],
        tags("ballot", [], [], era_from(str(yr)), "ballot-trivia"),
        {"question": "[SAMPLE] " + q.format(y=yr), "options": opts, "answer_idx": ans,
         "season": f"{yr}-{str(yr+1)[2:]}"})

# ---------------- salary vault cards ----------------
SALARY_FACTS = [
    ("Michael Jordan", "CHI", 1998, 33.14, "1990s", "That was more than eight entire team payrolls that season."),
    ("Magic Johnson", "LAL", 1995, 14.66, "1990s", "A one-year balloon payment on a 25-year deal signed in 1984."),
    ("Larry Bird", "BOS", 1992, 7.07, "1990s", "The Celtics' whole payroll was under the 2026 mid-level."),
    ("Shaquille O'Neal", "LAL", 2000, 17.14, "2000s", "Signed for less than a modern role player's extension."),
    ("Tim Duncan", "SAS", 2015, 5.25, "2010s", "A top-15 player on a minimum-adjacent deal, by choice."),
    ("Allen Iverson", "PHI", 2005, 16.45, "2000s", "MVP-level production at mid-level-adjacent money."),
]
CPI_MULT = {1992: 2.26, 1995: 2.08, 1998: 1.95, 2000: 1.84, 2005: 1.62, 2015: 1.34}
for name, team, yr, m, era, blurb in SALARY_FACTS:
    add("salary", ["vault"],
        tags("salary", [name], [team], era, "salary-history"),
        {"player": name, "img": SILHOUETTE, "team": team, "year": yr,
         "salary": f"${m:.2f}M", "today": f"${m * CPI_MULT.get(yr, 1.5):.1f}M",
         "blurb": "[SAMPLE] " + blurb})

# ---------------- on this day games ----------------
OTD = [
    (1994, "NYK", 91, "HOU", 84, "NBA Finals Game 5", "Madison Square Garden"),
    (2010, "BOS", 92, "LAL", 86, "NBA Finals Game 4", "TD Garden"),
    (2016, "CLE", 93, "GSW", 89, "NBA Finals Game 7", "Oracle Arena"),
    (1980, "LAL", 123, "PHI", 107, "NBA Finals Game 6", "The Spectrum"),
    (2013, "MIA", 103, "SAS", 100, "NBA Finals Game 6", "AmericanAirlines Arena"),
]
for yr, h, hs, a, as_, label, arena in OTD:
    add("otd", ["vault"],
        tags("otd", [], [h, a], era_from(str(yr)), "on-this-day"),
        {"year": yr, "home": h, "home_name": TEAMS[h], "home_score": hs,
         "away": a, "away_name": TEAMS[a], "away_score": as_,
         "home_logo": LOGO_BASE + h.lower() + ".svg", "away_logo": LOGO_BASE + a.lower() + ".svg",
         "label": label, "arena": arena,
         "story": f"[SAMPLE] {TEAMS[h if hs > as_ else a]} closed it out in a game people still argue about."})

# ---------------- bar chart race placeholders ----------------
for title, cat in [("All-time scoring leaders, 1950-2026", "points"),
                   ("Career 3-pointers made, 1980-2026", "threes"),
                   ("Highest-paid player by season, 1991-2026", "salaries"),
                   ("MVP award shares, 1956-2026", "mvp")]:
    add("race", ["vault"],
        tags("race", [], [], "all-time", "bar-chart-race"),
        {"title": title, "category": cat, "mp4": None,
         "note": "Clip renders in step 5 — this is a placeholder card."})

# Only card types whose real data source is not wired yet stay in the dummy
# pool. vs / trivia / quiz / ballot went real in step 3 (tools/build_data.mjs);
# salary / otd went real in step 5 (tools/build_vault.mjs). Their synthetic
# versions are dropped so no sample card mixes into a tab running on real data.
# Bar chart race clips still need a render pipeline, so "race" stays here.
KEEP_TYPES = {"trade", "rumor", "race"}
cards = [c for c in cards if c["type"] in KEEP_TYPES]

out_path = os.path.join(os.path.dirname(__file__), "..", "data", "dummy-cards.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump({"generated": "dummy pool (types pending real data)", "cards": cards}, f, ensure_ascii=False, indent=1)
print(f"wrote {len(cards)} cards -> {os.path.abspath(out_path)}")
