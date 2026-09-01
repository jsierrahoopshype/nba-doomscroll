/* NBA Doomscroll — Teammates Score head-to-head player
 *
 * A port of hh-teammates' "Teammates Score" video into a feed card, laid out
 * the way that generator lays it out: a fixed scoreboard across the top — two
 * heads, two running totals, the gap between them — over a season-by-season
 * list of the decorated teammates each man actually played beside.
 *
 * Careers are walked by SEASON INDEX, not calendar year. Season 1 against
 * season 1, which is the only alignment under which a 1984 rookie and a 2003
 * rookie can share a screen, and it is what the video does.
 *
 * Deliberately the same control contract as js/race-player.js — play, pause,
 * toggle, seek, setSpeed, destroy, plus `playing`, `progress` and
 * `reducedMotion` — so app.js drives both through one lifecycle: lazy fetch on
 * scroll-in, autoplay while visible, pause on scroll-out, scrub, teardown when
 * the feed is cleared. Two renderers, one set of plumbing.
 *
 * The numbers are never computed here. Every point on screen was scored by
 * tools/build_teammates.mjs from hh-teammates' own per-accolade values,
 * including its rule that an MVP supersedes that teammate's All-NBA for the
 * season. This file only draws them.
 */
(function (global) {
  "use strict";

  /* Timing comes from js/pacing.js, which sizes the run to the career: a
   * fourteen-move career and a two-move one should not take the same time.
   * The fallback reproduces the old fixed pacing if that file is missing. */
  var FALLBACK = { targetMs: 26000, minStep: 700, maxStep: 2600 };
  var BG = "#12151c";
  var PANEL = "#1a1f29";
  var TEXT = "#f5f5f7";
  var SEC = "#8a93a6";
  var A_TINT = "#3b82f6";       // same blue the rest of the app uses for VS
  var B_TINT = "#ef6a5a";       // the video's warm second side
  var GOLD = "#caa23a";

  function sans(w, px) { return w + " " + px + "px 'DM Sans',-apple-system,sans-serif"; }
  function mono(w, px) { return w + " " + px + "px 'JetBrains Mono',monospace"; }

  // 12.25 reads as a score; 12.0 should read as 12.
  function fmtPts(v) {
    var r = Math.round(v * 100) / 100;
    if (Math.abs(r - Math.round(r)) < 0.005) return String(Math.round(r));
    return (Math.round(r * 10) / 10).toFixed(1);
  }

  function fitText(ctx, text, max, weight, px, min) {
    var size = px;
    ctx.font = sans(weight, size);
    while (size > (min || 9) && ctx.measureText(text).width > max) {
      size -= 1;
      ctx.font = sans(weight, size);
    }
    return size;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function loadImage(src) {
    if (!src) return null;
    var im = new Image();
    im.decoding = "async";
    im.src = src;
    return im;
  }

  function mount(canvas, data, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    var steps = data.steps || [];
    if (!steps.length) return null;

    var reduced = false;
    try {
      reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { /* animate */ }

    var pace = global.Pacing
      ? global.Pacing.plan("mates", steps.length, global.Pacing.merge(data, opts))
      : { stepMs: Math.max(FALLBACK.minStep, Math.min(FALLBACK.maxStep,
          Math.round(FALLBACK.targetMs / Math.max(1, steps.length)))),
          targetMs: FALLBACK.targetMs, profile: "mates" };
    var baseStepMs = pace.stepMs;
    var speed = 1, stepMs = baseStepMs;
    var pos = 0;                 // fractional step index
    var playing = false, raf = 0, last = 0, destroyed = false;

    var faceA = loadImage(data.a.img), faceB = loadImage(data.b.img);

    /* ---------------- drawing ---------------- */

    /* The tallest season in THIS matchup sets the height, once. A pairing where
     * nobody ever had more than two decorated teammates was leaving half the
     * card as empty black — and a canvas that resized per season would make the
     * feed jump under the reader's thumb every step. */
    var ROW_H = 34, HEAD_H = 30, PAD_B = 12;
    var maxRows = 1;
    for (var si = 0; si < steps.length; si++) {
      var sa = steps[si].a, sb = steps[si].b;
      maxRows = Math.max(maxRows,
        sa ? sa.mates.length : 0,
        sb ? sb.mates.length : 0);
    }

    function size() {
      var cssW = canvas.clientWidth || 360;
      var sbH = Math.round(Math.max(96, Math.min(124, cssW * 0.30)));
      var cssH = sbH + HEAD_H + maxRows * ROW_H + PAD_B;
      var dpr = Math.min(2, global.devicePixelRatio || 1);
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.height = cssH + "px";
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: cssW, h: cssH, sbH: sbH };
    }

    function head(ctx, im, cx, cy, r, ring, name) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = PANEL;
      ctx.fill();
      ctx.clip();
      if (im && im.complete && im.naturalWidth) {
        ctx.drawImage(im, cx - r, cy - r, r * 2, r * 2);
      } else {
        // Initials rather than an empty disc: the card still reads while the
        // tile loads, and for the handful with no tile at all.
        var ini = String(name || "").split(/\s+/).map(function (w) { return w[0] || ""; })
          .join("").slice(0, 2).toUpperCase();
        ctx.fillStyle = SEC;
        ctx.font = sans(700, r * 0.8);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(ini, cx, cy + r * 0.04);
      }
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = ring;
      ctx.stroke();
      ctx.restore();
    }

    function scoreboard(g, valA, valB) {
      var h = g.sbH;
      ctx.fillStyle = PANEL;
      ctx.fillRect(0, 0, g.w, h);
      ctx.fillStyle = "rgba(255,255,255,.06)";
      ctx.fillRect(0, h - 1, g.w, 1);

      var r = Math.min(26, h * 0.26);
      var cy = h * 0.42;
      var leftX = g.w * 0.19, rightX = g.w * 0.81;
      var leadA = valA >= valB;

      head(ctx, faceA, leftX, cy, r, leadA ? GOLD : A_TINT, data.a.name);
      head(ctx, faceB, rightX, cy, r, !leadA ? GOLD : B_TINT, data.b.name);

      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = TEXT;
      var fs = fitText(ctx, data.a.name, g.w * 0.34, 700, 13, 9);
      ctx.font = sans(700, fs);
      ctx.fillText(data.a.name, leftX, cy + r + 15);
      fs = fitText(ctx, data.b.name, g.w * 0.34, 700, 13, 9);
      ctx.font = sans(700, fs);
      ctx.fillText(data.b.name, rightX, cy + r + 15);

      ctx.font = mono(700, 22);
      ctx.fillStyle = leadA ? GOLD : A_TINT;
      ctx.fillText(fmtPts(valA), leftX, cy + r + 38);
      ctx.fillStyle = !leadA ? GOLD : B_TINT;
      ctx.fillText(fmtPts(valB), rightX, cy + r + 38);

      // gap pill
      var gap = Math.abs(valA - valB);
      var txt = (gap ? "+" + fmtPts(gap) : "level");
      ctx.font = mono(700, 13);
      var w = ctx.measureText(txt).width + 22;
      var px = g.w / 2 - w / 2, py = cy - 13;
      roundRect(ctx, px, py, w, 26, 13);
      ctx.fillStyle = "rgba(255,255,255,.07)";
      ctx.fill();
      ctx.fillStyle = gap ? GOLD : SEC;
      ctx.fillText(txt, g.w / 2, py + 18);
      ctx.font = mono(600, 8);
      ctx.fillStyle = SEC;
      ctx.fillText("GAP", g.w / 2, py - 5);
      return h;
    }

    /* One side's teammates for the season the playhead is on. `fade` runs 0→1
     * across the first third of a step so a season arrives rather than snaps. */
    function column(g, side, x0, x1, top, fade) {
      var tint = side === "a" ? A_TINT : B_TINT;
      var s = steps[Math.min(steps.length - 1, Math.floor(pos))];
      var season = side === "a" ? s.a : s.b;
      var mid = (x0 + x1) / 2;

      ctx.textAlign = "center";
      ctx.fillStyle = SEC;
      ctx.font = mono(600, 9);
      if (!season) {
        ctx.fillText("career over", mid, top + 16);
        return;
      }
      ctx.fillText(season.y + (season.t ? " · " + season.t : ""), mid, top + 12);

      if (!season.mates.length) {
        ctx.fillStyle = "rgba(255,255,255,.25)";
        ctx.font = sans(600, 11);
        ctx.fillText("no decorated teammates", mid, top + 34);
        return;
      }

      var y = top + 26;
      var rowH = ROW_H;
      for (var i = 0; i < season.mates.length; i++) {
        var m = season.mates[i];
        // Rows arrive one after another rather than all at once.
        var a = Math.max(0, Math.min(1, (fade - i * 0.12) / 0.3));
        if (a <= 0) break;
        ctx.save();
        ctx.globalAlpha = a;
        roundRect(ctx, x0, y, x1 - x0, rowH - 5, 6);
        ctx.fillStyle = "rgba(255,255,255,.045)";
        ctx.fill();

        ctx.textAlign = "left";
        ctx.fillStyle = TEXT;
        var fs = fitText(ctx, m.n, (x1 - x0) - 46, 700, 12, 8);
        ctx.font = sans(700, fs);
        ctx.fillText(m.n, x0 + 8, y + 13);

        ctx.fillStyle = SEC;
        var labels = m.a.join(" · ");
        fs = fitText(ctx, labels, (x1 - x0) - 46, 500, 9, 7);
        ctx.font = sans(500, fs);
        ctx.fillText(labels, x0 + 8, y + 24);

        ctx.textAlign = "right";
        ctx.fillStyle = tint;
        ctx.font = mono(700, 12);
        ctx.fillText("+" + fmtPts(m.p), x1 - 8, y + 19);
        ctx.restore();
        y += rowH;
      }
    }

    function draw() {
      if (destroyed) return;
      var g = size();
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, g.w, g.h);

      /* The playhead runs 0 → steps.length, one unit per season, so the last
       * season has a step of its own to accrue in. Ending at steps.length - 1
       * left the totals frozen one season short: the card claimed 42.4 and the
       * scoreboard showed the value before the final year's teammates. */
      var i = Math.min(steps.length - 1, Math.floor(pos));
      var frac = Math.min(1, pos - i);
      var s = steps[i], prev = i > 0 ? steps[i - 1] : { ca: 0, cb: 0 };
      // Totals count up across the step rather than jumping on arrival.
      var ease = Math.min(1, frac / 0.45);
      ease = ease * ease * (3 - 2 * ease);
      var valA = prev.ca + (s.ca - prev.ca) * ease;
      var valB = prev.cb + (s.cb - prev.cb) * ease;

      var sbH = scoreboard(g, valA, valB);

      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(255,255,255,.5)";
      ctx.font = mono(700, 10);
      ctx.fillText("SEASON " + s.n, g.w / 2, sbH + 18);

      var pad = 10, gutter = 8;
      var colW = (g.w - pad * 2 - gutter) / 2;
      var top = sbH + 30;
      column(g, "a", pad, pad + colW, top, Math.min(1, frac / 0.45));
      column(g, "b", pad + colW + gutter, g.w - pad, top, Math.min(1, frac / 0.45));

      // progress hairline
      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.fillRect(0, g.h - 2, g.w, 2);
      ctx.fillStyle = A_TINT;
      ctx.fillRect(0, g.h - 2, g.w * (pos / steps.length), 2);
    }

    /* ---------------- transport ---------------- */

    function frame(now) {
      if (destroyed) return;
      if (!last) last = now;
      var dt = now - last;
      last = now;
      pos += dt / stepMs;
      if (pos >= steps.length) {
        pos = steps.length;
        draw();
        playing = false;
        raf = 0;
        if (opts.onEnd) opts.onEnd();
        return;
      }
      draw();
      raf = global.requestAnimationFrame(frame);
    }

    function play() {
      if (playing || destroyed || reduced) return;
      if (pos >= steps.length) pos = 0;
      playing = true;
      last = 0;
      raf = global.requestAnimationFrame(frame);
    }
    function pause() {
      playing = false;
      if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
    }
    function toggle() { playing ? pause() : play(); }
    function setSpeed(v) {
      speed = v;
      stepMs = Math.max(120, Math.round(baseStepMs / speed));
    }
    function seek(frac) {
      pos = Math.max(0, Math.min(steps.length, frac * steps.length));
      draw();
    }
    function destroy() {
      destroyed = true;
      pause();
      global.removeEventListener("resize", onResize);
      global.clearTimeout(settle);
    }

    var onResize = function () { if (!playing) draw(); };
    global.addEventListener("resize", onResize);

    if (reduced) pos = steps.length;
    draw();
    // The face tiles usually land after the first paint.
    var settle = global.setTimeout(function () { if (!playing) draw(); }, 900);
    faceA && (faceA.onload = function () { if (!playing) draw(); });
    faceB && (faceB.onload = function () { if (!playing) draw(); });

    return {
      play: play, pause: pause, toggle: toggle, seek: seek, setSpeed: setSpeed,
      destroy: destroy,
      get playing() { return playing; },
      get progress() { return pos / steps.length; },
      get speed() { return speed; },
      get durationMs() { return stepMs * steps.length; },
      get pace() { return pace; },
      reducedMotion: reduced,
      steps: steps.length
    };
  }

  global.MatesPlayer = { mount: mount };
})(window);
