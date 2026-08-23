#!/usr/bin/env python3
"""Build the on-this-day and random indexes for the Doomscroll Rumors feed.

PROPOSED addition to the hoopshype-rumors repo. Not deployed. Nothing in that
repo has been changed.

Why offline: a Cloudflare Worker has 128 MB of memory and a few hundred ms of
CPU per request. Scanning seven ~90K-entry part files per request would OOM.
This runs once a day inside the existing update-rumors Action, where the part
files are already on disk and the R2 credentials already exist, and writes 366
small day files the Worker can serve with a single object read.

Place at the repo root and add one step to .github/workflows/update-rumors.yml,
after "Run scraper" and before "Upload to Cloudflare R2":

    - name: Build Doomscroll on-this-day index
      run: python build_otd_index.py --out otd_build

and extend the upload step to also push the built folder:

    aws s3 cp otd_build/ "s3://hoopshype-rumors/" --recursive \
      --endpoint-url "$R2_ENDPOINT" --content-type "application/json"

Output written to <out>/:
    otd/MM-DD.json     366 files, <=20 entries each
    random-pool.json   ~800 sampled entries
    otd/manifest.json  counts per day, for sanity-checking a build

Entries are EXCERPT-ONLY by construction: text is capped at 280 chars and
quotes at 200 and every entry carries source_url, so the files that reach R2 never hold
full archive records. Anything without a source_url is dropped, because a card
that cannot link back to hoopshype.com must not ship.
"""

import argparse
import calendar
import json
import os
import random
import sys
import urllib.request
from collections import defaultdict

PART_FILES = [f"hoopshype_rumors_part{i}.json" for i in range(1, 8)]
LATEST_FILE = "hoopshype_rumors_latest.json"

# The editorial blocklist lives in the Doomscroll repo so Jorge can edit it in
# one place. Fetched at build time; falls back to a local copy if offline.
BLOCKLIST_URL = ("https://raw.githubusercontent.com/jsierrahoopshype/"
                 "nba-doomscroll/main/data/rumor-blocklist.json")

PER_DAY = 20
RANDOM_POOL = 800
FIELDS = ("archive_date", "outlet", "source_url", "text", "quote")

# The single most important protection for the archive: the day files written
# to R2 hold EXCERPTS ONLY, never full records. An endpoint policy can be worked
# around; a file that never held the full text cannot leak it. This is the same
# constraint the NBA Content Stream design doc sets for third-party content
# ("never store/display bodies beyond a short excerpt (~280 chars); every item
# displayed must link back to the original"), applied here to the archive. It
# keeps the exposed slice small and sends readers to hoopshype.com for the rest.
EXCERPT_CHARS = 280
QUOTE_CHARS = 200   # verbatim quotes are the most sensitive field, so tighter

random.seed(20260822)  # deterministic builds


