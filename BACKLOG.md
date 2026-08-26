# NBA Doomscroll — backlog

Everything agreed but not yet built, plus what is blocked and on whom. Ordered
within each section by Jorge's own stated priority. Items are removed when they
ship, not ticked — git history is the record of what happened.

Last reviewed: 2026-08-25.

---

## Next up

### Buzz follow-ups
The tab ships, but these calls are Jorge's:

- **Recency vs shuffle.** Buzz cards are sampled like everything else, so a
  four-hour-old item can sit under a two-day-old one. A news tab arguably wants
  newest-first. Would need a per-tab ordering mode in `loadMore()`.
- **Reddit RSS coverage is partial by construction.** The two subreddit feeds
  carry 100 entries each; anything in the 7-day index that is not in the week's
  top or the newest 100 keeps its ~280-character excerpt. Widening it means
  more feeds (`/hot`, `/top?t=month`) at one proxied request each.
- **The CORS proxy is now a shared dependency.** Buzz calls
  `nba-content-stream-cors` for Reddit bodies, one request per page load. The
  Worker was not changed and does not know about this caller; if its allowlist
  or URL ever moves, Buzz's Reddit cards quietly fall back to the short index
  excerpt and log why. Worth remembering when that Worker is next touched.
- **YouTube.** On, capped at 10, with descriptions suppressed (affiliate
  links), so the cards are a title and a thumbnail. Thin, and the items skew to
  Shorts. Worth deciding whether they earn their slot.
- **The 40% share is a hard floor.** Buzz holds 40% of every mixed batch
  regardless of what the reader's weights say. If someone skips every news card,
  the algorithm still serves them. Deliberate, and worth revisiting if it reads
  as pushy.
- **Pool depth and page weight.** The pool now comes from `feed.json` (1,000
  items over 7 days, 806KB) rather than `feed-recent.json` (100 items, 79KB),
  because without Google News the small file held almost nothing. It is fetched
  after the first screen paints, never before it, but it is the heaviest thing
  the app pulls after `vs-pool.json`. If it ever matters, the fix is upstream:
  a published index that is one file per source, or a smaller non-news slice.

---

## Asked for, not yet built

- **Weekly digest needs one Worker change.** The card is built and dormant.
  Full spec, contract and verification steps in `proposals/digest-weekly/`.
  Short version: `nba-trade-daily-digest` accepts `?days=N` and echoes `days` in
  the response; the card lights up on its own, no redeploy here.

- **Reddit video: not doing it, and the reason is not technical.** Bluesky video
  autoplays; Reddit will not, by decision rather than by limitation. The only
  public source of a playable v.redd.it URL is the JSON API that returns 403 to
  datacenter IPs — that 403 is Reddit deliberately closing the door, and routing
  around it is the thing most likely to cause the trouble Jorge said he does not
  want. Hotlinking v.redd.it media into a third-party page is separately outside
  what Reddit's terms contemplate, and DASH there splits video and audio into
  streams that need muxing anyway. If Reddit video is ever wanted, the sanctioned
  route is Reddit's own embed (`redditmedia.com/r/<sub>/comments/<id>/?embed=true`
  in an iframe): their player, their terms, their analytics — and no autoplay,
  which is rather the point of the sanctioning.
- **More video formats in the feed.** Teammates Score has shipped. Still to do,
  in Jorge's order: `nba-player-data/nba-comparison-video-generator.html` (reads
  the same rsStats/poStats/awards files the VS pool is built from, so it is
  mostly renderer work), then media-vote-tracker's award races (the ballot
  export is already in this repo). `nba-trade-video` is the awkward one — it
  gets its verdicts by driving the real Trade Machine in an iframe and holds no
  CBA logic of its own, so a feed version could only claim what the trade log
  proves, which the trade cards already say.
- **Teammates should be rebuilt on the shared face index — most of its 34
  missing stars were a matching bug, not a missing photo.** `build_teammates.mjs`
  has its own name matcher that folds diacritics but never lowercases, so
  `Kevin Mchale.png`, `Deandre Jordan.png`, `Demarcus Cousins.png`,
  `Zach Lavine.png`, `Tracy Mcgrady.png` and `Amar'e Stoudemire.png` all missed.
  `Faces.buildBcrIndex` (written for the pools) handles every one of them, plus
  the suffix trap. Swapping the matcher and rebuilding should recover most of
  the 34 and roughly 400 more possible matchups. Left alone for now because the
  current 700 are shipped and approved — this is a deliberate rebuild, not a
  side-effect of another task. Tim Hardaway stays out either way: the only file
  is his son's.

