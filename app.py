"""
rail-radar - JSON fare lookup over Renfe for the Madrid family travel radar.

Wraps check_prices() from belgrano9/renfe_mcp_server and exposes one endpoint the
scheduled radar can fetch directly, so train fares stop being a blind spot.

FARE BASIS - read this before trusting the totals.
Renfe's feed gives `tarifaMinima`: the cheapest ADULT fare on each train. Renfe's
child reduction for 4-13 year olds varies by fare type and is not in the feed, so
`total_estimate` multiplies the adult fare by the full passenger count.
Treat every total as an UPPER BOUND - the real family price is that or lower.

Covers Renfe services only (AVE, Avlo, Alvia, Intercity). Ouigo and Iryo are
separate operators and are not visible here.

TIME FILTERS take digits, not clock strings: dep_after=1800, not dep_after=18:00.
A colon in a query value was arriving empty, which silently disabled filtering.
Colons are still accepted and stripped, but digits are the safe form.
"""

import os
import re
import time
from concurrent.futures import ThreadPoolExecutor
import logging
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from renfe_mcp.price_checker import check_prices

from geo import estimate_taxi, STATIONS, renfe_name

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("rail-radar")

app = FastAPI(title="rail-radar", docs_url="/docs")

# Optional shared secret. Set RAIL_RADAR_TOKEN in the Space secrets to require
# ?token=... on every call. Leave unset and the endpoint is open.
TOKEN = os.environ.get("RAIL_RADAR_TOKEN", "").strip()

# Renfe is being scraped, so cache hard. The radar re-checks the same handful of
# routes every morning and fares do not move minute to minute.
CACHE_TTL_SECONDS = 6 * 60 * 60
_cache: Dict[str, tuple] = {}


def _to_minutes(value: Optional[str]) -> Optional[int]:
    """'1800' or '18:00' -> 1080. Junk or empty -> None (meaning no filter).

    Everything reduces to minutes-since-midnight so comparisons are numeric and
    never depend on a colon surviving the round trip.
    """
    if value is None:
        return None
    digits = re.sub(r"\D", "", value)
    if len(digits) != 4:
        return None
    hours, minutes = int(digits[:2]), int(digits[2:])
    if hours > 23 or minutes > 59:
        return None
    return hours * 60 + minutes


def _train_minutes(train: Dict[str, Any], key: str) -> Optional[int]:
    return _to_minutes(train.get(key))


def _cached_prices(origin: str, destination: str, date: str, per_page: int) -> List[Dict[str, Any]]:
    key = f"{origin}|{destination}|{date}|{per_page}"
    hit = _cache.get(key)
    if hit and (time.time() - hit[0]) < CACHE_TTL_SECONDS:
        return hit[1]

    trains = check_prices(origin=renfe_name(origin), destination=renfe_name(destination),
                          date=date, page=1, per_page=per_page)
    _cache[key] = (time.time(), trains)
    return trains


def _passes_time_filters(train: Dict[str, Any], dep_after: Optional[int],
                         arr_before: Optional[int]) -> bool:
    dep = _train_minutes(train, "departure_time")
    arr = _train_minutes(train, "arrival_time")

    if dep_after is not None and (dep is None or dep < dep_after):
        return False
    if arr_before is not None:
        if arr is None:
            return False
        # An overnight service cannot satisfy "arrive by 23:00 the same day".
        if dep is not None and arr < dep:
            return False
        if arr > arr_before:
            return False
    return True


def _leg(origin: str, destination: str, date: str, dep_after: Optional[str],
         arr_before: Optional[str], max_options: int) -> Dict[str, Any]:
    dep_min = _to_minutes(dep_after)
    arr_min = _to_minutes(arr_before)

    # Over-fetch before filtering, otherwise a tight time window can discard
    # everything Renfe returned on the first page.
    raw = _cached_prices(origin, destination, date, per_page=20)

    usable = [t for t in raw
              if t.get("available", True) and _passes_time_filters(t, dep_min, arr_min)]
    usable.sort(key=lambda t: t.get("price", 0) or 0)

    # An empty result has three very different meanings and the radar must not
    # read them all as "no cheap trains today".
    if not raw:
        status = "no_trains_from_renfe"
        note = ("Renfe returned nothing for this date. Most likely the date is "
                "beyond Renfe's sales window and tickets are not on sale yet. "
                "Re-check when the date comes closer.")
    elif not usable:
        status = "all_filtered_out"
        note = (f"Renfe returned {len(raw)} trains but none met the time filters "
                f"or were available.")
    else:
        status = "ok"
        note = None

    return {
        "date": date,
        "status": status,
        "note": note,
        # Echo what the server actually parsed, so a mangled filter is visible
        # in the response instead of silently doing nothing.
        "filters_applied": {"dep_after_min": dep_min, "arr_before_min": arr_min},
        "trains_returned": len(raw),
        "trains_after_filters": len(usable),
        "cheapest": usable[0] if usable else None,
        "options": usable[:max_options],
    }


