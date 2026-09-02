# NBA Doomscroll — backlog

Everything agreed but not yet built, plus what is blocked and on whom. Ordered
within each section by Jorge's own stated priority. Items are removed when they
ship, not ticked — git history is the record of what happened.

Last reviewed: 2026-08-29.

---

## Next up

### Buzz follow-ups
The tab ships, but these calls are Jorge's:

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

## The August 30 programme

A twenty-two point brief, being worked in tranches. Shipped so far is tranche
one; the rest is listed here so the order is a decision rather than whatever
came to hand.

**Shipped:** content-aware pacing, community-trade framing, the ALL_POOLS
entity bug, stale copy, the global media coordinator, the Guess the Player
image.

**Next, roughly in order of value over risk:**

- **YouTube autoplay is a decision waiting on Jorge.** Playback ships (see
  Done) but is click-to-play: `sources.youtube.autoplay` in
  data/buzz-sources.json flips it. Off by default because embedding YouTube's
  player loads a third-party player that profiles the reader, and starting that
  automatically, before anyone asked for a video, is a consent question rather
  than a playback one. Both modes are verified working; this is an editorial
  call, not an unfinished feature.
- **Reddit playback** still needs a playable URL the Content Stream index does
  not carry, and the standing decision against scraping it holds (see below).
- **Frivolities: the builder is written, the pool is Jorge's to make.** Run
  `node tools/build_frivolities.mjs` for a dry run (it finds the archive
  itself), `--sample` to read three finished cards, `--write` to ship. The
  first real dry run found a subject-naming bug, now fixed and covered by
  `tools/test_frivolities_naming.mjs` — re-run `--sample` and read three more
  before writing anything. It refuses to
  write by default because the pool carries archive excerpts. Tested against a
  synthetic archive only; the real distributions (how many outlets, how many
  distinct players per era) will differ and some thresholds may want moving.
  Two that are most likely to need it: `MIN_ERA_POOL` (12 distractors before an
  era can be used) and `MAX_PER_SUBJECT` (6).
- **Quality and repetition control: coverage is done, tuning is not.**
  `js/story.js` now derives `story_key`, `story_family` and, where an honest
  signal exists, `quality_score` for every card type at load time — see Done.
  What is left is judgement, not plumbing: `mates` and `vs` carry no quality
  because nothing on those cards measures "is this interesting" in one
  direction, and the `race` tiers are the builder's opinion rather than a
  measurement. If any of that reads wrong on the live feed, the numbers are all
  in one file.
- **Central link registry** and an automated link-health test that checks
  destination identity, not just a 200.
- **The weekly top 25 says rank and share, and nothing else** — see Done. The
  Worker computes destinations and return pieces for the number one only, so
  ranks 2 to 25 cannot show them. Giving those cards the same depth as the
  digest card means teaching `computeDigest` to return a per-player breakdown,
  which is a Worker change and a deploy.
- **Headshot normalisation**, the rest of it: per-player crop overrides and a QA
  contact sheet. The aspect-ratio bug underneath it is fixed (see Done), so what
  is left is the framing — some sources sit high in the frame, some low, and the
  80% crop is the same for all of them.
- **`build_races.mjs` cannot see an accented headshot filename.** `tileFor` looks
  up `BCR_FACES/<name>.png` using the name as it appears in the race data, which
  is plain ASCII, while the file on disk is `Jusuf Nurkić.png`. Those players
  fall through to the remote `nba-headshots` URL instead of getting a baked tile.
  `retile_faces.mjs` folds diacritics and matches them; the builder still does
  not. Not urgent (the fallback works) and deliberately not fixed as a
  side-effect of the retile work — it changes what a race build emits.
- **Race library expansion**: franchise career races, earnings groupings.

---

## Asked for, not yet built

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
- **`nba-trade-video` is the last port, and the case against it stands.** It
  gets its verdicts by driving the real Trade Machine in an iframe and holds no
  CBA logic of its own, so a feed version could only claim what the trade log
  already proves — which the trade cards say already. Teammates Score, the
  Comparison card and the award vote races have all shipped.
