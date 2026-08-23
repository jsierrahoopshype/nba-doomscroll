# Proposal: two rumors endpoints for the Doomscroll feed

**Status:** design approved by Jorge (Aug 2026). Nothing is deployed, and nothing in
`hoopshype-rumors` has been modified.

The Doomscroll Rumors tab needs two things the archive API does not currently
offer: rumors from *this calendar date in past years*, and a random sample.
Today the API exposes only `/api/rumors/latest` and `/api/rumors/part/1..7`.

## The constraint that shapes the design

My first instinct was a Worker endpoint that scans the seven part files per
request and filters by month-day. **That cannot work.** A Cloudflare Worker gets
128 MB of memory and a few hundred ms of CPU per request. The archive is ~638K
entries across seven part files; `JSON.parse` on even one of them needs several
times the file size in memory. The endpoint would OOM on a cold miss, and every
cache miss would be a multi-second stall.

So the filtering has to happen **once a day, offline** — in the GitHub Action
that already maintains the archive and already holds the R2 credentials — not
per request in the Worker.

## The design

**1. A daily index build** (`build_otd_index.py`, in this folder)

Runs as one extra step in the existing `update-rumors.yml`, right after the
scraper, while the part files are already on disk. It:

- groups every entry by `MM-DD` of `archive_date`
- drops anything matching the editorial blocklist (legal / off-court)
- keeps at most 40 per day, spread across years so one busy year cannot take
  the whole slot
- trims each entry to the five fields a card actually needs
- writes `otd/MM-DD.json` (366 small files) and `random-pool.json` to R2

Output is roughly 6 MB total across all 366 files. Each file is ~15 KB, so a
request serves one small object.

**2. Two thin Worker routes** (`worker-routes.js`, in this folder)

```
GET /api/rumors/on-this-day?md=MM-DD&limit=40
GET /api/rumors/random?limit=25
```

Both just fetch one precomputed R2 object and return it. No scanning, no
parsing of anything large, no API key needed.

These are written as standalone handler functions plus a two-line router hook,
so they paste into your existing Worker additively — I never needed to see its
source after all. The only thing to check is that your R2 binding is named
`RUMORS_BUCKET`; if it's called something else, change the one constant at the
top of the file.

## Auth: decided — origin-locked, excerpt-only, always linking back

Jorge asked for whichever option is most free, safe, legal and actually works.
That is the origin-locked endpoint, with two hardening rules borrowed from his
own Content Stream design doc.

**A correction first.** An earlier draft of this file called the static-file
alternative "most locked down". That was backwards. Committing rumor text into
`nba-doomscroll` would put it in a public git history permanently, with no
origin check, no cap and no expiry, indexed by GitHub code search. It is
strictly *more* exposed than an endpoint, not less. Scratch that option.

What ships instead:

- **Origin-locked, keyless.** Allowed origins are `hoopsmatic.com` and
  `jsierrahoopshype.github.io`. A browser cannot hold a secret, so a key in the
  page would be theatre. Free on Cloudflare's tier at this volume.
- **Excerpt-only, ~280 characters**, with quotes capped at 200. The index is
  never a usable copy of the archive — even every one of the 366 day files
  amounts to roughly 7K truncated excerpts, about 1% of the archive, with no
  full item text at all.
- **The calendar cannot be walked.** `on-this-day` serves only dates within one
  day of the Worker's UTC date. The ±1 window exists so readers west of UTC
  still get "today"; it is not a date picker. A scraper is capped at ~20
  excerpts a day and would need a year of daily requests to collect the set.
- **Volumes kept low**: 20 entries per day, an 800-entry random pool. More than
  a feed slice needs, far less than a dataset.
- **Every entry must carry a `source_url`**; entries without one are dropped at
  build time rather than published. Every card links back to hoopshype.com, so
  the feature sends traffic to the archive instead of substituting for it.

This mirrors, verbatim, the constraint section 4.4 of the Content Stream design
doc already sets for third-party content: *"never store/display post bodies
beyond a short excerpt (~280 chars). Every item displayed must link back to the
original."* Applying the same rule to HoopsHype's own archive seemed like the
consistent call.

**One thing that is yours, not mine, to decide:** the archive is Gannett
editorial property. Nothing above changes who owns it, and "technically well
scoped" is not the same as "cleared". If exposing even excerpts through a
public endpoint needs a nod from anyone at HoopsHype, this is the point to get
it — the code is ready either way, and none of it is deployed.

## Client side is already wired

`js/rumors.js` in the Doomscroll repo already calls both endpoints, applies the
blocklist a second time in the browser, and drops the sample rumor cards the
moment real ones arrive. Until the endpoints exist it logs two warnings and
keeps the samples, which is what it does today. So once you deploy the Worker
side, the Rumors tab goes live with no further change from me.

## What I still need for the Trades half of step 4

One line: open
https://nba-trade-calculator.thejorgesierra.workers.dev/api/trade-log
in your browser and paste the field names of a single entry. That confirms
there are no usernames or IPs before I wire it to the feed. If it 403s from the
browser too, the Worker's source or the D1 schema (`.schema` output) answers it
just as well.

## Deploy order, once approved

1. Add `build_otd_index.py` to `hoopshype-rumors`, and one step to
   `update-rumors.yml` that runs it before the R2 upload step.
2. Let the Action run once (or trigger it manually) so the index exists in R2.
3. Paste the two handlers into the rumors Worker, add the two router lines,
   `wrangler deploy`.
4. Tell me, and I'll wire the Doomscroll Rumors tab to the live endpoints and
   drop the sample cards.
