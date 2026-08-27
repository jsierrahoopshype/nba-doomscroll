# NBA Doomscroll

An endless, personalized feed of NBA content — a section of [HoopsMatic](https://hoopsmatic.com).

Static site, GitHub Pages deploy, no backend for users. A simple non-ML
personalization algorithm runs entirely in the browser: every card is tagged
(content type, players, teams, era, category) and likes/saves/tap-throughs
re-weight what surfaces next. All personalization data lives in localStorage
only, with JSON export/import.

## Tabs

For You (algorithmic mix) · Buzz (today's NBA conversation, live from the
Content Stream) · Trades (community Trade Machine feed) · Rumors (HoopsHype
archive, on-this-day) · VS (player comparisons) · Quiz (guess the player,
two-player trivia, ballot trivia) · History (salary history, ballot oddities,
on-this-day games) · Races (bar chart races).

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
  - `js/engine.js` — personalization engine (weights, sampling, storage).
    `sampleMixed` takes a `share` option: live Buzz cards hold a reserved 40%
    of every mixed batch, woven through it rather than stacked at the top.
    Without the reserve the weighted draw damps thin pools, and ~40 live items
    against thousands of archive cards is a thin pool
  - `js/cards.js` — card renderers
  - `js/app.js` — shell: tabs, entity filter, infinite feed, interactions,
    panels
  - `js/compare-core.js` — comparison scoring, extracted verbatim from the
    HoopsMatic comparison tool so card scores match it exactly
  - `js/vs-score.js` — shared scorer replaying those rules over pre-resolved
    values; used by the pool builder AND the browser's live matchup
  - `js/live-vs.js` — the VS tab's "Random matchup" button
  - `js/share-image.js` — renders any card to a branded PNG on a canvas
  - `js/trades.js` — live Trade Machine feed: dedupes re-logged builds, keeps
    two-team deals, applies the 15% balance rule. Each card deep-links back to
    its own trade in the machine (`?t=&p=&pd=`, the machine's own share
    format); trades containing picks fall back to the empty tool, because the
    log records "2027 #14 pick" and that cannot be re-encoded. It also emits
    one TRADE TRENDS card: who the whole log is moving and where to, counted
    over deduped deals rather than log rows. And one DAILY DIGEST card from
    `nba-trade-daily-digest`, the same Worker and the same numbers behind
    nba-trade-card: the most-traded player of the last 24 hours computed
    server-side over the whole log, his destinations and the pieces coming
    back. Every row on it is a link that BUILDS that trade — `?loop=1&player=X`,
    `&to=Team` for a destination, `player=X,Y` for a swap — so nothing sends a
    reader to an empty search box. A WEEKLY DIGEST card renders from the same
    endpoint with `?days=7`, but only if the response declares its window
    (`days`, `period` or `window_hours`): a Worker that ignores an unknown
    parameter would otherwise return the same 24-hour numbers and the card
    would label them as a week
  - `js/buzz.js` — the Buzz tab: reads nba-content-stream's published
    `trending.json` and `feed.json` in the reader's browser, filters them, and
    translates entity slugs into the names the rest of the feed uses. Bluesky
    items render as posts (avatar, author, the text as written, the attached
    image / video poster / link card, the quoted post), ported from Content
    Stream's own `renderCard`. Those posts are then enriched from Bluesky's
    public AppView (`public.api.bsky.app`, no auth, no proxy, one request per
    25 posts) for the full text, facets, avatars and quotes, and Reddit posts
    from r/nba's RSS through the CORS proxy Worker nba-content-stream already
    runs, for the full post body. Reddit's JSON API 403s from a datacenter IP;
    RSS is not gated, and two subreddit feeds carry up to 100 entries each,
    keyed by the same fullname the index uses. Both enrichments are
    best-effort, with a timeout, falling back to the index alone
  - `js/bsky-video.js` — Bluesky video autoplay: muted, inline, looping, one
    clip at a time, the one nearest the middle of the screen. Safari plays HLS
    natively; everyone else lazily loads `js/vendor/hls.light.min.js`
    (hls.js 1.7.1, Apache-2.0, licence beside it) the first time a video card
    is about to be seen. Switched off entirely by prefers-reduced-motion,
    prefers-reduced-data or Save-Data, and every failure path leaves the poster
    and the tap-through exactly as they were
  - `js/mates-player.js` — Teammates Score head-to-head: a scoreboard of two
    running totals over a season-by-season list of each man's decorated
    teammates, ported from hh-teammates' video generator. Same control contract
    as the race player, so app.js drives both through one lifecycle
  - `js/race-player.js` — canvas bar chart race player: a port of the
    bar-chart-race repo's `hoopshype-official` theme, 90-second runtime, eased
    rank and value transitions
- `data/vs-pool.json` — 1,924 pre-scored matchups (924 same-era, 1,000
  cross-era), filtered to competitive ones and to players who have a photograph
- `data/vs-values.json` — per-player metric values for live scoring (~500KB
  instead of the 27MB the full comparison dataset would need). Photographed
  players only, so the browser's live random matchup cannot put on screen what
  the pool no longer can
- `data/faces/*.png` + `data/faces/index.json` — 1,231 square head tiles, baked
  from `bar-chart-race/assets/headshots` and framed on the measured head. The
  manifest is what the pools are gated on, and it is why the weekly `--pages`
  rebuild keeps the gate without cloning 277MB of source PNGs
- `data/compare-pool.json` + `data/compare/*.json` — 1,500 head-to-head
  matchups drawn from the 201 All-Stars since 1984 who have a photograph, each
  with every metric that awards a point, revealed one at a time. Disjoint from
  `vs-pool.json` on purpose: the same pairing as both a static card and an
  animated one on one scroll reads as a bug. The rows come straight out of
  `js/vs-score.js`, so a card ends on the number hoopsmatic.com/compare gives
- `data/quiz-pool.json` — Guess the Player, restricted to the 1,078 players with
  a real photograph, tiered easy/medium/hard by obscurity
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
- `data/teammates-pool.json` + `data/teammates/*.json` + `data/teammates/faces/*.png`
  — 700 Teammates Score matchups: who had the better help, scored off the
  accolades a player's TEAMMATES won beside him (MVP 10, All-NBA 1st 4,
  All-Star 1, down to 0.125). One ~4KB step file per matchup, loaded when the
  card scrolls into view, plus a 128px head tile per player. Built by
  `tools/build_teammates.mjs` from hh-teammates' 5.4MB `teammates.json`. The
  101 players are every star whose career reaches 1984 or later with eight-plus
  seasons, enough awards for the question to mean something, AND a real
  headshot — every card here has two faces on it