@app.get("/")
def root() -> Dict[str, Any]:
    return {
        "service": "rail-radar",
        "automated_callers_use": "/r/MADRID/SEVILLA/2026-12-04/2026-12-08/1800/2300",
        "browser_use": "/quote?from=MADRID&to=SEVILLA&out=2026-12-04&ret=2026-12-08"
                       "&adults=2&children=2&dep_after=1800&ret_arr_before=2300",
        "why_two_endpoints": "Some fetchers cache per URL path and ignore the query "
                             "string, silently returning the previous route's answer. "
                             "/r/ puts every varying value in the path so each query "
                             "is a distinct URL.",
        "time_format": "digits, not clock strings: 1800 not 18:00. Use 0 for no filter.",
        "operators": "Renfe only (AVE, Avlo, Alvia, Intercity). Not Ouigo or Iryo.",
        "fare_basis": "adult tarifaMinima x passenger count; totals are upper bounds",
    }


@app.get("/r/{origin}/{destination}/{out}/{ret}/{dep_after}/{ret_arr_before}")
def quote_by_path(
    origin: str,
    destination: str,
    out: str,
    ret: str,
    dep_after: str,
    ret_arr_before: str,
    adults: int = Query(2, ge=1, le=9),
    children: int = Query(2, ge=0, le=8),
    max_options: int = Query(5, ge=1, le=20),
    token: Optional[str] = Query(None),
) -> Dict[str, Any]:
    """Path-addressed form. Every value that varies between calls lives in the
    path, so a fetcher that caches per path still gets a distinct URL per query.

    Use "none" for ret on a one-way, and "0" for either time filter to disable it.
    """
    return _quote_impl(
        from_=origin,
        to=destination,
        out=out,
        ret=None if ret.lower() in ("none", "0", "-") else ret,
        adults=adults,
        children=children,
        dep_after=dep_after,
        arr_before=None,
        ret_dep_after=None,
        ret_arr_before=ret_arr_before,
        max_options=max_options,
        token=token,
    )


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True, "cached_routes": len(_cache), "stations_on_file": len(STATIONS)}


@app.get("/taxi/{station}/{lat}/{lon}")
def taxi(station: str, lat: float, lon: float,
         weekend: bool = Query(True), large_vehicle: bool = Query(True),
         passengers: int = Query(4, ge=1, le=9),
         nights: Optional[int] = Query(None, ge=1, le=30)) -> Dict[str, Any]:
    """Station-to-door leg, so the radar prices places that are not in the
    station's own town. Path-addressed for the same caching reason as /r/.

    lat/lon are the property's coordinates, which Booking returns directly.
    """
    return estimate_taxi(station, lat, lon, weekend=weekend, large_vehicle=large_vehicle,
                         passengers=passengers, nights=nights)


@app.get("/stations")
def stations() -> Dict[str, Any]:
    return {"count": len(STATIONS), "stations": sorted(STATIONS.keys())}


@app.get("/quote")
def quote(
    from_: str = Query(..., alias="from", description="Origin station name, e.g. MADRID"),
    to: str = Query(..., description="Destination station name, e.g. SEVILLA"),
    out: str = Query(..., description="Outbound date, YYYY-MM-DD"),
    ret: Optional[str] = Query(None, description="Return date, YYYY-MM-DD. Omit for one-way."),
    adults: int = Query(2, ge=1, le=9),
    children: int = Query(2, ge=0, le=8),
    dep_after: Optional[str] = Query(None, description="Outbound departs at or after, HHMM e.g. 1800"),
    arr_before: Optional[str] = Query(None, description="Outbound arrives by, HHMM"),
    ret_dep_after: Optional[str] = Query(None, description="Return departs at or after, HHMM"),
    ret_arr_before: Optional[str] = Query(None, description="Return arrives by, HHMM e.g. 2300"),
    max_options: int = Query(5, ge=1, le=20),
    token: Optional[str] = Query(None),
) -> Dict[str, Any]:
    return _quote_impl(from_, to, out, ret, adults, children, dep_after,
                       arr_before, ret_dep_after, ret_arr_before, max_options, token)


