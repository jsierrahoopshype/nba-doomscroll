# NBA Doomscroll — backlog

Everything agreed but not yet built, plus what is blocked and on whom. Ordered
within each section by Jorge's own stated priority. Items are removed when they
ship, not ticked — git history is the record of what happened.

Last reviewed: 2026-08-25.

---

## Next up

### Buzz follow-ups
The tab ships, but these calls are Jorge's:

- **Reddit.** It is on, capped at 12. The items are good (statistical posts,
  archive finds) but the author line is a Reddit username on a HoopsHype-adjacent
  page. One flag in `data/buzz-sources.json` turns it off.
- **Recency vs shuffle.** Buzz cards are sampled like everything else, so a
  four-hour-old item can sit under a two-day-old one. A news tab arguably wants
  newest-first. Would need a per-tab ordering mode in `loadMore()`.
- **Bluesky avatars.** The cards carry initials, not faces. Content Stream
  fetches avatars live from the Bluesky AppView (`public.api.bsky.app`, through
  a CORS proxy). Matching it means a new external API dependency, which needs
  Jorge's go-ahead first.
- **Quoted posts.** A Bluesky post that quotes another post renders here as the
  text alone. The quote is not in the published index — Content Stream gets it
  from the live API — so this is blocked on the same call as avatars, or on
  `nba-content-stream` publishing `quotedPost` in its index files.
- **The 40% share is a hard floor.** Buzz holds 40% of every mixed batch
  regardless of what the reader's weights say. If someone skips every news card,
  the algorithm still serves them. Deliberate, and worth revisiting if it reads
  as pushy.
- **Pool depth.** At 40% of an eight-card batch, a ~40-card pool lasts about ten
  batches before the share quietly drops off. The per-source caps in
  `data/buzz-sources.json` are the lever.

---

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
