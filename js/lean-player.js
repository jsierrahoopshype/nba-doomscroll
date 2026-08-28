/* NBA Doomscroll — media lean player
 *
 * A port of the HoopsHype media-vote video into a feed card. Three acts, the
 * same three the video runs and in its order:
 *
 *   1. His biggest media boosters and snubbers, vs the panel
 *   2. The outlets that boosted and snubbed him, vs the panel
 *   3. How each region's media rated him, vs US media
 *
 * Each is a diverging bar chart around a zero axis: boosters growing right in
 * green with their names right-aligned against the axis, snubbers growing left
 * in red with their names on the other side. Rows arrive one at a time, the
 * bar easing out to its length, the way the video plays them.
 *
 * WHAT CHANGED FROM 1080x1080 TO A PHONE CARD
 *
 * The video's axis sits dead centre, which it can afford at 1080px wide: the
 * name column is 180px there. At a 390px card that would leave about 65px for
 * "Kendrick Perkins", so the axis sits at 44% instead and the type is set
 * relative to card width rather than scaled down from the video. Six rows a
 * side becomes five. Everything else — the palette sampled from the frames, the
 * rounded bars, the label/value placement, the order of the acts — is the
 * video's.
 *
 * Same control contract as race-player, mates-player and compare-player, so
 * app.js drives all four through one lifecycle.
 */
