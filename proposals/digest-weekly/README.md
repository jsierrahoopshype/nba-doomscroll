# Proposal: a `?days=` parameter on the trade digest Worker

**Status:** the Doomscroll side is built and shipped. It is dormant, waiting on
this one change to `nba-trade-daily-digest`. Nothing in that repo has been
modified — I cannot read it, it is private.

**Effort:** one query parameter, one extra field in the response. No new
dependency, no new endpoint, no cost. It stays inside the Workers free tier.

---

## What the Doomscroll already does

`js/trades.js` makes two calls on every page load:

```
GET https://nba-trade-daily-digest.thejorgesierra.workers.dev/digest
GET https://nba-trade-daily-digest.thejorgesierra.workers.dev/digest?days=7
```

The first renders the DAILY DIGEST card. The second renders a WEEKLY DIGEST card
**only if the response says it covers seven days.** Right now it does not say
that, so the second card never appears and the console logs:

```
[doomscroll] no weekly digest: the endpoint did not declare a 7-day window
```

## Why it insists on being told

A Worker that does not recognise `days` ignores it and returns the normal
24-hour digest — same JSON, same numbers, status 200. If the card trusted the
request instead of the response, it would print *"12.1% of every trade built in
the last 7 days"* over 24-hour data. That is a wrong number on a public page,
and a wrong number is worse than a missing card. So the rule is: the response
has to declare its own window, or there is no weekly card.

---

## The contract

### Request

| Request | Meaning |
| --- | --- |
| `GET /digest` | unchanged — the last 24 hours |
| `GET /digest?days=7` | the last 7 days |
| `GET /digest?days=N` | the last N days, clamp N to 1–30 |

An unknown or malformed `days` should fall back to 1 rather than error.

### Response

Exactly the shape it returns today, plus **one new field**: `days`, alongside
`ok` and `digest`.

```jsonc
{
  "ok": true,
  "days": 7,                     // <- the only required addition
  "digest": {
    "hasTrades": true,
    "topPlayer": "Nikola Jokic",
    "topCount": 902,             // trades in the window that included him
    "tradeCount": 7431,          // trades in the window, total
    "topDestinations":      [["Houston", 300], ["New York", 210], ["Oklahoma City", 150]],
    "topTradedForPlayers":  [["Alperen Sengun", 260], ["Chet Holmgren", 190], ["Amen Thompson", 120]]
  }
}
```

`days` may sit at the top level or inside `digest` — the card reads either. It
also accepts `period_days`, or `window_hours` (168), or a `period` string
containing the word "week", in case one of those is more natural in the existing
code. Any one of them is enough.

### Optional, and worth doing

Add a ranked list of the top players in the window:

```jsonc
"topPlayers": [["Luka Doncic", 1180], ["Nikola Jokic", 902], ["Giannis Antetokounmpo", 640]]
```

The card currently prints **"No. 1 most-traded player"**, which is true by
construction because the payload names one player. With `topPlayers` present it
reads the real rank off the list — so if the hero of a given window is second or
third by some other measure, the card says so instead of overclaiming. Ten
entries is plenty. Already implemented and tested on the Doomscroll side; it
does nothing until the field exists.

---

## Implementing it

I have not seen the Worker, so this is the shape rather than a patch. Wherever
the current code decides "the last 24 hours", that decision becomes a parameter.

```js
// 1. read and clamp, at the top of the handler
const url = new URL(request.url);
const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get("days"), 10) || 1));
const sinceMs = Date.now() - days * 86400000;

// 2. use `sinceMs` wherever the 24-hour cutoff is computed today.
//    If it currently reads something like:
//        const since = Date.now() - 24 * 60 * 60 * 1000;
//    that line is the whole change.

// 3. if the digest is cached in KV, key the cache by window or the daily
//    numbers will be served for the weekly request and vice versa
const cacheKey = `digest:v1:d${days}`;

// 4. declare the window in the response
return json({ ok: true, days, digest });
```

Three things to watch:

- **Cache keys.** If there is a KV or Cache API entry called `digest` or
  similar, it has to become per-window. This is the one change that breaks
  quietly if missed: the weekly request would return whatever the daily one
  cached, complete with a `days: 7` label. Wrong numbers, correctly labelled —
  the exact failure the guard exists to prevent, arriving through the back door.
- **CORS stays as it is.** The Doomscroll calls this cross-origin from
  `jsierrahoopshype.github.io`; whatever headers make the daily card work today
  must be on the weekly response too. If they are set once for every response,
  nothing to do.
- **Cost of the wider scan.** Seven days is roughly seven times the rows. If the
  daily aggregate is computed per request rather than cached, cache the weekly
  one for an hour — it barely moves between requests, and a weekly number does
  not need to be fresh to the minute.

---

## Verifying it

From your machine, after deploying:

```
curl -s "https://nba-trade-daily-digest.thejorgesierra.workers.dev/digest?days=7" | head -c 400
```

Three things to check, in order:

1. `"days":7` appears in the response.
2. `tradeCount` is materially bigger than the plain `/digest` call's — if the
   two are identical, `days` reached the handler but not the query, or a shared
   cache entry is being served.
3. `topPlayer` may or may not differ from the daily one. Either is fine.

Then open the Doomscroll's Trades tab. You should see a second card chipped
**WEEKLY DIGEST**, reading "the last 7 days". If it does not appear, the console
says which of the two reasons applied: the request failed, or the window was not
declared.

Nothing needs to be redeployed on the Doomscroll side. The card is already
there, asking every time.