- **`build_lean.mjs` reads whichever media-vote-tracker you point it at, and
  there are two.** `media-vote-tracker-build_PRIVATE` is the one the shipped
  data comes from: 99 players, 13 countries. `media-vote-tracker_PUBLIC` builds
  clean and produces 92 players, 10 countries, and different figures for the
  same reporters — not a subset, a different dataset. A search-and-build loop
  matched both and the second silently overwrote the first. Always pass the
  private path explicitly:

      node tools\build_lean.mjs --local "C:\Users\Jorge Sierra\Desktop\GITHUB-UPLOAD\media-vote-tracker-build_PRIVATE\media-vote-tracker\docs\data"

  A correct run says 99 players and "13 committed locally, 0 falling back to
  flagcdn". 92 means it read the public one.

- **Oceania stays out, and the reason is the ballot count, not the voter floor.**
  The region floor was two voters, which read like the thing excluding it. It
  was not. Lowering it to one changed nothing: the electorate's only Oceania
  voter is Olgun Uluc of ESPN Australia, 18 ballots across two seasons, and his
  largest sample on any single player is 9 — under the 12-ballot region floor
  every region has to clear. media-vote-tracker's own reporter record marks him
  `low_sample: true`. Showing Oceania therefore means dropping the ballot floor
  to 9 for one reporter the source data itself flags, which is Jorge's call and
  not a recommendation. What did change: a region carried by one voter now has
  to say so in its own label, and the build fails if one ever ships without
  that, so if the dataset ever grows an Oceania row it arrives honest.

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

## Upstream, small

- **Frivolities `which-team` blanks whatever team the text names, which is not
  always the subject's.** A card asks "Which team was this?" over "in the 4th
  quarter of their game against the █████" — the blank is the OPPONENT, and
  answering means recalling one specific broadcast. The question wording covers
  both readings, and the excerpt usually disambiguates ("against the ..."), so
  these are hard rather than broken. Making them consistently fair means either
  wording the question from the sentence around the blank, or only accepting
  blanks that follow "with the" / "for the". Worth measuring before choosing.
- **Archive text loses paragraph breaks upstream.** "for some odd reasonIn the
  4th quarter" — a lowercase letter straight against a capital, with no
  punctuation between. Sentence-punctuation seams are repaired at build time
  now; this one is not, because NBA names share the shape (McGee, DeRozan,
  LaMelo) and breaking a name to tidy a sentence is the worse trade. The real
  fix is in whatever strips the HTML in the archive pipeline.

- **`who-is-this` distractors do not know who played with whom.** They are
  drawn from the same era, which is better than random and not as good as it
  could be: a teammate is a harder and fairer distractor than a stranger from
  the other conference. The career-team index that now filters `which-team`
  distractors (see Done) has the data to do this too — same file, same load.

- **The Frivolities `which-outlet` family can point at the wrong outlet.** A
  dry-run sample asked which outlet reported a Stephen Jackson story whose text
  says "in a lengthy sit-down interview with Grantland's Bill Simmons"; the
  answer was San Antonio Express-News, the blog that wrote it up, and Grantland
  was not even an option. Defensible but unfair: the excerpt names an outlet
  that is not the answer. The fix is to reject an item whose text names any
  outlet other than the answer, which needs an outlet vocabulary the builder
  does not currently have. Not fixed with the naming bug because it is a
  different guard and wants measuring against the real archive first.

- **Check one apostrophe name on a Teammates link.** The slug rule turns
  "Shaquille O'Neal" into `shaquille-o-neal`. If the tool expects
  `shaquille-oneal` instead, those pairings link to nothing — one card is
  enough to tell, and it is one line in `nameSlug` either way.

- **`salaries.json` duplicates its 2026 rows.** 117 player-seasons list one full
  salary under two teams, using full city names ("LA Lakers") where every other
  season uses abbreviations ("LAL"). LeBron James appears at $52,627,153 on both
  the Lakers and Philadelphia. `build_salary.mjs` works around it - identical
  amounts are one salary listed twice, differing amounts are a real mid-season
  trade - but the workaround costs those seasons their payroll cards, because
  there is no way to know whose book a man was on. Worth fixing at the source in
  `nba-player-data`.

