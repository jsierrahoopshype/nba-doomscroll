# NBA Doomscroll

An endless, personalized feed of NBA content — a section of [HoopsMatic](https://hoopsmatic.com).

Static site, GitHub Pages deploy, no backend for users. A simple non-ML
personalization algorithm runs entirely in the browser: every card is tagged
(content type, players, teams, era, category) and likes/saves/tap-throughs
re-weight what surfaces next. All personalization data lives in localStorage
only, with JSON export/import.

## Tabs

For You (algorithmic mix) · Trades (community Trade Machine feed) · Rumors
(HoopsHype archive, on-this-day) · VS (player comparisons + trivia) · Quiz
(guess the player, ballot trivia) · Vault (salary history, ballot oddities,
on-this-day games, bar chart races).

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
- `data/vs-pool.json` — 2,000 pre-scored matchups (1,000 same-era, 1,000
  cross-era), filtered to competitive ones
- `data/vs-values.json` — per-player metric values for live scoring (~740KB
  instead of the 27MB the full comparison dataset would need)
- `data/quiz-pool.json` — Guess the Player, restricted to the 354 players with
  a verified headshot file, tiered easy/medium/hard by obscurity
- `data/trivia-pool.json` — "two players, one stat" with real career values
- `data/ballot-pool.json` — ballot trivia from the public media-vote-tracker
  export (2013-14 onward)
- `data/dummy-cards.json` — synthetic cards for the types whose sources are
  not wired yet: trades, rumors, vault (rumor text in it is invented
  placeholder content, never archive data)
- `data/rumor-blocklist.json` — editable keyword blocklist for the Rumors
  editorial filter
- `tools/build_data.mjs` — rebuilds every real pool from public data
- `tools/gen_dummy_cards.py` — regenerates the placeholder pool

## Rebuilding the data pools

    node tools/build_data.mjs --pages

Reads nba-player-data, nba-headshots and media-vote-tracker over GitHub Pages
(read-only, never writes to them) and rewrites the pools in `data/`. Runs
weekly via `.github/workflows/refresh-data.yml`, or on demand from the Actions
tab. Every build verifies the fast scorer against the real comparison engine on
120 random matchups and fails if they ever disagree.

## Local dev

From the repo root: `python -m http.server 8000` then open
http://localhost:8000/ (fetch() needs a server, file:// won't load the JSON).

## Status

Step 3 of 6 complete. VS, Quiz and the trivia/ballot card types run on real
public data; Trades, Rumors and Vault still use placeholder cards pending
their sources (steps 4-5). Share images and polish land in step 6.