(function (global) {
  "use strict";

  var ACT_MS = 7000;            // per act, before the hold
  var HOLD_BEATS = 1.6;         // dwell on a finished act before the next
  var GROW_BEATS = 1.0;         // how long a bar takes to reach its length

  /* Sampled from the published video's frames. */
  var BG = "#0a090c";
  var GREEN = "#33c657";
  var RED = "#ed4341";
  var GREEN_LBL = "#51d87f";
  var RED_LBL = "#f2726f";
  var AXIS = "#3b3c41";
  var TEXT = "#f5f4f7";
  var SUB = "#7d7c7f";

  /* Jost rather than DM Sans.
   *
   * The published video sets its type in Futura Today, a commercial Bauer face
   * whose webfont licence is per-domain and does not travel from hoopshype.com
   * to hoopsmatic.com. Jost is an open Futura revival already on Google Fonts,
   * which this page loads from anyway, so it costs one extra family in the
   * existing request and no legal surface at all. DM Sans stays the fallback
   * and the rest of the app is untouched — this is the one card whose
   * reference is a Futura layout. */
  function sans(w, px) { return w + " " + px + "px Jost,'DM Sans',-apple-system,sans-serif"; }

  function ellipsis(ctx, text, max) {
    if (!text) return "";
    if (ctx.measureText(text).width <= max) return text;
    var s = text;
    while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
    return s + "…";
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, h / 2));
    if (w < 0) { x += w; w = -w; }
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

  function initials(name) {
    return String(name || "").split(/\s+/)
      .map(function (w) { return w[0] || ""; }).join("").slice(0, 2).toUpperCase();
  }

  var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  /* Always one decimal, the way the video prints it: "+6.0", not "+6". A column
   * where some rows carry a decimal and others do not reads as inconsistent
   * data rather than as a round number. */
  var fmt = function (v) { return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1); };

  function mount(canvas, data, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    var acts = (data.acts || []).filter(function (a) { return (a.hi || []).length || (a.lo || []).length; });
    if (!acts.length) return null;

    var ROWS = 5;
    acts = acts.map(function (a) {
      return {
        title: a.title,
        hi: (a.hi || []).slice(0, ROWS),
        lo: (a.lo || []).slice(0, ROWS)
      };
    });

    /* One beat per row, plus a hold at the end of each act. The playhead is a
     * float over the whole timeline, so seeking lands anywhere. */
    var plan = [];
    var total = 0;
    acts.forEach(function (a, i) {
      var rows = a.hi.length + a.lo.length;
      plan.push({ act: i, start: total, rows: rows });
      total += rows + HOLD_BEATS;
    });

    var reduced = false;
    try {
      reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { /* animate */ }

    var baseStepMs = Math.max(180, Math.round(ACT_MS / Math.max(4, total / acts.length)));
    var speed = 1, stepMs = baseStepMs;
    var pos = 0;
    var playing = false, raf = 0, last = 0, destroyed = false;
    var face = loadImage(data.img);

    /* Flags are images now, not emoji: Windows ships no regional-indicator
     * glyphs, so 🇺🇸 came out as the letters "US" for most readers. One Image
     * per distinct country across the whole card, shared by every row that
     * needs it, and a row simply draws no flag until its image is ready. */
    var flags = {};
    acts.forEach(function (a) {
      a.hi.concat(a.lo).forEach(function (r) {
        if (r.flag && !flags[r.flag]) {
          flags[r.flag] = loadImage(r.flag);
          flags[r.flag].onload = function () { if (!playing) draw(); };
        }
      });
    });

    function actAt(p) {
      for (var i = plan.length - 1; i >= 0; i--) if (p >= plan[i].start) return plan[i];
      return plan[0];
    }

    function size() {
      var w = canvas.clientWidth || 360;
      var head = Math.round(w * 0.15);
      var rowH = Math.max(20, Math.round(w * 0.066));
      var maxRows = acts.reduce(function (m, a) { return Math.max(m, a.hi.length, a.lo.length); }, 0);
      var capH = Math.round(w * 0.055);
      var h = head + capH + maxRows * rowH + capH + maxRows * rowH + Math.round(w * 0.03);
      var dpr = Math.min(2, global.devicePixelRatio || 1);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        canvas.style.height = h + "px";
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: w, h: h, head: head, rowH: rowH, capH: capH, axis: Math.round(w * 0.44) };
    }

    function header(g, act) {
      var r = Math.round(g.head * 0.34);
      var cx = Math.round(g.w * 0.055) + r, cy = Math.round(g.head * 0.46);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "#1a1920";
      ctx.fill();
      ctx.clip();
      if (face && face.complete && face.naturalWidth) ctx.drawImage(face, cx - r, cy - r, r * 2, r * 2);
      else {
        ctx.fillStyle = SUB;
        ctx.font = sans(700, r * 0.75);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials(data.player), cx, cy);
      }
      ctx.restore();

      var x = cx + r + Math.round(g.w * 0.035);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = TEXT;
      var nameSize = Math.round(g.w * 0.058);
      ctx.font = sans(700, nameSize);
      ctx.fillText(ellipsis(ctx, data.player, g.w - x - 6), x, cy + nameSize * 0.18);
      ctx.fillStyle = SUB;
      var subSize = Math.round(g.w * 0.026);
      ctx.font = sans(500, subSize);
      ctx.fillText(ellipsis(ctx, act.title, g.w - x - 6), x, cy + nameSize * 0.18 + subSize + 6);
    }

    /* One side of one act. `n` is how many of this side's rows have started. */
    function side(g, rows, top, up, n, beat) {
      if (!rows.length) return;
      var ax = g.axis;
      var big = 0;
      for (var i = 0; i < rows.length; i++) big = Math.max(big, Math.abs(rows[i].diff));
      var room = up ? g.w - ax - Math.round(g.w * 0.13) : ax - Math.round(g.w * 0.11);
      var scale = big ? room / big : 0;
      var barH = Math.round(g.rowH * 0.72);
      var nameSize = Math.round(g.w * 0.031);
      var subSize = Math.round(g.w * 0.023);
      var valSize = Math.round(g.w * 0.031);

      ctx.textAlign = up ? "left" : "right";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = up ? GREEN_LBL : RED_LBL;
      ctx.font = sans(700, Math.round(g.w * 0.029));
      ctx.fillText(up ? "MOST BOOSTED" : "MOST SNUBBED",
        up ? ax + 8 : ax - 8, top - Math.round(g.capH * 0.30));

      for (var j = 0; j < rows.length; j++) {
        if (j >= n) break;
        var r = rows[j];
        var age = beat - j;
        var grow = easeOut(Math.max(0, Math.min(1, age / GROW_BEATS)));
        var y = top + j * g.rowH;
        var len = Math.abs(r.diff) * scale * grow;

        ctx.fillStyle = up ? GREEN : RED;
        roundRect(ctx, ax, y, up ? len : -len, barH, Math.round(barH * 0.28));
        ctx.fill();

        // Label column on the far side of the axis from the bar.
        var lx = up ? ax - 8 : ax + 8;
        ctx.textAlign = up ? "right" : "left";
        var labelRoom = (up ? ax : g.w - ax) - Math.round(g.w * 0.06);
        /* The country marker is the flag image when it has loaded and the ISO
         * code when it has not. flagcdn is a third-party host and this is a
         * static site: it can be blocked, slow, or simply absent offline, and a
         * marker that disappears in those cases is worse than a plainer one
         * that always shows. Same footprint either way, so nothing reflows when
         * the image lands. */
        var im = r.flag && flags[r.flag];
        var ready = im && im.complete && im.naturalWidth;
        var marker = ready || r.iso;
        var fw = marker ? Math.round(nameSize * 1.28) : 0;
        var fh = ready ? Math.round(fw * (im.naturalHeight / im.naturalWidth))
                       : Math.round(nameSize * 0.86);
        var gap = marker ? Math.round(nameSize * 0.42) : 0;
        var nameY = y + barH * 0.5 - (r.sub ? 1 : -nameSize * 0.35);

        ctx.font = sans(700, nameSize);
        ctx.fillStyle = TEXT;
        var txt = ellipsis(ctx, r.label, labelRoom - fw - gap);
        var tw = ctx.measureText(txt).width;
        /* The flag sits outside the name, away from the axis, so the names stay
         * aligned to the bars however wide the country markers are. */
        function drawMarker(mx) {
          if (!marker) return;
          if (ready) { ctx.drawImage(im, mx, nameY - fh + 1, fw, fh); return; }
          ctx.save();
          roundRect(ctx, mx, nameY - fh + 1, fw, fh, 2);
          ctx.fillStyle = "rgba(255,255,255,.10)";
          ctx.fill();
          ctx.font = sans(700, Math.round(nameSize * 0.62));
          ctx.fillStyle = SUB;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(r.iso, mx + fw / 2, nameY - fh / 2 + 1);
          ctx.restore();
          ctx.textBaseline = "alphabetic";
        }
        if (up) {
          ctx.textAlign = "right";
          ctx.fillText(txt, lx, nameY);
          drawMarker(lx - tw - gap - fw);
        } else {
          ctx.textAlign = "left";
          ctx.fillText(txt, lx, nameY);
          drawMarker(lx + tw + gap);
        }
        if (r.sub) {
          ctx.font = sans(500, subSize);
          ctx.fillStyle = SUB;
          ctx.fillText(ellipsis(ctx, r.sub, labelRoom), lx, y + barH * 0.5 + subSize + 1);
        }

        // Value at the growing end of the bar, so it travels with it.
        ctx.font = sans(700, valSize);
        ctx.fillStyle = up ? GREEN : RED;
        ctx.textAlign = up ? "left" : "right";
        ctx.fillText(fmt(r.diff), up ? ax + len + 7 : ax - len - 7, y + barH * 0.5 + valSize * 0.36);
      }
    }

    function draw() {
      var g = size();
      var p = actAt(pos);
      var a = acts[p.act];
      var beat = pos - p.start;

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, g.w, g.h);
      header(g, a);

      /* The canvas height is the tallest act, so the card never resizes under
       * the reader mid-play. The snubbed band, though, starts right after THIS
       * act's boosted rows rather than at a fixed offset — otherwise act 3,
       * with one green bar against five red, opens a hole where four rows would
       * have been. The video moves the label the same way. */
      var hiTop = g.head + g.capH;
      var loTop = hiTop + a.hi.length * g.rowH + g.capH;

      ctx.fillStyle = AXIS;
      ctx.fillRect(g.axis, g.head + Math.round(g.capH * 0.4), 1,
        g.h - g.head - Math.round(g.capH * 0.4) - Math.round(g.w * 0.02));

      side(g, a.hi, hiTop, true, Math.ceil(beat), beat);
      side(g, a.lo, loTop, false, Math.ceil(beat - a.hi.length), beat - a.hi.length);

      // Act counter, bottom right, the way the races carry their step readout.
      if (acts.length > 1) {
        ctx.textAlign = "right";
        ctx.font = sans(600, Math.round(g.w * 0.024));
        ctx.fillStyle = SUB;
        ctx.fillText((p.act + 1) + "/" + acts.length, g.w - Math.round(g.w * 0.03), g.h - 6);
      }
    }

    function frame(ts) {
      if (destroyed) return;
      if (!last) last = ts;
      pos += (ts - last) / stepMs;
      last = ts;
      if (pos >= total) {
        pos = total;
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
      if (pos >= total) pos = 0;
      playing = true;
      last = 0;
      raf = global.requestAnimationFrame(frame);
    }
    function pause() {
      playing = false;
      if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
    }
    function toggle() { playing ? pause() : play(); }
    function setSpeed(v) { speed = v; stepMs = Math.max(60, Math.round(baseStepMs / speed)); }
    function seek(f) { pos = Math.max(0, Math.min(total, f * total)); draw(); }
    function destroy() {
      destroyed = true;
      pause();
      global.removeEventListener("resize", onResize);
      global.clearTimeout(settle);
    }

    var onResize = function () { if (!playing) draw(); };
    global.addEventListener("resize", onResize);

    /* Reduced motion lands on the last act, finished, rather than on nothing. */
    if (reduced) pos = total;
    draw();
    var settle = global.setTimeout(function () { if (!playing) draw(); }, 900);
    face && (face.onload = function () { if (!playing) draw(); });

    return {
      play: play, pause: pause, toggle: toggle, seek: seek, setSpeed: setSpeed,
      destroy: destroy,
      get playing() { return playing; },
      get progress() { return pos / total; },
      get speed() { return speed; },
      get durationMs() { return stepMs * total; },
      reducedMotion: reduced,
      steps: total
    };
  }

  global.LeanPlayer = { mount: mount };
})(window);