- **`bio.json` has no college**, so "career earnings by college" - which the
  brief asked for and which would be a good card - cannot be built. NATIONALITY
  and DRAFT are there, and both shipped. A college field on bio, or a join
  against `combine-v3.json`, would unlock it.


- **The Media Vote Tracker has no award/season deep link.** Oddity CTAs point at
  `player.html?p=<slug>` and `reporter.html?v=<slug>`, which exist and are a
  large improvement on the front page, but a card about the 2020-21 MVP ballot
  cannot open that ballot. A `?award=&season=` filter on the tracker would let
  every ballot-derived card land on exactly what it is describing. Separate
  repo, so Jorge's call.

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

- The weekly top 25 most-traded players, one card each (`traderank`). Built
  client-side from the weekly digest's `topPlayers`, so no Worker change: 24
  cards for ranks 2-25 plus the existing digest card, which covers number one
  far better than a thin card could. Each carries a story_key so twenty-five
  cards of one shape cannot arrive together, and quality falls with rank.
- Teammates cards link to the Teammates Score tool, opened on the exact pairing
  (`/teammates?vs=stephen-curry,russell-westbrook`). Slugs fold diacritics
  rather than dropping them — the mistake that left six race tiles unrebuilt.
- Guess the Player admits only the hard tier: 625 players who lasted in the
  league without ever making an All-Star team. Weighting could not do this on
  its own — quality_score maps to the engine's 0.7x-1.3x band, so the widest
  gap between tiers is 1.65x per card, which is why a clear photograph of
  Gordon Hayward still came up often enough to notice. The 453 easy and medium
  cards stay in the pool file; one line in app.js brings a tier back.
- `build_salary.mjs` and `build_frivolities.mjs` find their own sources
  (`tools/lib/find.mjs`). Both pools sat unbuilt for weeks purely because
  nobody had the paths to hand. Every candidate is listed, newest used, and
  `--local` still overrides — because this machine has two nba-player-data
  checkouts and picking one in silence is how the 92-vs-99 player bug happened.

- YouTube plays in the feed (`js/yt-video.js`). A YouTube card was a title and
  a thumbnail that sent you to youtube.com; it now plays in place, through the
  same coordinator that governs the canvas players and Bluesky clips, so one
  thing moves at a time. Click-to-play by default, `sources.youtube.autoplay`
  to change that. No iframe, no script and nothing from youtube.com loads until
  someone presses play — the thumbnail still comes from i.ytimg.com as it
  always did, and the embed is youtube-nocookie.com. Pausing goes over
  postMessage rather than tearing the frame down, so position survives.
  Verified in a browser with request interception, in both modes: nothing
  auto-starts while autoplay is off, a click pauses the race above it, and the
  only Google-owned request before a click is the fonts stylesheet the page
  already made. `tools/test_yt_video.mjs` covers the URL parsing; the
  coordinator behaviour needs a browser and is not re-checkable without one.

- Story keys and quality for every card type (`js/story.js`). The engine's
  spacing and weighting shipped long ago but only 44 of 7,384 cards carried the
  metadata it reads, so eight card types were weighted at parity. Derived at
  load time rather than in the builders, because the VS/quiz/trivia/ballot pools
  are rewritten by a weekly job that knows nothing about this and the rest are
  rebuilt from local sources — anything a builder wrote was one refresh from
  being dropped. 73ms for the whole feed, and it never overwrites a value a
  builder set. Measured over 3,840 served slots, three runs each: two cards from
  the same race group inside twelve fell from 47/43/59 to 21/19/33, and the
  served share of tier-1 races rose from 20.8% to 26.9%, NBA Finals on-this-day
  cards from 26.0% to 29.9%. The shared `ballot|AWARD|season|subject` namespace
  across races, trivia and both oddity generations is correct but did NOT show a
  measurable effect (18/14/19 vs 28/13/16 — noise): collisions are already rare
  at this pool size, and it is there for when they are not.