def _quote_impl(
    from_: str,
    to: str,
    out: str,
    ret: Optional[str],
    adults: int,
    children: int,
    dep_after: Optional[str],
    arr_before: Optional[str],
    ret_dep_after: Optional[str],
    ret_arr_before: Optional[str],
    max_options: int,
    token: Optional[str],
) -> Dict[str, Any]:

    if TOKEN and token != TOKEN:
        raise HTTPException(status_code=401, detail="bad or missing token")

    passengers = adults + children

    try:
        outbound = _leg(from_, to, out, dep_after, arr_before, max_options)
        inbound = _leg(to, from_, ret, ret_dep_after, ret_arr_before, max_options) if ret else None
    except Exception as exc:
        # Surface the failure loudly rather than returning an empty result that
        # the radar would misread as "no cheap trains today".
        log.exception("renfe lookup failed")
        raise HTTPException(status_code=502, detail=f"renfe lookup failed: {exc}")

    out_fare = (outbound["cheapest"] or {}).get("price")
    ret_fare = (inbound["cheapest"] or {}).get("price") if inbound else None

    total = None
    if out_fare is not None and (ret is None or ret_fare is not None):
        total = round((out_fare + (ret_fare or 0)) * passengers, 2)

    legs = [outbound] + ([inbound] if inbound else [])
    if all(leg["status"] == "ok" for leg in legs):
        overall = "ok"
    elif any(leg["status"] == "no_trains_from_renfe" for leg in legs):
        overall = "no_trains_from_renfe"
    else:
        overall = "all_filtered_out"

    return {
        "route": f"{from_} -> {to}",
        "status": overall,
        "passengers": {"adults": adults, "children": children, "total": passengers},
        "outbound": outbound,
        "return": inbound,
        "total_estimate": total,
        "total_is_upper_bound": True,
        "fare_basis": "cheapest adult fare per leg x passenger count; "
                      "Renfe 4-13 child discount not modelled",
        "operators": "Renfe only. Ouigo and Iryo not covered.",
    }


# Destinations worth sweeping: rail-reachable from Madrid and plausible for a
# family weekend. Kept short on purpose - each entry is two Renfe scrapes.
SWEEP_DESTINATIONS = [
    "CASTELLON", "VALENCIA", "ALICANTE", "MALAGA", "SEVILLA", "ZARAGOZA",
    "CORDOBA", "TARRAGONA", "MURCIA", "GRANADA", "CADIZ", "SANTANDER",
]


@app.get("/sweep/{out}/{ret}/{dep_after}/{ret_arr_before}")
def sweep(out: str, ret: str, dep_after: str, ret_arr_before: str,
          adults: int = Query(2, ge=1, le=9),
          children: int = Query(2, ge=0, le=8),
          limit: int = Query(12, ge=1, le=12),
          token: Optional[str] = Query(None)) -> Dict[str, Any]:
    """Price every destination for one travel window in a single call.

    Exists because each distinct URL needs its own fetch approval. One stable URL
    per window means roughly six approvals ever, instead of one per route per day.
    Cheaper on Renfe too: results share the 6 hour cache with /r/.
    """
    if TOKEN and token != TOKEN:
        raise HTTPException(status_code=401, detail="bad or missing token")

    ret_date = None if ret.lower() in ("none", "0", "-") else ret
    targets = SWEEP_DESTINATIONS[:limit]

    def price_one(dest: str) -> Dict[str, Any]:
        try:
            q = _quote_impl(from_="MADRID", to=dest, out=out, ret=ret_date,
                            adults=adults, children=children, dep_after=dep_after,
                            arr_before=None, ret_dep_after=None,
                            ret_arr_before=ret_arr_before, max_options=3, token=token)
            return {"destination": dest, "status": q["status"],
                    "total_estimate": q["total_estimate"],
                    "outbound": (q["outbound"] or {}).get("cheapest"),
                    "return": (q["return"] or {}).get("cheapest")}
        except Exception as exc:
            # One bad destination must not take the whole sweep down.
            return {"destination": dest, "status": "error", "error": str(exc)[:200],
                    "total_estimate": None}

    # Modest concurrency: enough to keep the request under a sane duration,
    # gentle enough not to hammer Renfe from one IP.
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(price_one, targets))

    priced = [r for r in results if r.get("total_estimate") is not None]
    priced.sort(key=lambda r: r["total_estimate"])
    unpriced = [r for r in results if r.get("total_estimate") is None]

    return {
        "window": {"out": out, "ret": ret_date,
                   "dep_after": dep_after, "ret_arr_before": ret_arr_before},
        "passengers": {"adults": adults, "children": children, "total": adults + children},
        "priced": priced,
        "unpriced": unpriced,
        "fare_basis": "cheapest adult fare per leg x passenger count; upper bound",
        "note": "Train fares only. Lodging, last-mile transfer and Madrid metro not included.",
    }
