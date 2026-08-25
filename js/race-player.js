/* NBA Doomscroll — canvas bar chart race player
 *
 * Animates a race built by tools/build_races.mjs. Replaces the pre-rendered
 * MP4 clips: a 90-second race is ~11KB of JSON here instead of ~2MB of video,
 * it stays sharp at any width, and it can be paused, scrubbed and restarted.
 *
 *   RacePlayer.mount(canvas, race, opts) -> controller
 *
 * The controller exposes play(), pause(), toggle(), seek(t), destroy() and a
 * `playing` flag. app.js starts a race when its card scrolls into view and
 * pauses it when it leaves, the same contract the <video> version had.
 *
 * Rendering notes:
 *   - Bars ease between seasons on BOTH value and rank, so a player climbing
 *     past another slides rather than jumping.
 *   - The value axis eases too. Without that, one huge season makes every bar
 *     visibly snap shorter.
 *   - Emblems are drawn WHOLE and never clipped: headshots from the alpha
 *     bounding box the builder measured, logos with the five-argument
 *     drawImage. A bar with no image gets no emblem at all — a stand-in disc
 *     read worse than an empty bar.
 */
(function (global) {
  "use strict";

  var TARGET_MS = 70000;   // target runtime at 1x
  var MIN_STEP = 600;      // …but never flicker on a short race
  // A 34-step race clamped at 2.2s ran 73 seconds against a 90-second target,
  // so the ceiling was what actually set the pace for every short series, not
  // the target. 3.0s lets those reach the target instead of undershooting it.
  var MAX_STEP = 3000;
  var ROWS = 10;           // visible bars

  /* Everything below is a port of the "hoopshype-official" theme from the
   * bar-chart-race repo (src/bar_race/themes.py line 969 and the draw loop in
   * src/bar_race/render.py), so a race here reads as the same product as a
   * rendered clip:
   *
   *   bg #1a1a1a solid            bar radius 6, 1px border lightened 20%
   *   highlight strip on the top 30% of each bar, lightened 25%, alpha <= 120
   *   labels INSIDE the bar, name left-anchored and never truncated, value
   *   right-aligned at the bar end and spilling after the name on a short bar
   *   a left-to-right dark gradient under the label so white text stays legible
   *   headshots in "rectangle" style: 1.4:1 landscape, flush with the bar's
   *   left edge, full bar height
   *   season bottom-right, white at 90%
   *   no vignette, no noise, no bar shadow, no leader glow
   *
   * The one thing not ported is the typeface. That theme loads Futura Today
   * from the repo's assets/fonts; this uses the site's DM Sans.
   */
  var BG = "#1a1a1a";
  var PAD_T = 8;
  var PAD_B = 54;
  var PAD_L = 12;
  var PAD_R = 12;
  var ROW_H = 42;          // only used to size the canvas; bars are computed

  var C = {
    bg: BG,
    text: "#ffffff",
    text2: "#cccccc"
  };

  function hexRgb(h) {
    h = String(h).replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lighten(rgb, amt) {
    return [
      Math.min(255, Math.round(rgb[0] + (255 - rgb[0]) * amt)),
      Math.min(255, Math.round(rgb[1] + (255 - rgb[1]) * amt)),
      Math.min(255, Math.round(rgb[2] + (255 - rgb[2]) * amt))
    ];
  }
  function rgba(rgb, a) {
    return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a + ")";
  }

  /* ---------------- image cache ---------------- */

  var imgCache = Object.create(null);
  function getImage(src) {
    if (!src) return null;
    if (imgCache[src] !== undefined) return imgCache[src];
    var im = new Image();
    // Anonymous so a race frame can be drawn into a share image without
    // tainting the canvas once the site moves to hoopsmatic.com.
    im.crossOrigin = "anonymous";
    im.decoding = "async";
    im.onerror = function () { imgCache[src] = null; };
    im.src = src;
    imgCache[src] = im;
    return im;
  }
  function ready(im) {
    return !!(im && im.complete && im.naturalWidth > 0);
  }

  /* ---------------- formatting ---------------- */

  function fmtValue(v, fmt) {
    if (fmt === "money") {
      if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
      if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
      if (v >= 1e3) return "$" + Math.round(v / 1e3) + "K";
      return "$" + Math.round(v);
    }
    if (fmt === "float1") return (v / 10).toFixed(1);
    return Math.round(v).toLocaleString("en-US");
  }

  function shortName(name) {
    // "LeBron James" fits; "Kareem Abdul-Jabbar" on a 320px phone does not.
    // First initial + surname is the bar-race convention.
    var parts = name.split(" ");
    if (parts.length < 2 || name.length <= 16) return name;
    return parts[0][0] + ". " + parts.slice(1).join(" ");
  }

  function teamShort(name) {
    // Nickname only. Running franchise names through shortName produced
    // "L. Angeles Lakers" and "P. 76ers", which is nobody's convention.
    var parts = name.trim().split(/\s+/);
    if (parts.length < 2) return name;
    if (parts.length > 2 && /^(Trail)$/i.test(parts[parts.length - 2])) {
      return parts.slice(-2).join(" ");
    }
    return parts[parts.length - 1];
  }

  // Players get the initial-plus-surname treatment, franchises get their
  // nickname, and countries / draft classes / generations are already short
  // enough to print as they are.
  function barLabel(name, kind) {
    if (kind === "player") return shortName(name);
    if (kind === "team") return teamShort(name);
    return name;
  }

  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ---------------- mount ---------------- */

  function mount(canvas, race, opts) {
    opts = opts || {};
    var ctx = canvas.getContext("2d");
    var steps = race.labels.length;
    var baseStepMs = Math.max(MIN_STEP, Math.min(MAX_STEP, Math.round(TARGET_MS / Math.max(1, steps - 1))));
    var speed = 1;
    var stepMs = baseStepMs;
    var fmt = race.fmt || "int";

    var reduced = false;
    try {
      reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) { /* older browsers: animate */ }

    // Pre-index each frame as key -> value so interpolation can ask "what did
    // this entity have at step i" without a scan.
    var byStep = race.f.map(function (rows) {
      var m = Object.create(null);
      for (var i = 0; i < rows.length; i++) m[rows[i][0]] = rows[i][1];
      return m;
    });
    // Rank per step, so a bar that drops out of the top KEEP slides down and
    // off rather than vanishing mid-frame.
    var rankStep = race.f.map(function (rows) {
      var m = Object.create(null);
      for (var i = 0; i < rows.length; i++) m[rows[i][0]] = i;
      return m;
    });
    var maxStep = race.f.map(function (rows) {
      return rows.length ? rows[0][1] : 1;
    });

    // Warm the images so the opening frame is not a set of bare bars.
    race.e.forEach(function (e) { if (e.img) getImage(e.img); });

    var pos = 0;              // float position along steps, 0 .. steps-1
    var playing = false;
    var raf = 0;
    var last = 0;
    var destroyed = false;
    var easedMax = maxStep[0] || 1;

    function valueAt(key, p) {
      var i = Math.floor(p), j = Math.min(steps - 1, i + 1), t = easeInOut(p - i);
      var a = byStep[i][key], b = byStep[j][key];
      if (a === undefined && b === undefined) return null;
      if (a === undefined) a = 0;
      if (b === undefined) b = a;      // leaving the top KEEP: hold, don't drop to 0
      return a + (b - a) * t;
    }
    function rankAt(key, p) {
      var i = Math.floor(p), j = Math.min(steps - 1, i + 1), t = easeInOut(p - i);
      var OUT = ROWS + 3;
      var a = rankStep[i][key], b = rankStep[j][key];
      if (a === undefined) a = OUT;
      if (b === undefined) b = OUT;
      return a + (b - a) * t;
    }

    function activeKeys(p) {
      var i = Math.floor(p), j = Math.min(steps - 1, i + 1);
      var seen = Object.create(null), out = [];
      [race.f[i], race.f[j]].forEach(function (rows) {
        for (var k = 0; k < rows.length; k++) {
          if (!seen[rows[k][0]]) { seen[rows[k][0]] = 1; out.push(rows[k][0]); }
        }
      });
      return out;
    }

    function labelAt(p) {
      return race.labels[Math.round(p)] || race.labels[steps - 1];
    }

    /* ---------------- draw ---------------- */

    function sizeCanvas() {
      var dpr = Math.min(2.5, global.devicePixelRatio || 1);
      var cssW = canvas.clientWidth || 340;
      var cssH = PAD_T + ROWS * ROW_H + PAD_B;
      if (canvas.style.height !== cssH + "px") canvas.style.height = cssH + "px";
      var w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: cssW, h: cssH };
    }

    function roundRect(x, y, w, h, r) {
      r = Math.min(r, h / 2, w / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /* Draws the player's head or the franchise logo whole — never clipped,
     * never cover-cropped — and draws NOTHING when there is no image.
     *
     * The face crops are background-removed cut-outs on a 256x256 canvas, and
     * the head only fills about 46% of the width. The old version clipped them
     * into a circle to make them look bigger, which sliced off ears, chins and
     * hair. The builder now ships the head's real bounding box as `e.b`, so the
     * source rectangle is the head itself and it can be scaled to fill the row.
     *
     * Returns the width it used, so the name knows where to start. 0 means the
     * bar carries no emblem at all — which is the intended look for a player
     * with no photo, rather than a stand-in disc.
     */
    /* The tool's "rectangle" headshot style, but with the crop and the 1.4:1
     * squash already baked into the tile by tools/lib/png.mjs — so there is
     * nothing to crop here. The tile is drawn flush with the bar's left edge at
     * full bar height, exactly as render.py places it.
     *
     * A team logo is square at bar height minus 6, same anchor.
     *
     * Returns the right edge the label must clear, or the bar's left edge when
     * there is no image at all. */
    function drawEmblem(ent, x1, y1, barH) {
      var im = ent.img ? getImage(ent.img) : null;
      if (!ready(im)) return x1;
      var isTeam = !!(ent.t && !ent.b);
      var dh = isTeam ? Math.max(8, barH - 6) : barH;
      var dw = isTeam ? dh : Math.round(barH * 1.4);
      ctx.drawImage(im, x1, y1, dw, dh);
      return x1 + dw;
    }

    function draw() {
      var size = sizeCanvas();
      var W = size.w, H = size.h;
      var p = pos;

      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);

      var i = Math.floor(p), j = Math.min(steps - 1, i + 1), t = easeInOut(p - i);
      var target = maxStep[i] + (maxStep[j] - maxStep[i]) * t;
      // Snapped whenever the race is not running: a scrub or a pause redraws
      // once, and an eased axis that only gets one frame to catch up leaves
      // every bar drawn against a stale maximum.
      if (playing) easedMax += (target - easedMax) * 0.18;
      else easedMax = target;
      var scaleMax = Math.max(1, easedMax);

      // Geometry straight out of render.py: a gap of 2.5% of the bar area, and
      // the bars share what is left.
      var areaTop = PAD_T, areaBottom = H - PAD_B;
      var areaH = areaBottom - areaTop;
      var barGap = Math.max(4, Math.round(areaH * 0.025));
      var barH = Math.max(8, Math.floor((areaH - barGap * (ROWS + 1)) / ROWS));
      var maxBarW = W - PAD_L - PAD_R;

      var keys = activeKeys(p);
      var rows = [];
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var v = valueAt(key, p);
        if (v === null) continue;
        rows.push({ key: key, v: v, r: rankAt(key, p), e: race.e[key] });
      }
      rows.sort(function (a, b) { return a.r - b.r; });

      for (var n = 0; n < rows.length; n++) {
        var row = rows[n];
        if (row.r > ROWS + 0.6) continue;
        var yCenter = areaTop + barGap + row.r * (barH + barGap) + barH / 2;
        var y1 = Math.round(yCenter - barH / 2);
        if (y1 > areaBottom) continue;
        var alpha = row.r > ROWS - 1 ? Math.max(0, 1 - (row.r - (ROWS - 1))) : 1;

        var barW = Math.max(1, Math.min(maxBarW, (row.v / scaleMax) * maxBarW));
        var x1 = PAD_L, x2 = x1 + barW;
        var base = hexRgb(row.e.c || "#3b82f6");

        ctx.save();
        ctx.globalAlpha = alpha;

        // bar
        roundRect(x1, y1, barW, barH, 6);
        ctx.fillStyle = rgba(base, 1);
        ctx.fill();

        // 1px border, lightened 20%
        roundRect(x1 + 0.5, y1 + 0.5, Math.max(1, barW - 1), barH - 1, 6);
        ctx.strokeStyle = rgba(lighten(base, 0.2), 0.7);
        ctx.lineWidth = 1;
        ctx.stroke();

        // highlight strip across the top 30%
        var hlH = Math.max(1, Math.round(barH * 0.30));
        ctx.save();
        roundRect(x1, y1, barW, barH, 6);
        ctx.clip();
        ctx.fillStyle = rgba(lighten(base, 0.25), 0.47);
        ctx.fillRect(x1, y1, barW, hlH);
        ctx.restore();

        // headshot or logo, flush left, then the label clears it
        var hsRight = drawEmblem(row.e, x1, y1, barH);

        var label = barLabel(row.e.n, race.kind);
        ctx.font = "600 13px 'DM Sans', system-ui, sans-serif";
        var tw = ctx.measureText(label).width;
        ctx.font = "600 13px 'JetBrains Mono', ui-monospace, monospace";
        var valText = fmtValue(row.v, fmt);
        var vw = ctx.measureText(valText).width;

        var textLeft = Math.max(hsRight + 8, x1 + 10);
        var textRight = x2 - 10;

        // Dark left-to-right gradient under the label so white text survives a
        // pale bar. render.py ramps alpha 80 -> 0 over the label's width.
        var gradW = Math.min(barW, Math.max(barW * 0.5, tw + vw + 40));
        if (gradW > 10) {
          var g = ctx.createLinearGradient(x1, 0, x1 + gradW, 0);
          g.addColorStop(0, "rgba(0,0,0,0.31)");
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.save();
          roundRect(x1, y1, barW, barH, 6);
          ctx.clip();
          ctx.fillStyle = g;
          ctx.fillRect(x1, y1, gradW, barH);
          ctx.restore();
        }

        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        var cy = y1 + barH / 2;

        // Name always left-anchored and never truncated: on a short bar it
        // spills past the bar end onto the background, which is what
        // label_overflow_outside does in the theme.
        ctx.font = "600 13px 'DM Sans', system-ui, sans-serif";
        ctx.fillStyle = "rgba(0,0,0,0.47)";
        ctx.fillText(label, textLeft + 1, cy + 1);
        ctx.fillStyle = C.text;
        ctx.fillText(label, textLeft, cy);

        // Value right-aligned at the bar end, or just after the name when the
        // bar is too short. The two positions meet exactly at the threshold, so
        // it never jumps as a bar grows past it.
        ctx.font = "600 13px 'JetBrains Mono', ui-monospace, monospace";
        var valX = Math.max(textLeft + tw + 10, textRight - vw);
        ctx.fillStyle = "rgba(0,0,0,0.47)";
        ctx.fillText(valText, valX + 1, cy + 1);
        ctx.fillStyle = C.text;
        ctx.fillText(valText, valX, cy);

        ctx.restore();
      }

      // Season, bottom right, white at 90% — the theme's date block.
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "right";
      ctx.font = "700 34px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(labelAt(p), W - PAD_R, H - 18);

      ctx.textAlign = "left";
      ctx.font = "500 11px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillText((race.unit || "").toUpperCase(), PAD_L, H - 30);

      // progress rail
      var railY = H - 12;
      ctx.fillStyle = "rgba(255,255,255,0.14)";
      roundRect(PAD_L, railY, W - PAD_L - PAD_R, 3, 2);
      ctx.fill();
      ctx.fillStyle = "#3b82f6";
      roundRect(PAD_L, railY, Math.max(3, (W - PAD_L - PAD_R) * (p / Math.max(1, steps - 1))), 3, 2);
      ctx.fill();

      if (!playing && !reduced) {
        var cxp = W / 2, cyp = areaTop + areaH / 2, r = 21;
        ctx.beginPath();
        ctx.arc(cxp, cyp, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cxp - 5, cyp - 9);
        ctx.lineTo(cxp + 9, cyp);
        ctx.lineTo(cxp - 5, cyp + 9);
        ctx.closePath();
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
    }

    /* ---------------- loop ---------------- */

    function frame(now) {
      if (destroyed) return;
      if (!last) last = now;
      var dt = Math.min(120, now - last);   // a backgrounded tab must not jump
      last = now;
      if (playing) {
        pos += dt / stepMs;
        if (pos >= steps - 1) {
          pos = steps - 1;
          draw();
          playing = false;
          last = 0;
          if (opts.onEnd) opts.onEnd();
          return;
        }
      }
      draw();
      raf = global.requestAnimationFrame(frame);
    }

    function play() {
      if (destroyed || playing) return;
      if (reduced) { pos = steps - 1; draw(); return; }
      if (pos >= steps - 1) pos = 0;
      playing = true;
      last = 0;
      if (!raf) raf = global.requestAnimationFrame(frame);
    }
    function pause() {
      playing = false;
      if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
      last = 0;
      draw();
    }
    function toggle() { playing ? pause() : play(); }
    function setSpeed(mult) {
      speed = mult;
      stepMs = Math.max(80, Math.round(baseStepMs / speed));
    }
    function seek(frac) {
      pos = Math.max(0, Math.min(steps - 1, frac * (steps - 1)));
      draw();
    }
    function destroy() {
      destroyed = true;
      if (raf) { global.cancelAnimationFrame(raf); raf = 0; }
    }

    var onResize = function () { if (!playing) draw(); };
    global.addEventListener("resize", onResize);
    var _destroy = destroy;
    destroy = function () { global.removeEventListener("resize", onResize); _destroy(); };

    if (reduced) { pos = steps - 1; }
    draw();
    // Late-arriving headshots should appear without waiting for a play tap.
    var settle = global.setTimeout(function () { if (!playing) draw(); }, 900);
    var __d = destroy;
    destroy = function () { global.clearTimeout(settle); __d(); };

    var api = {
      play: play, pause: pause, toggle: toggle, seek: seek, setSpeed: setSpeed,
      destroy: function () { destroy(); },
      get playing() { return playing; },
      get progress() { return pos / Math.max(1, steps - 1); },
      get speed() { return speed; },
      get durationMs() { return stepMs * (steps - 1); },
      reducedMotion: reduced,
      steps: steps
    };
    return api;
  }

  global.RacePlayer = { mount: mount, fmtValue: fmtValue, barLabel: barLabel };
})(window);