- Race face tiles no longer distort heads. `raceFaceTile` ended in a straight
  resize to 112x80, which forces any source shape into 1.4:1: the top 80% of an
  official 1040x760 portrait is 1.71:1, so every head came out 17% too narrow
  for its height, by a different amount per source aspect. Now cover-cropped to
  the tile's aspect before scaling. `tools/test_face_tiles.mjs` draws a circle
  in six source shapes and checks it is still a circle. Needs
  `tools/retile_faces.mjs --local <headshots> --write` to rebuild the 737 tiles;
  a full race rebuild is not required.
- Bluesky stills and video posters are shown whole. They were `max-height:22rem`
  with `object-fit:cover`, and most of what HoopsHype posts there is a chart or
  a bar-race still whose top and bottom rows are the content. Multi-image posts
  stay a thumbnail grid.
- Guess the Player shows a clear, full photograph. The blur made it a puzzle
  about the blur; the difficulty now comes from the player, with the pool
  weighted toward the 625 hard-tier journeymen through `quality_score`. The
  circular crop became a rounded square: it was clipping hair and shoulders,
  which is what a reader reasons from when the face alone is not enough.
- Teammates cards no longer print the answer above the animation. Both final
  scores and the verdict are withheld until the race ends, is scrubbed to the
  end, or the reader taps "play it, or tap to skip to the answer". Reduced
  motion reveals immediately, since there is no animation to wait through.

- Buzz freshness in For You: a decay curve on `published_at` (1.00 now, 0.85 at
  six hours, 0.45 at a day, 0.12 at three days, floor 0.03), interpolated so
  there is no cliff at a band edge. Trending lifts a post but is clamped so a
  week-old badged item never outranks something from this morning. Archive
  cards carry no timestamp and are untouched. Measured through `sampleMixed`:
  a two-hour-old post takes 81% of the buzz slots against a five-day-old one,
  and the stale one still appears 19% of the time — demoted, not deleted.
  Curve lives in `data/buzz-sources.json` under `freshness`.
- Cross-source dedupe: one event arriving through Bluesky, Reddit and YouTube
  now collapses to one card. Requires a shared entity AND title overlap AND a
  36-hour window, and runs before the per-source caps so a duplicate no longer
  eats a slot. Two guards found by testing, both erring toward showing a
  duplicate rather than hiding a story: titles under five content words are
  never fuzzy-matched ("Lakers win in Denver" / "Lakers lose in Denver" agree
  on two words of three), and two titles quoting different numbers never merge.
  `tools/test_freshness.mjs` keeps all of it honest — 28 checks, no network.
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
- Comparison card: the VS scoreline built one metric at a time instead of
  declared, 1,500 matchups between All-Stars since 1984, disjoint from the VS
  pool, scored by the same `vs-score.js` the comparison tool runs
- Award vote races: 121 media award counts, ballot by ballot, in the race file
  format so the existing player draws them and the Races tab filters them
- Teammates rebuilt on the shared face index: McHale, McGrady, DeAndre Jordan,
  Amare Stoudemire, DeMarcus Cousins, LaMarcus Aldridge and Bob McAdoo join the
  pool, all seven lost to a matcher that never lowercased
- Weekly digest: `nba-trade-daily-digest` now answers `?days=N` (1-30) and
  declares the window it served, so the dormant WEEKLY DIGEST card lit up with
  no change on this side. The Worker had no repo anywhere; it was pulled out of
  the Cloudflare dashboard with `wrangler init --from-dash` and now lives in
  `Documents\GitHub\nba-trade-daily-digest` on Jorge's machine
- Salary storytelling: twelve families across cost-per-production, payroll
  shape, cross-era cap share and career earnings by country and draft class,
  replacing the single "X made $Y, Z% of the cap" template. Games and minutes
  floors on every rate, the denominator printed on every card, and injury
  seasons kept out of payroll stories
- Ballot oddities rebuilt: eight families on ballot structure instead of two on
  first-place votes, each gated against the real distribution, with a novelty
  score and a CTA deep-linked to the player or voter rather than the tracker's
  front page. `build_vault.mjs` no longer emits oddities
- Feed diversity: `story_key` / `story_family` / `quality_score` on generated
  cards, and a sampler that demotes what the last twelve cards already showed.
  Exploration was bypassing the penalty entirely, which is why the first
  measurement showed no improvement
