# NBA Doomscroll

An endless, personalized feed of NBA content — a section of [HoopsMatic](https://hoopsmatic.com).

Static site, GitHub Pages deploy, no backend for users. A simple non-ML
personalization algorithm runs entirely in the browser: every card is tagged
(content type, players, teams, era, category) and likes/saves/tap-throughs
re-weight what surfaces next. All personalization data lives in localStorage
only, with JSON export/import.

## Tabs

For You (algorithmic mix) · Trades (community Trade Machine feed) · Rumors
(HoopsHype archive, on-this-day) · VS (player comparisons) · Quiz (guess the
player, two-player trivia, ballot trivia) · Vault (salary history, ballot
oddities, on-this-day games) · Races (bar chart races).

## Look and feel

Deliberately matches **NBA Content Stream**, which inherits the HoopsMatic /
Media Vote Tracker visual system: light `#f5f5f7` background, white rounded
cards, DM Sans body with JetBrains Mono meta rows, `#3b82f6` accent, boxed nav
tabs. Tokens in `css/styles.css` are copied from
`nba-content-stream/assets/styles.css` so the two features read as one product.
Per-card-type badges use the same treatment Content Stream gives its per-source
badges (colored dot, 10% tint). The one intentional divergence: Content Stream
is a 1100px browsing surface, this is a centered ~46rem reading column, because
it is a scroll feed.

## Repo layout

- `index.html` + `css/` + `js/` — the app (no framework, vanilla JS)
  - `js/engine.js` — personalization engine (weights, sampling, storage)
  - `js/cards.js` — card renderers
  - `js/app.js` — shell: tabs, infinite feed, interactions, panels
  - `js/compare-core.js` — comparison scoring, extracted verbatim from the
    HoopsMatic comparison tool so card scores match it exactly
  - `js/vs-score.js` — shared scorer replaying those rules over pre-resolved
    values; used by the pool builder AND the browser's live matchup
  - `js/live-vs.js` — the VS tab's "Random matchup" button
  - `js/share-image.js` — renders any card to a branded PNG on a canvas
  - `js/trades.js` — live Trade Machine feed: dedupes re-logged builds, keeps
    two-team deals, applies the 15% balance rule
  - `js/race-player.js` — canvas bar chart race player: 90-second runtime,
    eased rank and value transitions, headshot or initials disc per bar
- `data/vs-pool.json` — 2,000 pre-scored matchups (1,000 same-era, 1,000
  cross-era), filtered to competitive ones
- `data/vs-values.json` — per-player metric values for live scoring (~740KB
  instead of the 27MB the full comparison dataset would need)
- `data/quiz-pool.json` — Guess the Player, restricted to the 354 players with
  a verified headshot file, tiered easy/medium/hard by obscurity
- `data/trivia-pool.json` — "two players, one stat" with real career values.
  Lives on the Quiz tab: VS is for reading a comparison, Quiz is for taking a
  shot at one
- `data/ballot-pool.json` — ballot trivia from the public media-vote-tracker
  export (2013-14 onward). Three formats: who finished higher, who finished
  second, and who drew no votes at all. That last one is built for MVP and
  DPOY only, because every eligible player is in the running for those — asking
  who drew no Rookie of the Year votes just surfaces whoever was not a rookie.
  Questions that duplicate a Vault ballot-oddity card (same season, award and
  player) are dropped in the browser once both pools have loaded
- `data/vault-pool.json` — cap-share salary cards, auto-detected ballot
  oddities, on-this-day games and the bar chart race clip cards
- `data/race-pool.json` — one feed card per race, tagged with the players and
  teams that race actually puts on screen
- `data/races/index.json` + `data/races/r/*.json` — 30 races as data, ~11KB
  each, loaded one at a time when a card scrolls into view
- `data/races/*.mp4` + `data/races/races.json` — the old pre-rendered clips.
  Nothing reads them any more; left on disk rather than deleted as a
  side-effect. Safe to remove in a deliberate commit
- `data/dummy-cards.json` — fallback cards shown only when a live source is
  unreachable (rumor text in it is invented placeholder content, never archive
  data)
- `data/rumor-blocklist.json` — editable keyword blocklist for the Rumors
  editorial filter
- `tools/build_data.mjs` — rebuilds the VS / Quiz / Trivia / Ballot pools
- `tools/build_vault.mjs` — rebuilds the Vault pool
- `tools/build_races.mjs` — rebuilds the bar chart races
- `tools/render_races.py` — the old MP4 renderer, superseded by
  `build_races.mjs`; kept because it is the only thing that can still produce a
  standalone video file
- `tools/gen_dummy_cards.py` — regenerates the placeholder pool

## Rebuilding the data pools

    node tools/build_data.mjs --pages

Reads nba-player-data, nba-headshots and media-vote-tracker over GitHub Pages
(read-only, never writes to them) and rewrites the pools in `data/`. Runs
weekly via `.github/workflows/refresh-data.yml`, or on demand from the Actions
tab. Every build verifies the fast scorer against the real comparison engine on
120 random matchups and fails if they ever disagree.

## Rebuilding the Vault

    node tools/build_vault.mjs --local <nba-player-data> <nba-headshots/players/metadata> \
      <media-vote-tracker/docs/data> <salary_cap_info.csv> <Games.csv>

On demand rather than weekly: historical games and old salaries do not change.
Re-run after a season ends. Every figure on a Vault card is computed from those
files — salary cards state a share of that season's actual cap (from
salary-season-finder's cap table) rather than an inflation estimate, ballot
cards say "tracked ballots" because the tracker does not hold every ballot ever
cast, and game cards carry no top-performer line because no repo has player box
scores.

## Rebuilding the races

    node tools/build_races.mjs --local <nba-player-data> \
      <nba-headshots/players/metadata> <Games.csv>

Thirty races across seven groups: Career, Playoffs, Franchises, Countries,
Draft classes, Generations and Awards. Each writes `data/races/r/<slug>.json`
(labels, entities and the top 12 per season) plus one feed card in
`data/race-pool.json`. The browser animates them; no video is produced.

Two things worth knowing about the source data, both checked every build:

- **Champions** come from the winner of the last playoff game each season
  played. `gameLabel` is blank for every Finals from 1983 to 1996, and
  `awards.json`'s TEAM column on an "NBA Champion" row is the player's team,
  not the champion's — either source silently loses titles.
- **The 2020 bubble** ran July to October, so the usual "August onward belongs
  to next season" rule pushes it into 2021 and costs the Lakers a title. It is
  the only season in the file where that rule breaks.

- **A player's team** is the one they logged the most games for, not their last
  one. That is why LeBron's bar reads CLE. Most games keeps Jordan on CHI and
  Karl Malone on UTA, which is worth more than getting the two split careers to
  read the way a 2026 fan expects.

The build prints headshot coverage. It is low (about 5% of bar slots) because
nba-headshots holds active rosters only; every other bar draws an initials
disc. Retired players do have NBA CDN ids in `player-headshots.json`, so
re-running that repo's fetch pipeline over the full name map would raise it a
lot — that is a change to another repo and has not been made.

## Local dev

From the repo root: `python -m http.server 8000` then open
http://localhost:8000/ (fetch() needs a server, file:// won't load the JSON).

## Status

All six steps built. Trades run live off the Trade Machine log; VS, Quiz and
Vault run on real data; every card shares as a link or a branded PNG. Rumors
have their client written and waiting on the Worker endpoints in
`proposals/rumors-endpoints/`.

Known next: rumors are still waiting on the Worker endpoints, and the race
headshot coverage above is the one visible gap.
