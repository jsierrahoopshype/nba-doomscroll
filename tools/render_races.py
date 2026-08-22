#!/usr/bin/env python3
"""NBA Doomscroll — bar chart race clip renderer.

Renders short (10-15s) square MP4 loops for the Vault feed, in the same light
HoopsMatic palette the site uses so a clip sits inside a card without looking
imported. Pillow draws the frames, ffmpeg encodes them — the same approach as
the bar-chart-race tool, reimplemented standalone here because that repo ships
only assets and its package lives in the HuggingFace Space.

Data comes from nba-player-data (rsStats.json, salaries.json). Nothing is
estimated: each frame shows the cumulative career total through that season.

Usage:
  python3 tools/render_races.py --player-data <dir> --out data/races [--only points]
  python3 tools/render_races.py --player-data <dir> --probe   # render one, report size

Fonts: pass --font to point at DM Sans (what the site uses) or your Futura
files. Falls back to whatever sans is on the machine, so a clip always renders.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from collections import defaultdict

from PIL import Image, ImageDraw, ImageFont

# Content Stream / HoopsMatic palette
BG = (245, 245, 247)
SURFACE = (255, 255, 255)
TEXT = (29, 29, 31)
TEXT_2 = (110, 110, 115)
BORDER = (209, 209, 214)
ACCENT = (59, 130, 246)
BAR_COLORS = [
    (59, 130, 246), (29, 138, 64), (178, 107, 0), (124, 58, 237),
    (15, 118, 110), (209, 44, 44), (37, 99, 235), (5, 150, 105),
]

SIZE = 720          # square, sized for a feed card
FPS = 30
BARS = 8            # visible bars
HOLD_FRAMES = 18    # freeze on the final standings before the loop repeats

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
FONT_REG_CANDIDATES = [
    "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def pick_font(explicit, candidates):
    for p in ([explicit] if explicit else []) + candidates:
        if p and os.path.exists(p):
            return p
    return None


def load_font(path, size):
    try:
        return ImageFont.truetype(path, size) if path else ImageFont.load_default()
    except Exception:
        return ImageFont.load_default()


def num(v):
    try:
        return float(str(v).replace("$", "").replace(",", ""))
    except Exception:
        return 0.0


# ---------------------------------------------------------------- data series

def cumulative_from_rs(rs_rows, stat_key, min_year=1950):
    """Career-cumulative totals by season: {year: {player: total}}.

    Multi-team seasons are summed, which is what a career total should do.
    """
    per_season = defaultdict(lambda: defaultdict(float))
    for r in rs_rows:
        try:
            y = int(r["YEAR"])
        except (KeyError, ValueError, TypeError):
            continue
        if y < min_year or (r.get("TEAM") or "") == "TOT":
            continue
        v = num(r.get(stat_key))
        if v:
            per_season[y][r["PLAYER"]] += v

    running = defaultdict(float)
    out = {}
    for y in sorted(per_season):
        for player, v in per_season[y].items():
            running[player] += v
        out[y] = dict(running)
    return out


def cumulative_earnings(sal_rows):
    """Cumulative career salary by season. Covers 1991 onward, which is where
    the salary file starts — the clip subtitle says so."""
    per_season = defaultdict(lambda: defaultdict(float))
    for r in sal_rows:
        try:
            y = int(r["YEAR"])
        except (KeyError, ValueError, TypeError):
            continue
        v = num(r.get("SALARY"))
        if v:
            per_season[y][r["PLAYER"]] += v
    running = defaultdict(float)
    out = {}
    for y in sorted(per_season):
        for player, v in per_season[y].items():
            running[player] += v
        out[y] = dict(running)
    return out


def highest_paid_by_season(sal_rows):
    """Top salary per season, as a running 'who has held the top spot' race."""
    per_season = defaultdict(dict)
    for r in sal_rows:
        try:
            y = int(r["YEAR"])
        except (KeyError, ValueError, TypeError):
            continue
        v = num(r.get("SALARY"))
        if v:
            per_season[y][r["PLAYER"]] = max(per_season[y].get(r["PLAYER"], 0), v)
    return {y: dict(d) for y, d in sorted(per_season.items())}


# ---------------------------------------------------------------- rendering

def fmt_value(v, unit):
    if unit == "money":
        return "$" + f"{v/1_000_000:.1f}M" if v >= 1_000_000 else "$" + f"{v:,.0f}"
    if v >= 1000:
        return f"{v:,.0f}"
    return f"{v:.0f}"


def fit_name(d, name, font, max_w):
    if d.textlength(name, font=font) <= max_w:
        return name
    parts = name.split()
    if len(parts) >= 2:
        short = parts[0][0] + ". " + " ".join(parts[1:])
        if d.textlength(short, font=font) <= max_w:
            return short
        name = short
    while name and d.textlength(name + "\u2026", font=font) > max_w:
        name = name[:-1]
    return name + "\u2026"


def draw_frame(series_a, series_b, t, year_label, title, subtitle, unit, fonts):
    """One frame, interpolating between two adjacent seasons (t in 0..1)."""
    f_title, f_year, f_name, f_val = fonts
    img = Image.new("RGB", (SIZE, SIZE), BG)
    d = ImageDraw.Draw(img)

    pad = 28
    card_top = pad + 74
    d.rounded_rectangle([pad, card_top, SIZE - pad, SIZE - pad], 16, fill=SURFACE, outline=BORDER)

    d.text((pad + 4, pad + 6), title, font=f_title, fill=TEXT)
    if subtitle:
        d.text((pad + 4, pad + 40), subtitle, font=f_val, fill=TEXT_2)

    # interpolate values, then rank
    names = set(series_a) | set(series_b)
    vals = {n: series_a.get(n, 0) * (1 - t) + series_b.get(n, 0) * t for n in names}
    order = sorted(vals.items(), key=lambda kv: -kv[1])[:BARS]
    if not order:
        return img
    top = max(v for _, v in order) or 1

    row_h = (SIZE - pad - card_top - 46) / BARS
    bar_left = pad + 150
    bar_max = SIZE - pad - 108

    for i, (name, v) in enumerate(order):
        y = card_top + 18 + i * row_h
        h = row_h * 0.62
        w = max(3, (bar_max - bar_left) * (v / top))
        color = BAR_COLORS[hash(name) % len(BAR_COLORS)]
        d.rounded_rectangle([bar_left, y, bar_left + w, y + h], 5, fill=color)
        # Name right-aligned into the gutter. Long names overflowed the left
        # edge, so fall back to "K. Abdul-Jabbar" and then to an ellipsis.
        label = fit_name(d, name, f_name, bar_left - 10 - pad)
        tw = d.textlength(label, font=f_name)
        d.text((bar_left - 10 - tw, y + h / 2 - 9), label, font=f_name, fill=TEXT)
        d.text((bar_left + w + 10, y + h / 2 - 8), fmt_value(v, unit), font=f_val, fill=TEXT_2)

    # season label, bottom right
    yl = str(year_label)
    tw = d.textlength(yl, font=f_year)
    d.text((SIZE - pad - 18 - tw, SIZE - pad - 58), yl, font=f_year, fill=ACCENT)
    return img


def render(series, title, subtitle, unit, out_path, fonts, seconds=12):
    years = sorted(series)
    if len(years) < 2:
        raise SystemExit(f"not enough seasons for {title}")
    total_frames = seconds * FPS
    steps = len(years) - 1
    per_step = max(1, total_frames // steps)

    proc = subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error",
         "-f", "image2pipe", "-vcodec", "png", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30",
         "-preset", "slow", "-movflags", "+faststart", out_path],
        stdin=subprocess.PIPE)

    def emit(im):
        im.save(proc.stdin, "PNG")

    for i in range(steps):
        a, b = series[years[i]], series[years[i + 1]]
        for f in range(per_step):
            t = f / per_step
            # ease so the bars settle rather than sliding linearly
            te = t * t * (3 - 2 * t)
            label = years[i] if te < 0.5 else years[i + 1]
            emit(draw_frame(a, b, te, label, title, subtitle, unit, fonts))
    last = series[years[-1]]
    for _ in range(HOLD_FRAMES):
        emit(draw_frame(last, last, 1.0, years[-1], title, subtitle, unit, fonts))

    proc.stdin.close()
    proc.wait()
    if proc.returncode != 0:
        raise SystemExit("ffmpeg failed")


# slug, stat column, title, subtitle, unit, first season the stat was tracked
RACES = [
    ("points",    "PTS", "All-time scoring leaders",     "Career points, cumulative",   "count", 1950),
    ("threes",    "3P",  "All-time 3-pointers made",     "Career 3PM, cumulative",      "count", 1980),
    ("rebounds",  "REB", "All-time rebounding leaders",  "Career rebounds, cumulative", "count", 1951),
    ("assists",   "AST", "All-time assist leaders",      "Career assists, cumulative",  "count", 1950),
    ("steals",    "STL", "All-time steals leaders",      "Career steals, cumulative",   "count", 1974),
    ("blocks",    "BLK", "All-time blocks leaders",      "Career blocks, cumulative",   "count", 1974),
    ("games",     "GP",  "Most games played, all time",  "Career games, cumulative",    "count", 1950),
    ("minutes",   "MIN", "Most minutes played, all time","Career minutes, cumulative",  "count", 1952),
    ("fgm",       "FGM", "All-time field goals made",    "Career FGM, cumulative",      "count", 1950),
    ("ftm",       "FTM", "All-time free throws made",    "Career FTM, cumulative",      "count", 1950),
    ("turnovers", "TOV", "All-time turnovers",           "Career turnovers, cumulative","count", 1978),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--player-data", required=True)
    ap.add_argument("--out", default="data/races")
    ap.add_argument("--font")
    ap.add_argument("--font-regular")
    ap.add_argument("--only")
    ap.add_argument("--probe", action="store_true",
                    help="render a single clip and report its size, then stop")
    a = ap.parse_args()

    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg not on PATH")

    bold = pick_font(a.font, FONT_CANDIDATES)
    reg = pick_font(a.font_regular, FONT_REG_CANDIDATES)
    fonts = (load_font(bold, 30), load_font(bold, 46),
             load_font(reg, 19), load_font(reg, 17))
    print(f"fonts: {os.path.basename(bold or 'default')} / {os.path.basename(reg or 'default')}")

    os.makedirs(a.out, exist_ok=True)
    rs = json.load(open(os.path.join(a.player_data, "rsStats.json"), encoding="utf-8"))

    todo = [r for r in RACES if not a.only or r[0] == a.only]
    if a.probe:
        todo = todo[:1]

    made = []
    manifest = []
    for slug, key, title, subtitle, unit, first in todo:
        series = cumulative_from_rs(rs, key, min_year=first)
        out = os.path.join(a.out, f"{slug}.mp4")
        render(series, title, subtitle, unit, out, fonts)
        kb = os.path.getsize(out) / 1024
        made.append((slug, kb))
        manifest.append({"slug": slug, "title": title, "subtitle": subtitle,
                         "mp4": f"data/races/{slug}.mp4",
                         "seasons": [min(series), max(series)]})
        print(f"  {slug}.mp4  {kb:.0f} KB  ({len(series)} seasons)")

    # career earnings uses the salary file rather than the stat table
    if not a.only and not a.probe:
        sal = json.load(open(os.path.join(a.player_data, "salaries.json"), encoding="utf-8"))
        earn = cumulative_earnings(sal)
        out = os.path.join(a.out, "earnings.mp4")
        render(earn, "Highest career earnings", "Cumulative salary, 1991 onward", "money", out, fonts)
        kb = os.path.getsize(out) / 1024
        made.append(("earnings", kb))
        manifest.append({"slug": "earnings", "title": "Highest career earnings",
                         "subtitle": "Cumulative salary, 1991 onward",
                         "mp4": "data/races/earnings.mp4",
                         "seasons": [min(earn), max(earn)]})
        print(f"  earnings.mp4  {kb:.0f} KB  ({len(earn)} seasons)")

    if manifest:
        with open(os.path.join(a.out, "races.json"), "w", encoding="utf-8") as f:
            json.dump({"clips": manifest}, f, indent=1)
        print(f"wrote {a.out}/races.json")

    if made:
        total = sum(k for _, k in made)
        print(f"\n{len(made)} clip(s), {total/1024:.1f} MB total"
              f" — projected for 20 clips: {total/len(made)*20/1024:.1f} MB")


if __name__ == "__main__":
    main()