- `data/vault-pool.json` — cap-share salary cards, auto-detected ballot
  oddities and on-this-day games. Races moved to their own pool and tab
- `data/race-pool.json` — one feed card per race, tagged with the players and
  teams that race actually puts on screen
- `data/races/index.json` + `data/races/r/*.json` — 215 races as data, ~12KB
  each, loaded one at a time when a card scrolls into view
- `data/races/faces/*.png` + `data/races/logos/*.png` — the headshot and logo
  tiles the races draw, baked at build time
- `data/dummy-cards.json` — fallback cards for trades and races only. The rumor
  entries in it are never rendered: an invented trade is self-evidently
  hypothetical, an invented rumor is a fake NBA report sitting next to
  HoopsHype, and a SAMPLE label does not survive a screenshot. When the rumor
  endpoint is unreachable the tab says so and links to HoopsHype instead
- `data/rumor-blocklist.json` — editable keyword blocklist for the Rumors
  editorial filter, applied to Buzz as well
- `data/buzz-sources.json` — the Buzz editorial config: which sources are on,
  their caps, how much body text each may render, the other-league word list,
  the require-an-NBA-entity rule, and the Bluesky enrichment switch. Edit this
  rather than `js/buzz.js`. Google News is currently **off**: `on: true` brings
  it back, and `outlet_allow: ["HoopsHype"]` would bring back only HoopsHype's
  own stories
- `data/buzz-map.json` — Content Stream entity slug → the display name or team
  abbreviation every other card here is tagged with, so Buzz cards personalize
  and cross-match. Built by `tools/build_buzz_map.mjs`
- `tools/build_data.mjs` — rebuilds the VS / Quiz / Trivia / Ballot pools
- `tools/build_vault.mjs` — rebuilds the Vault pool
- `tools/build_races.mjs` — rebuilds the bar chart races
- `tools/render_races.py` — the old MP4 renderer, superseded by
  `build_races.mjs`. Kept because it is the only thing here that can still
  produce a standalone video file; its output is no longer committed
- `tools/gen_dummy_cards.py` — regenerates the placeholder pool
- `tools/build_teammates.mjs` — rebuilds the Teammates Score matchups. Pairs
  every qualifying star with every other one (5,050 combinations from 101
  players), ranks them by the weaker half's fame plus whether the two shared a
  league, and keeps the best 700 with no player in more than 14. Head tiles are
  cut square around the measured head, never stretched
- `tools/build_buzz_map.mjs` — rebuilds `data/buzz-map.json` from
  nba-content-stream's canonical files. Only needs re-running when players
  enter the league

## Rebuilding the data pools

    node tools/build_data.mjs --pages

Reads nba-player-data, nba-headshots and media-vote-tracker over GitHub Pages
(read-only, never writes to them) and rewrites the pools in `data/`. Runs
weekly via `.github/workflows/refresh-data.yml`, or on demand from the Actions
tab. Every build verifies the fast scorer against the real comparison engine on
120 random matchups and fails if they ever disagree, and fails again if a VS or
trivia card comes out carrying a silhouette.