def load_blocklist(local_fallback):
    try:
        with urllib.request.urlopen(BLOCKLIST_URL, timeout=20) as r:
            data = json.load(r)
        print(f"blocklist: fetched {len(data.get('blocked_keywords', []))} terms")
    except Exception as e:
        print(f"blocklist: fetch failed ({e}); trying {local_fallback}")
        try:
            with open(local_fallback, encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            sys.exit("blocklist unavailable — refusing to build an unfiltered index")
    terms = [t.lower() for t in data.get("blocked_keywords", [])]
    whole = {t.lower() for t in data.get("whole_word_only", [])}
    # whole_word_only changes HOW a term matches, it does not add the term to
    # the scan. A term listed only there would be silently ignored, which is
    # the worst possible failure mode for an editorial filter.
    orphans = sorted(whole - set(terms))
    if orphans:
        sys.exit("blocklist error: these are in whole_word_only but missing from "
                 "blocked_keywords, so they would never match: " + ", ".join(orphans))
    return terms, whole


def blocked(entry, terms, whole):
    """True if the entry mentions a blocked topic.

    Whole-word terms are matched against padded, punctuation-stripped text so
    'jail' does not fire on 'Jailen' and 'trial' does not fire on 'trials'.
    """
    hay = " ".join(str(entry.get(f) or "") for f in ("text", "quote", "outlet"))
    tags = entry.get("tags") or entry.get("players") or []
    if isinstance(tags, list):
        hay += " " + " ".join(str(t) for t in tags)
    hay = hay.lower()
    padded = " " + "".join(c if c.isalnum() else " " for c in hay) + " "
    for t in terms:
        if t in whole:
            if f" {t} " in padded:
                return True
        elif t in hay:
            return True
    return False


def excerpt(text, limit):
    t = " ".join(str(text or "").split())
    if len(t) <= limit:
        return t
    cut = t[:limit]
    # break on a word boundary so an excerpt never ends mid-word
    if " " in cut:
        cut = cut[:cut.rindex(" ")]
    return cut + "\u2026"


def trim(entry):
    """Excerpt-only projection. Entries with no source_url are dropped: a card
    that cannot link back to hoopshype.com must not be published at all."""
    if not entry.get("source_url"):
        return None
    out = {k: entry.get(k) for k in FIELDS if entry.get(k)}
    out["text"] = excerpt(out.get("text"), EXCERPT_CHARS)
    if out.get("quote"):
        out["quote"] = excerpt(out["quote"], QUOTE_CHARS)
    if not out["text"]:
        return None
    return out


def spread_by_year(entries, cap):
    """Take up to `cap`, round-robin across years, so one heavy news year does
    not fill the whole day and the card feed can say '12 years ago today'."""
    by_year = defaultdict(list)
    for e in entries:
        by_year[str(e.get("archive_date", ""))[:4]].append(e)
    for y in by_year:
        random.shuffle(by_year[y])
    out, years = [], sorted(by_year, reverse=True)
    while len(out) < cap and any(by_year[y] for y in years):
        for y in years:
            if by_year[y]:
                out.append(by_year[y].pop())
                if len(out) >= cap:
                    break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="otd_build")
    ap.add_argument("--source-dir", default=".")
    ap.add_argument("--blocklist-local", default="rumor-blocklist.json")
    a = ap.parse_args()

    terms, whole = load_blocklist(a.blocklist_local)

    by_day = defaultdict(list)
    total = kept = 0
    for name in PART_FILES + [LATEST_FILE]:
        path = os.path.join(a.source_dir, name)
        if not os.path.exists(path):
            print(f"  skip {name} (not present)")
            continue
        with open(path, encoding="utf-8") as f:
            rows = json.load(f)
        for e in rows:
            total += 1
            d = str(e.get("archive_date") or "")
            if len(d) < 10:
                continue
            if blocked(e, terms, whole):
                continue
            by_day[d[5:10]].append(e)
            kept += 1
        print(f"  read {name}: {len(rows)} entries")
    print(f"scanned {total} entries, {kept} passed the editorial filter")

    os.makedirs(os.path.join(a.out, "otd"), exist_ok=True)
    manifest, pool = {}, []
    for month in range(1, 13):
        for day in range(1, calendar.monthrange(2024, month)[1] + 1):  # leap year: keeps 02-29
            md = f"{month:02d}-{day:02d}"
            picked = spread_by_year(by_day.get(md, []), PER_DAY)
            trimmed = [t for t in (trim(e) for e in picked) if t]
            with open(os.path.join(a.out, "otd", f"{md}.json"), "w", encoding="utf-8") as f:
                json.dump({"date": md, "count": len(trimmed), "entries": trimmed},
                          f, ensure_ascii=False)
            manifest[md] = len(trimmed)
            pool.extend(trimmed)

    random.shuffle(pool)
    pool = pool[:RANDOM_POOL]
    with open(os.path.join(a.out, "random-pool.json"), "w", encoding="utf-8") as f:
        json.dump({"count": len(pool), "entries": pool}, f, ensure_ascii=False)
    with open(os.path.join(a.out, "otd", "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"per_day": manifest}, f)

    empty = [d for d, n in manifest.items() if n == 0]
    size = sum(os.path.getsize(os.path.join(dp, fn))
               for dp, _, fns in os.walk(a.out) for fn in fns)
    print(f"wrote {len(manifest)} day files + random pool ({len(pool)} entries), "
          f"{size/1024/1024:.1f} MB total")
    print(f"exposure ceiling: {sum(manifest.values())} excerpt-only entries across the "
          f"whole calendar, each capped at {EXCERPT_CHARS} chars with a link back")
    print(f"every entry is a <={EXCERPT_CHARS}-char excerpt with a source_url; "
          f"entries without a link were dropped")
    if empty:
        print(f"note: {len(empty)} calendar dates have no surviving entries "
              f"(deep summer, mostly): {', '.join(sorted(empty)[:8])}"
              f"{' …' if len(empty) > 8 else ''}")


if __name__ == "__main__":
    main()
