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
 *   - Headshots are drawn only when the build verified a committed PNG. Every
 *     other bar gets an initials disc in the entity's colour, which is most of
 *     them for historical races — see the coverage note in the builder.
 */
(function (global) {
  "use strict";

  var TARGET_MS = 90000;   // Jorge's ask: a race should run about 90 seconds
  var MIN_STEP = 700;      // …but never flicker on a short race
  var MAX_STEP = 2200;     // …and never crawl on a 30-step one
  var ROWS = 8;            // visible bars
  var ROW_H = 42;
  var PAD_T = 10;
  var PAD_B = 52;
  var PAD_L = 12;
  var PAD_R = 12;

  var C = {
    bg: "#ffffff",
    text: "#1d1d1f",
    text2: "#6e6e73",
    grid: "#e8e8ed",
    track: "#f5f5f7"
  };

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

  function initials(ent) {
    var name = typeof ent === "string" ? ent : ent.n;
    // A franchise already has a three-letter identity; "LL" for the Lakers is
    // strictly worse than "LAL".
    if (ent && ent.t && typeof ent !== "string") return ent.t;
    // "Class of 1998" and "Born in the 1970s" read better as the year than as
    // "C1" or "BI", so pull a 4-digit run out when there is one.
    var yr = /(\d{4})/.exec(name);
    if (yr) return yr[1].slice(2);
    var parts = name.replace(/[^A-Za-z .'-]/g, "").split(/[ .]+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
    var stepMs = Math.max(MIN_STEP, Math.min(MAX_STEP, Math.round(TARGET_MS / Math.max(1, steps - 1))));
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

    // Warm the first races' images so the opening frame is not all discs.
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

    function drawDisc(ent, cx, cy, r) {
      var im = ent.img ? getImage(ent.img) : null;
      if (ready(im)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        // Cover-fit the square face crop (and any non-square logo).
        var iw = im.naturalWidth, ih = im.naturalHeight;
        var s = Math.max((r * 2) / iw, (r * 2) / ih);
        ctx.drawImage(im, cx - (iw * s) / 2, cy - (ih * s) / 2, iw * s, ih * s);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fill();
        ctx.fillStyle = ent.c || "#3b82f6";
        ctx.font = "600 " + Math.round(r * 0.92) + "px 'JetBrains Mono', ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials(ent), cx, cy + 0.5);
      }
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.10)";
      ctx.lineWidth = 1;
      ctx.stroke();
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
      // Ease the axis toward the target so the whole chart does not jolt when
      // the leader has a big season. Snapped whenever the race is not running:
      // a scrub or a pause redraws once, and an eased axis that only gets one
      // frame to catch up leaves every bar drawn against a stale maximum —
      // which is how the leader's bar ended up running under the value column.
      if (playing) easedMax += (target - easedMax) * 0.18;
      else easedMax = target;
      var scaleMax = Math.max(1, easedMax);

      var keys = activeKeys(p);
      var rows = [];
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var v = valueAt(key, p);
        if (v === null) continue;
        rows.push({ key: key, v: v, r: rankAt(key, p), e: race.e[key] });
      }
      rows.sort(function (a, b) { return a.r - b.r; });

      var barX = PAD_L;
      var barMaxW = W - PAD_L - PAD_R - 66;   // room for the value at the end
      var barH = ROW_H - 10;

      for (var n = 0; n < rows.length; n++) {
        var row = rows[n];
        if (row.r > ROWS + 0.6) continue;
        var y = PAD_T + row.r * ROW_H;
        if (y > PAD_T + ROWS * ROW_H) continue;
        // Fade a bar as it slides past the last visible slot.
        var alpha = row.r > ROWS - 1 ? Math.max(0, 1 - (row.r - (ROWS - 1))) : 1;
        // Clamped: the eased axis can briefly sit below the leader's value, and
        // an unclamped bar then runs straight under the value column.
        var w = Math.max(2, Math.min(barMaxW, (row.v / scaleMax) * barMaxW));

        ctx.save();
        ctx.globalAlpha = alpha;

        roundRect(barX, y, Math.max(barH, w), barH, 7);
        ctx.fillStyle = row.e.c || "#3b82f6";
        ctx.fill();

        var cx = barX + barH / 2 + 1;
        var cy = y + barH / 2;
        drawDisc(row.e, cx, cy, barH / 2 - 3);

        // Name inside the bar when it fits, outside when the bar is still short.
        var label = barLabel(row.e.n, race.kind);
        ctx.font = "600 13px 'DM Sans', system-ui, sans-serif";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        var nameX = barX + barH + 8;
        var fits = nameX + ctx.measureText(label).width + 8 < barX + w;
        if (fits) {
          ctx.fillStyle = "#ffffff";
          ctx.fillText(label, nameX, cy + 0.5);
        } else {
          ctx.fillStyle = C.text;
          ctx.fillText(label, barX + Math.max(barH, w) + 8, cy + 0.5);
        }

        // Value always sits at the far right, on its own column, so the eye can
        // read the standings down the edge.
        ctx.font = "600 12px 'JetBrains Mono', ui-monospace, monospace";
        ctx.textAlign = "right";
        ctx.fillStyle = C.text;
        ctx.fillText(fmtValue(row.v, fmt), W - PAD_R, cy + 0.5);

        ctx.restore();
      }

      // Footer: season label big on the right, unit on the left, progress rail.
      var railY = H - 22;
      ctx.fillStyle = C.track;
      roundRect(PAD_L, railY, W - PAD_L - PAD_R, 4, 2);
      ctx.fill();
      ctx.fillStyle = "#3b82f6";
      roundRect(PAD_L, railY, Math.max(4, (W - PAD_L - PAD_R) * (p / Math.max(1, steps - 1))), 4, 2);
      ctx.fill();

      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "right";
      ctx.font = "700 30px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillStyle = "rgba(29,29,31,0.18)";
      ctx.fillText(labelAt(p), W - PAD_R, railY - 12);

      ctx.textAlign = "left";
      ctx.font = "500 11px 'JetBrains Mono', ui-monospace, monospace";
      ctx.fillStyle = C.text2;
      ctx.fillText((race.unit || "").toUpperCase(), PAD_L, railY - 12);

      if (!playing && !reduced) {
        // Play affordance, so a paused card does not look broken.
        var r = 21;
        ctx.beginPath();
        ctx.arc(W / 2, PAD_T + (ROWS * ROW_H) / 2, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(29,29,31,0.55)";
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(W / 2 - 5, PAD_T + (ROWS * ROW_H) / 2 - 9);
        ctx.lineTo(W / 2 + 9, PAD_T + (ROWS * ROW_H) / 2);
        ctx.lineTo(W / 2 - 5, PAD_T + (ROWS * ROW_H) / 2 + 9);
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
      play: play, pause: pause, toggle: toggle, seek: seek, destroy: function () { destroy(); },
      get playing() { return playing; },
      get progress() { return pos / Math.max(1, steps - 1); },
      reducedMotion: reduced,
      stepMs: stepMs,
      durationMs: stepMs * (steps - 1)
    };
    return api;
  }

  global.RacePlayer = { mount: mount, fmtValue: fmtValue, barLabel: barLabel, initials: initials };
})(window);