- Frivolities trivia builder: archive-grounded questions that hide something
  the record already contains rather than inventing anything, with guards
  against same-surname options, answers visible in the excerpt or the header,
  items naming two players, and years written into a "what year" question. The
  card renders through the ballot renderer with an evidence block and a source
  link that stays hidden until the question is answered
- One media coordinator (`js/media.js`) decides what moves. The canvas players
  and `bsky-video.js` each ran their own observer and neither knew the other
  existed, so a race and a Bluesky clip could animate together. Now: one item at
  a time, the one nearest the middle of the viewport, 60% visibility to qualify,
  a manual pause that scrolling cannot undo, a manual play that outranks the
  centred card, and no autoplay at all under reduced motion or reduced data
- Guess the Player is a progressive blur rather than `filter: brightness(0)`,
  which was a solid black disc with no head, shoulders or hairline to reason
  from. Four steps tied to hints taken: anonymous head, then team colours, then
  features, then nearly clear
- Animation pacing is content-aware: `js/pacing.js` sizes every run to the
  amount of content inside a per-kind band, so a 23-frame franchise race and an
  80-frame all-time race no longer share a duration. Award ballot races stopped
  inheriting bar-race timing (70s to 29.5s median), comparisons went 24s to 42s,
  teammates 26s to 38.9s
- Trade cards read as what they are: a COMMUNITY TRADE chip, provenance above
  the trade rather than under it, "Salary match: 97%" instead of "97% balanced",
  and no LIVE badge that could imply a real transaction. Fallback cards say they
  are examples, and the fallback data's "someone is stretching the rules" - a
  CBA-legality claim a salary ratio cannot support - is gone
- `ALL_POOLS` is derived from `TAB_POOLS` instead of a hand-written list of
  three. An entity filter clicked on a cold page could never surface Teammates,
  Comparison, Media Lean or ballot races, because those pools were not in the
  list; the bug was invisible on a warm page
- Buzz reads newest-first. `E.recent()` sorts by the source's own publication
  time and the Buzz tab uses it instead of the weighted sample. Only that tab:
  mixed batches elsewhere still draw Buzz's 40% share through the personalised
  sampler, and an entity filter (which crosses every section) keeps the shuffle
- `tools/win/` holds the repeatable Windows steps, so a rebuild is one line
  rather than five pasted into cmd: `build.cmd` runs both external-source
  builders and refuses to run from the wrong checkout, `ship.cmd "message"`
  builds then commits and pushes, `apply.cmd <file>` applies a patch out of the
  Downloads folder. Paths live in a gitignored `paths.cmd`, so no personal
  directory reaches this public repo
- Flags served from the repo: the 13 PNGs the media lean card needs are
  committed, so every country marker draws a flag rather than the ISO-code
  fallback chip, and no card reaches flagcdn at runtime
- Comparison card's ending is a port of the generator's `drawFinalScreen()`
  rather than an invention: headshot outboard of an uppercase name, trophy on
  the winner, oversized green score, a banded "<NAME> BIGGEST WINS" header per
  column with the scoreline opposite, alternating rows of metric against
  "won - lost", and letter-spaced HOOPSMATIC.COM along the foot. Six wins a
  side rather than two, because a column built for ten looked wrong holding two
- Comparison rows: the winner's tint stops clear of the category label. 42/58
  is the generator's boundary, but its metric sits in a column a eleventh of the
  row wide, so the boundary never reaches the words; this card gives the
  category the whole middle, so the tint now yields to the label's measured
  edge whenever the two would meet
- Comparison card switched to the light palette it should always have had:
  --bg ground, --surface rows, --text and --text-secondary type, --accent /
  --red / --orange for the two sides and the leader, headings in Barlow
  Condensed. Every value is a token styles.css already sets, so the canvas
  cannot drift from the markup around it. `.race-canvas` painted a dark
  background before first paint for all four players; that is now scoped so the
  Comparison card does not flash dark
- Media lean: a canvas port of the published HoopsHype media-vote video — who
  in the press is highest and lowest on each of 99 players, by voter, by outlet
  and by region, every figure reproducing the video's own