`--pages` reads the committed `data/faces/index.json` and bakes nothing. To
re-bake the face tiles — after a new photo lands in bar-chart-race, or to widen
the pools — run the local form with the headshots directory as a fourth
argument:

    node tools/build_data.mjs --local <nba-player-data> \
      <nba-headshots/players/metadata> <media-vote-tracker/docs/data> \
      <bar-chart-race/assets/headshots>

Without that fourth argument nothing is re-baked and the committed manifest is
reused, which is the same thing `--pages` does.

## Rebuilding the Comparison cards

    node tools/build_compare.mjs --local <nba-player-data>

Reads `data/vs-values.json` and `data/vs-pool.json` from this repo, plus
nba-player-data's `awards.json` for All-Star selections and `rsStats.json` for
career spans. Re-run it after `tools/build_data.mjs`, since it excludes pairings
the VS pool has just claimed. The build fails if any card's rows do not add up
to the final score it prints.

Pairings are chosen round-robin rather than by weighted draw. A weighted draw
plus a competitiveness filter produced the opposite of what the card needs:
LeBron James appeared twice in the whole pool and Bradley Beal twenty-two times,
because the best players fail a competitiveness test against almost everybody.
Every player now gets a turn, matched against the nearest players in All-Star
standing, and the lopsidedness a result is allowed to have scales with how
decorated the pair is.

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
      <nba-headshots repo root> <Games.csv> \
      [salary-season-finder/data_sources/bio.csv] \
      [bar-chart-race/assets/headshots]

215 races across ten groups: Career, Playoffs, Franchises, Countries, Draft
classes, Generations, Colleges & clubs, **Teams**, **Money** and Awards.

The Teams group is the bulk of them: 30 franchises x 6 measures (points,
rebounds, assists, 3PM, games, and money earned in that uniform). Rows are
filtered on the TEAM column, so a player is credited only for what he did in
that shirt — Shaq's Lakers points do not follow him to Miami. Relocations keep
their abbreviations separate (SEA and OKC are different races) because the
stats file records the abbreviation of the day, and merging them is a judgement
call rather than a fact. The last
group needs the optional bio.csv: no repo's bio.json carries a college, but the
CSV salary-season-finder builds from has a COLLEGE / TEAM column covering 5,079
of the 5,105 players in rsStats. It holds a college for Americans and the pro
club they left for international players, which is why those races are titled
"college or club" rather than "college". Each writes `data/races/r/<slug>.json`
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

### Look

`js/race-player.js` is a port of the `hoopshype-official` theme from the
bar-chart-race repo (`src/bar_race/themes.py` line 969 plus the draw loop in
`src/bar_race/render.py`), so a race in the feed reads as the same product as a
rendered clip: `#1a1a1a` panel, bar radius 6 with a 1px border lightened 20%, a
highlight strip on the top 30% of each bar, labels inside the bar with the name
left-anchored and never truncated, the value right-aligned at the bar end, a
left-to-right dark gradient under the label, and the season bottom-right. The
one thing not ported is the typeface: that theme loads Futura Today from the
repo's `assets/fonts`, this uses the site's DM Sans.

### Headshots and logos

The fifth argument points at `bar-chart-race/assets/headshots`, and it is worth
passing. That directory holds 5,082 PNGs keyed by plain player name and covers
Wilt, Russell, Bird, West, Havlicek, Mikan and Unseld — none of whom any other
repo can resolve. Files under 15KB are NBA CDN silhouette placeholders and are
skipped, the same rule `render.py` applies.

Each one is baked into `data/races/faces/` as the tile the theme actually
draws — top 80% of the source, squashed to 1.4:1 landscape, 140x100 — by
`tools/lib/png.mjs`, a small PNG decode/resize/encode on Node's own zlib. That
turns ~55KB portraits into ~16KB tiles and leaves the browser nothing to crop.
Team logos come from the same repo's `assets/logos/` into `data/races/logos/`.
Neither needs an npm install and neither is fetched at build time.

Coverage across bar slots in player races is about 32% once the team races pull
in several hundred more role players; on the marquee all-time races it is far
higher. A bar with no photo is drawn as a bare bar,
deliberately: a stand-in initials disc read worse than nothing.

`nba-headshots` stays as a fallback. Pass its **repo root**, not
`players/metadata`: its `players.json` describes 572 face crops while the repo
ships 1,785, so reading the metadata alone was why coverage once read 5%.
`tools/lib/faces.mjs` reads the file listing instead, and screens
`player-headshots.json`, which points some fathers at their sons' photos
("Larry Nance" -> `1626204-larry-nance-jr`) and reuses 22 of its NBA ids across
two different players (Ray Allen and Alonzo Mourning are both 951). A mapped
file is accepted only when the slug matches the slugified name.

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