## Gamification

Parked once, then reopened. Proposal as pitched, unbuilt:

- **The Daily Five.** Five cards a day seeded from the date so everyone gets the
  same set: one quiz, one trivia, one ballot, one race, one from your
  top-weighted tag. Finishing increments a streak. Cheap — a deterministic
  sample from pools that already exist.
- **Solve quality.** `quiz.hintsUsed` is now recorded but unused. Score a
  no-hint solve 3, one hint 2, two hints 1, three hints 0, and surface
  "solved with no hints: 31%". Currently a no-hint solve and a three-hint solve
  look identical.
- **The 30-minute shot clock.** Jorge's original constraint. Implement as a
  visible filling ring, not a lockout: at 30 minutes the feed stops loading new
  batches and offers "That's your half." Dismissible — a hard lock on a public
  site just teaches people to open a private window.
- **Collections.** Race groups are already natural sets; watch all 30 franchise
  scoring races and you have toured the league. A set of slugs in localStorage.
  Gives the 180 team races a reason to be browsed rather than shuffled.

Explicitly **not** doing: leaderboards and global point totals. They need a
backend, which breaks the no-server promise the whole thing rests on.

---

## Races

- **Merge relocated franchises?** SEA and OKC are currently separate races
  because the stats file records the abbreviation of the day. Merging them is a
  judgement call, not a fact. Jorge's call.
- **Embed Futura Today.** The `hoopshype-official` port uses DM Sans; the theme
  loads Futura Today from `bar-chart-race/assets/fonts`. Would complete the
  port. Check the licence before shipping a webfont.
- **Headshots for the last gaps.** ~16 players who finish in a top 8 still have
  no photo in either source: Ewing, Kidd, Cheeks, Horry, Dennis Johnson, Bobby
  Jones, Frank Ramsey, K.C. Jones, Mark Eaton, Mark Jackson, Neil Johnston,
  Satch Sanders, Tommy Heinsohn, Jim Loscutoff, Derek Fisher, Bob McAdoo.
  Needs NBA person ids for retired players from an outside source.
- **Face tile weight.** 587 tiles, 6.0MB. Fine for the repo, but a PNG-8
  quantiser in `tools/lib/png.mjs` would roughly halve it if it ever matters.

---

## Content quality

- **Historical game cards are still thin.** Partly fixed: the one-point
  regular-season tier is gone and playoff games are ranked by round. But no repo
  has player box scores, so cards carry no top performer and the story line is
  still algorithmic ("won by one", "combined for X"). To get *"Jordan scored 55
  at Madison Square Garden"* needs a new source with game/player stats. Once
  connected: leading scorer, notable performance, series consequence.
- **Salary tool URL.** Salary cards point at `hoopsmatic.com/salary-season-finder`,
  which shows the Season Comparison Tool. Needs the correct URL. **Blocked on
  Jorge.**

---

## Blocked externally

- **Rumors Worker.** `proposals/rumors-endpoints/` is written and unshipped:
  two additive handlers on the existing `hoopshype-rumors-api` Worker plus a
  daily offline on-this-day index. Waiting on the editorial/Gannett decision
  about publishing 280-character archive excerpts through a public endpoint.
  Until then the Rumors tab shows an honest failure and links to HoopsHype.

---

## Done, for reference

Kept short so the list above stays the point.

- Races rewritten from MP4s to canvas; `hoopshype-official` theme ported
- 180 team races, Money group, colleges/clubs, countries, draft classes
- Headshots sourced from `bar-chart-race/assets/headshots`, baked at build time
- Trivia moved VS → Quiz; ballot formats rebuilt; progressive hints
- On This Day one-point regular-season tier cut (994 of 2,073 cards)
- Vault renamed History; type chips navigate; privacy badge demoted
- Invented rumor placeholders no longer rendered
- Clickable players and teams: tapping a name filters the whole feed to that
  entity across every section, with `?player=` / `?team=` routing, a filter
  strip and an empty state
- Buzz tab: today's NBA conversation, live from the Content Stream, filtered
  three ways (editorial blocklist, other-league words, require an NBA entity)
  and joined to the feed's own player and team names
- Silhouettes gone: 1,231 head tiles baked from `bar-chart-race`, VS / trivia /
  quiz pools built only from players who have a photograph, trade and History
  cards drawing initials rather than a grey outline when nobody does
