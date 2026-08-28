/* NBA Doomscroll — Comparison player
 *
 * A port of nba-player-data's nba-comparison-video-generator into a feed card:
 * a fixed scoreboard over a list of metrics that arrives one at a time. Each
 * row lands, the winning half flashes and then settles tinted, and the two
 * totals in the header climb as they do.
 *
 * WHY THIS IS NOT THE VS CARD
 *
 * The VS card is a verdict — final score, four section totals, read it and
 * move on. This is the argument that produced it. Same numbers, same scorer,
 * but you watch the lead change hands, which is the only reason to animate a
 * comparison at all. The pools are built disjoint (tools/build_compare.mjs) so
 * the two never show you the same pairing on one scroll.
 *
 * Deliberately the same control contract as js/race-player.js and
 * js/mates-player.js — play, pause, toggle, seek, setSpeed, destroy, plus
 * `playing`, `progress` and `reducedMotion` — so app.js drives all three
 * through one lifecycle. Three renderers, one set of plumbing.
 *
 * No arithmetic happens here. Every row and both totals were decided by
 * js/vs-score.js at build time, which is the same function hoopsmatic.com's
 * comparison runs. This file only draws them.
 */
(function (global) {
  "use strict";

  /* Pace. Eleven seconds across seventy-odd rows was about 150ms a row, which
   * is faster than anyone can read a stat line — the card looked busy rather
   * than legible. The video gives each row two thirds of a second; this gives
   * roughly a third, which is the compromise a feed card can afford, and the
   * speed control still doubles it for anyone who wants the original pace. */
  var TARGET_MS = 24000;
  var MIN_STEP = 190, MAX_STEP = 420;
  var BG = "#12151c";
  var PANEL = "#1a1f29";
  var ROW = "#1e2430";
  var TEXT = "#f5f5f7";
  var SEC = "#8a93a6";
  var A_TINT = "#3b82f6";
  var B_TINT = "#ef6a5a";
  var GOLD = "#caa23a";

  var ROW_H = 30, GAP = 4, HEAD_H = 26, VISIBLE = 6;
  var FLASH_STEPS = 0.9;        // how long, in reveal steps, a new row glows

  function sans(w, px) { return w + " " + px + "px 'DM Sans',-apple-system,sans-serif"; }
  function mono(w, px) { return w + " " + px + "px 'JetBrains Mono',monospace"; }

  function fitText(ctx, text, max, weight, px, min) {
    var size = px;
    ctx.font = sans(weight, size);
    while (size > (min || 8) && ctx.measureText(text).width > max) {
      size -= 1;
      ctx.font = sans(weight, size);
    }
    return size;
  }

  function ellipsis(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    var s = text;
    while (s.length > 1 && ctx.measureText(s + "…").width > max) s = s.slice(0, -1);
    return s + "…";
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

  function initials(name) {
    return String(name || "").split(/\s+/)
      .map(function (w) { return w[0] || ""; }).join("").slice(0, 2).toUpperCase();
  }

  function mount(canvas, data, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    var rows = data.rows || [];
    if (!rows.length) return null;

    /* Rows arrive as arrays, not objects: [cat, aValue, bValue, winner, counts],
     * and [null, label] for a section header. At 72 rows a card across fifteen
     * hundred cards, repeated JSON keys were about a third of the payload and
     * carried no information. Unpacked once here, into the shape the drawing
     * code wants.
     *
     * The playhead runs over REVEALABLE rows, not over every row: a section
     * header is not a beat, it is a label that appears with the first metric
     * underneath it. Each row remembers its own reveal index and its y, so
     * drawing a frame is a lookup rather than a walk. */
    var layout = [];
    var steps = 0, y = 0;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r[0] === null) {
        layout.push({ h: true, label: r[1], y: y, at: steps });
        y += HEAD_H;
      } else {
        layout.push({
          h: false, y: y, at: steps,
          row: { cat: r[0], a: r[1], b: r[2], w: r[3] === 0 ? "a" : "b", c: r[4] }
        });
        y += ROW_H + GAP;
        steps++;
      }
    }
    if (!steps) return null;
    var contentH = y;

    var reduced = false;
    try {
      reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { /* animate */ }

    /* The video ends on a card naming each man's biggest wins rather than just
     * the scoreline, and the card was ending on a wall of rows. OUTRO_BEATS of
     * timeline past the last row buys that screen; the data for it was baked by
     * the builder from the same VsScore.topWins the static VS card uses. */
    var wins = data.wins || { a: [], b: [] };
    var hasOutro = (wins.a && wins.a.length) || (wins.b && wins.b.length);
    var OUTRO_BEATS = hasOutro ? 4 : 0;
    var span = steps + OUTRO_BEATS;

    var baseStepMs = Math.max(MIN_STEP, Math.min(MAX_STEP, Math.round(TARGET_MS / steps)));
    var speed = 1, stepMs = baseStepMs;
    var pos = 0;
    var playing = false, raf = 0, last = 0, destroyed = false;
    var scrollY = 0, scrollInit = false;

    var faceA = loadImage(data.a.img), faceB = loadImage(data.b.img);

    /* ---------------- geometry ---------------- */

    function size() {
      var cssW = canvas.clientWidth || 360;
      /* Tall enough for what the scoreboard actually stacks: head, name, score.
       * At 0.26 of a 360px card the panel came out 94px and the score baseline
       * landed at 95, so the running totals were painted a pixel below their
       * own panel and sat on top of the first row of the list. */
      var sbH = Math.round(Math.max(100, Math.min(120, cssW * 0.29)));
      var bodyH = Math.min(contentH, VISIBLE * (ROW_H + GAP) + HEAD_H);
      var cssH = sbH + bodyH + 8;
      var dpr = Math.min(2, global.devicePixelRatio || 1);
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
        canvas.style.height = cssH + "px";
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: cssW, h: cssH, sbH: sbH, bodyH: bodyH };
    }

    /* Points on the board at this playhead. Counted from the rows themselves so
     * the header can never disagree with what is on screen — and because rows
     * that award a section point but not an overall one (the combine) carry
     * c:0 and must not move these numbers. */
    function scoreAt(p) {
      var a = 0, b = 0;
      for (var i = 0; i < layout.length; i++) {
        var L = layout[i];
        if (L.h || L.at >= p || !L.row.c) continue;
        if (L.row.w === "a") a++; else b++;
      }
      return { a: a, b: b };
    }

    function head(im, cx, cy, r, ring, name) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = PANEL;
      ctx.fill();
      ctx.clip();
      if (im && im.complete && im.naturalWidth) {
        ctx.drawImage(im, cx - r, cy - r, r * 2, r * 2);
      } else {
        ctx.fillStyle = SEC;
        ctx.font = sans(700, r * 0.8);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials(name), cx, cy + r * 0.04);
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

    function scoreboard(g, sc) {
      ctx.fillStyle = PANEL;
      ctx.fillRect(0, 0, g.w, g.sbH);
      ctx.fillStyle = "rgba(255,255,255,.06)";
      ctx.fillRect(0, g.sbH - 1, g.w, 1);

      var r = Math.min(23, g.sbH * 0.25);
      var cy = g.sbH * 0.33;
      var lx = g.w * 0.19, rx = g.w * 0.81;
      var leadA = sc.a >= sc.b;

      head(faceA, lx, cy, r, leadA ? GOLD : A_TINT, data.a.name);
      head(faceB, rx, cy, r, !leadA ? GOLD : B_TINT, data.b.name);

      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = TEXT;
      var fs = fitText(ctx, data.a.name, g.w * 0.33, 700, 12, 8);
      ctx.font = sans(700, fs);
      ctx.fillText(data.a.name, lx, cy + r + 13);
      fs = fitText(ctx, data.b.name, g.w * 0.33, 700, 12, 8);
      ctx.font = sans(700, fs);
      ctx.fillText(data.b.name, rx, cy + r + 13);

      ctx.font = mono(700, 21);
      ctx.fillStyle = leadA ? GOLD : A_TINT;
      ctx.fillText(String(sc.a), lx, cy + r + 34);
      ctx.fillStyle = !leadA ? GOLD : B_TINT;
      ctx.fillText(String(sc.b), rx, cy + r + 34);

      ctx.font = sans(600, 11);
      ctx.fillStyle = SEC;
      ctx.fillText("VS", g.w / 2, cy + 4);
      ctx.font = mono(500, 10);
      var done = Math.min(steps, Math.floor(pos));
      ctx.fillText(done + "/" + steps, g.w / 2, cy + r + 20);
    }

    function body(g) {
      var top = g.sbH;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, top, g.w, g.bodyH);
      ctx.clip();
      ctx.fillStyle = BG;
      ctx.fillRect(0, top, g.w, g.bodyH);

      var pad = Math.round(g.w * 0.035);
      var rowW = g.w - pad * 2;
      var valW = rowW * 0.24;
      var catX = pad + valW, catW = rowW - valW * 2;

      for (var i = 0; i < layout.length; i++) {
        var L = layout[i];
        if (L.at >= pos) break;                       // not revealed yet
        var dy = top + L.y - scrollY;
        if (dy > top + g.bodyH || dy < top - 40) continue;

        if (L.h) {
          ctx.textAlign = "left";
          ctx.textBaseline = "alphabetic";
          ctx.font = sans(700, 10);
          ctx.fillStyle = SEC;
          ctx.fillText(L.label.toUpperCase(), pad, dy + HEAD_H - 9);
          ctx.fillStyle = "rgba(255,255,255,.08)";
          ctx.fillRect(pad, dy + HEAD_H - 4, rowW, 1);
          continue;
        }

        var row = L.row;
        var age = pos - L.at;                          // in reveal steps
        var glow = age < FLASH_STEPS ? (1 - age / FLASH_STEPS) : 0;
        var winA = row.w === "a";
        var tint = winA ? A_TINT : B_TINT;

        roundRect(ctx, pad, dy, rowW, ROW_H, 6);
        ctx.fillStyle = ROW;
        ctx.fill();

        /* The winner's tint covers their VALUE column, not half the row.
         *
         * The generator sets its boundaries at 42% and 58% of the width, which
         * leaves the category label in the middle on plain surface — so the
         * colour reads as "this number won" rather than as a block dividing the
         * row in two. Filling to the midpoint, which is what this did first,
         * swallows the label and looks like a progress bar. Same proportions
         * here, measured off the row rather than the canvas. */
        var tintEnd = pad + rowW * 0.42;
        var tintStart = pad + rowW * 0.58;
        ctx.save();
        roundRect(ctx, pad, dy, rowW, ROW_H, 6);
        ctx.clip();
        ctx.globalAlpha = 0.16 + glow * 0.34;
        ctx.fillStyle = tint;
        if (winA) ctx.fillRect(pad, dy, tintEnd - pad, ROW_H);
        else ctx.fillRect(tintStart, dy, pad + rowW - tintStart, ROW_H);
        ctx.restore();

        /* And the 3px edge the generator puts on the winner's outside edge,
         * which is what makes a settled row readable at a glance down the
         * column rather than only in isolation. */
        ctx.fillStyle = tint;
        ctx.fillRect(winA ? pad : pad + rowW - 3, dy + 3, 3, ROW_H - 6);

        ctx.textBaseline = "middle";
        var my = dy + ROW_H / 2;

        ctx.font = mono(700, 12);
        ctx.textAlign = "left";
        ctx.fillStyle = winA ? TEXT : SEC;
        ctx.fillText(ellipsis(ctx, String(row.a), valW - 6), pad + 7, my);

        ctx.textAlign = "right";
        ctx.fillStyle = !winA ? TEXT : SEC;
        ctx.fillText(ellipsis(ctx, String(row.b), valW - 6), pad + rowW - 7, my);

        ctx.textAlign = "center";
        ctx.font = sans(500, 10.5);
        ctx.fillStyle = SEC;
        ctx.fillText(ellipsis(ctx, row.cat, catW - 8), catX + catW / 2, my);
      }

      /* Rows scroll up and out under the scoreboard. Hard-clipped, the one
       * being cut in half looks like a rendering bug rather than like a list
       * moving, so the top 18px fades it out. */
      var fade = ctx.createLinearGradient(0, top, 0, top + 18);
      fade.addColorStop(0, BG);
      fade.addColorStop(1, "rgba(18,21,28,0)");
      ctx.fillStyle = fade;
      ctx.fillRect(0, top, g.w, 18);
      ctx.restore();
    }

    /* The newest row is kept near the bottom of the visible area: everything
     * above it has landed, and nothing below it has, so leaving a third of the
     * panel empty under the playhead was just dead black. Eased rather than
     * snapped, or the list jumps under the reader's eye every step. */
    function targetScroll() {
      var cur = null;
      for (var i = layout.length - 1; i >= 0; i--) {
        if (!layout[i].h && layout[i].at < pos) { cur = layout[i]; break; }
      }
      if (!cur) return 0;
      var g = { bodyH: Math.min(contentH, VISIBLE * (ROW_H + GAP) + HEAD_H) };
      var want = cur.y + ROW_H - g.bodyH * 0.86;
      return Math.max(0, Math.min(contentH - g.bodyH, want));
    }

    /* The closing card: both heads, the final score, and the two stats each man
     * won by the widest margin. Fades in over its first beat so it arrives
     * rather than cuts. */
    function outro(g, t) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, t));
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, g.w, g.h);

      var sc = scoreAt(steps);
      var r = Math.round(Math.min(34, g.w * 0.10));
      var cy = Math.round(g.h * 0.17);
      var lx = g.w * 0.27, rx = g.w * 0.73;
      var aWon = sc.a >= sc.b;

      head(faceA, lx, cy, r, aWon ? GOLD : A_TINT, data.a.name);
      head(faceB, rx, cy, r, !aWon ? GOLD : B_TINT, data.b.name);

      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = TEXT;
      var ns = fitText(ctx, data.a.name, g.w * 0.42, 700, 14, 9);
      ctx.font = sans(700, ns);
      ctx.fillText(data.a.name, lx, cy + r + 16);
      ns = fitText(ctx, data.b.name, g.w * 0.42, 700, 14, 9);
      ctx.font = sans(700, ns);
      ctx.fillText(data.b.name, rx, cy + r + 16);

      ctx.font = mono(700, Math.round(g.w * 0.085));
      ctx.fillStyle = aWon ? GOLD : A_TINT;
      ctx.fillText(String(sc.a), lx, cy + r + 16 + Math.round(g.w * 0.085));
      ctx.fillStyle = !aWon ? GOLD : B_TINT;
      ctx.fillText(String(sc.b), rx, cy + r + 16 + Math.round(g.w * 0.085));

      ctx.font = sans(600, Math.round(g.w * 0.030));
      ctx.fillStyle = SEC;
      ctx.fillText("BIGGEST WINS", g.w / 2, cy + r + Math.round(g.w * 0.175));

      /* One column per player, their own wins under their own name, so the
       * reader does not have to match a stat back to a side. */
      var top = cy + r + Math.round(g.w * 0.225);
      /* Each entry is two lines, so the step has to clear both plus air. At
       * 0.062 the value line of one win sat on the stat line of the next. */
      var lineH = Math.round(g.w * 0.092);
      /* And the column has to stay inside its own half. These are centred on
       * lx / rx, so the widest a line may be is twice the gap to the middle —
       * "$321,938,890 vs $107,892,430" otherwise reaches across the gutter. */
      var colMax = g.w * 0.40;
      [[wins.a || [], lx, A_TINT], [wins.b || [], rx, B_TINT]].forEach(function (col) {
        var list = col[0], x = col[1];
        for (var i = 0; i < Math.min(2, list.length); i++) {
          var y = top + i * lineH;
          ctx.font = sans(600, Math.round(g.w * 0.031));
          ctx.fillStyle = TEXT;
          ctx.fillText(ellipsis(ctx, list[i].stat, colMax), x, y);
          ctx.font = mono(500, Math.round(g.w * 0.025));
          ctx.fillStyle = SEC;
          ctx.fillText(ellipsis(ctx, String(list[i].val), colMax), x, y + Math.round(g.w * 0.031) + 5);
        }
      });
      ctx.restore();
    }

    function draw() {
      var g = size();
      if (hasOutro && pos > steps) { size(); outro(g, (pos - steps) / 1.2); return; }
      var want = targetScroll();
      if (!scrollInit) { scrollY = want; scrollInit = true; }
      else scrollY += (want - scrollY) * 0.22;
      if (Math.abs(want - scrollY) < 0.4) scrollY = want;

      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, g.w, g.h);
      body(g);
      scoreboard(g, scoreAt(pos));
    }

    /* ---------------- loop ---------------- */

    function frame(ts) {
      if (destroyed) return;
      if (!last) last = ts;
      var dt = ts - last;
      last = ts;
      pos += dt / stepMs;
      if (pos >= span) {
        pos = span;
        draw();
        // Let the scroll finish easing after the last row lands.
        var settleFrames = 0;
        (function coast() {
          if (destroyed) return;
          draw();
          if (++settleFrames < 30 && Math.abs(targetScroll() - scrollY) > 0.5) {
            global.requestAnimationFrame(coast);
          }
        })();
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
      if (pos >= span) { pos = 0; scrollInit = false; }
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
      stepMs = Math.max(30, Math.round(baseStepMs / speed));
    }
    function seek(frac) {
      pos = Math.max(0, Math.min(span, frac * span));
      scrollInit = false;                 // scrubbing should land, not glide
      draw();
    }
    function destroy() {
      destroyed = true;
      pause();
      global.removeEventListener("resize", onResize);
      global.clearTimeout(settle);
    }

    var onResize = function () { if (!playing) { scrollInit = false; draw(); } };
    global.addEventListener("resize", onResize);

    if (reduced) pos = span;
    draw();
    var settle = global.setTimeout(function () { if (!playing) draw(); }, 900);
    faceA && (faceA.onload = function () { if (!playing) draw(); });
    faceB && (faceB.onload = function () { if (!playing) draw(); });

    return {
      play: play, pause: pause, toggle: toggle, seek: seek, setSpeed: setSpeed,
      destroy: destroy,
      get playing() { return playing; },
      get progress() { return pos / span; },
      get speed() { return speed; },
      get durationMs() { return stepMs * span; },
      reducedMotion: reduced,
      steps: steps
    };
  }

  global.ComparePlayer = { mount: mount };
})(window);
