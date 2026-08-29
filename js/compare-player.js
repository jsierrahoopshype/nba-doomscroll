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
  /* Light, because the generator this ports is light and so is the app around
   * it. `nba-comparison-video-generator` renders on #f5f5f7 with white rows and
   * #1d1d1f text, which are the same tokens styles.css sets on :root. The card
   * inherited a dark panel from the Teammates player, which is the one place
   * the port diverged from its source for no reason.
   *
   * Every value below is an app token: --bg, --surface, --text,
   * --text-secondary, --accent, --red, --orange. Nothing new is invented, so
   * the canvas and the markup around it cannot drift apart. */
  var BG = "#f5f5f7";           // --bg, the recessed ground the rows sit on
  var PANEL = "#ffffff";        // --surface, the scoreboard
  var ROW = "#ffffff";          // --surface, each metric row
  var ROW_EDGE = "rgba(0,0,0,.07)";  // white on near-white needs a hairline
  var HEAD_TILE = "#e8e8ed";    // behind a headshot that has not loaded
  var WIN_GREEN = "#22a861";    // the generator's final-screen green
  var RULE = "rgba(0,0,0,.09)"; // section underlines, scoreboard base
  var TEXT = "#1d1d1f";         // --text
  var SEC = "#6e6e73";          // --text-secondary
  var A_TINT = "#3b82f6";       // --accent
  var B_TINT = "#d12c2c";       // --red, legible on white where #ef6a5a is not
  var GOLD = "#b26b00";         // --orange; #caa23a was a dark-panel gold

  var ROW_H = 30, GAP = 4, HEAD_H = 26, VISIBLE = 6;
  var FLASH_STEPS = 0.9;        // how long, in reveal steps, a new row glows

  function sans(w, px) { return w + " " + px + "px 'DM Sans',-apple-system,sans-serif"; }
  /* The generator sets its headings in Barlow Condensed. Used for the section
   * headers and the outro's one heading only - the body stays DM Sans so the
   * card reads as part of the feed rather than as a pasted-in graphic. */
  function cond(w, px) { return w + " " + px + "px 'Barlow Condensed','DM Sans',sans-serif"; }
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
      ctx.fillStyle = HEAD_TILE;
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
      ctx.fillStyle = RULE;
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
          ctx.font = cond(700, 11.5);
          ctx.fillStyle = SEC;
          ctx.fillText(L.label.toUpperCase(), pad, dy + HEAD_H - 9);
          ctx.fillStyle = RULE;
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
        ctx.strokeStyle = ROW_EDGE;
        ctx.lineWidth = 1;
        ctx.stroke();

        /* The winner's tint covers their VALUE column, not half the row.
         *
         * The generator sets its boundaries at 42% and 58% of the width, which
         * leaves the category label in the middle on plain surface — so the
         * colour reads as "this number won" rather than as a block dividing the
         * row in two. Filling to the midpoint, which is what this did first,
         * swallows the label and looks like a progress bar. Same proportions
         * here, measured off the row rather than the canvas. */
        /* 42/58 is the generator's own boundary, but the generator puts its
         * metric in a column one eleventh of the row wide, dead centre, so its
         * boundaries never reach the text. This card gives the category the
         * whole middle, so at 42/58 a long label ran under the tint and the
         * hard edge read as the block cutting the words in half.
         *
         * So the boundary is whichever is further out: the generator's 42/58,
         * or the label's own measured edge plus a gap. Short labels are
         * untouched and land exactly where the video puts them; long ones push
         * the tint back rather than being run over by it. The value column is
         * the floor - the tint always covers the number it is about. */
        ctx.font = sans(500, 10.5);
        var labelTxt = ellipsis(ctx, row.cat, catW - 8);
        var labelHalf = ctx.measureText(labelTxt).width / 2 + 7;
        var mid = pad + rowW / 2;
        var tintEnd = Math.max(pad + valW, Math.min(pad + rowW * 0.42, mid - labelHalf));
        var tintStart = Math.min(pad + rowW - valW, Math.max(pad + rowW * 0.58, mid + labelHalf));
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
        ctx.fillText(labelTxt, catX + catW / 2, my);
      }

      /* Rows scroll up and out under the scoreboard. Hard-clipped, the one
       * being cut in half looks like a rendering bug rather than like a list
       * moving, so the top 18px fades it out. */
      var fade = ctx.createLinearGradient(0, top, 0, top + 18);
      fade.addColorStop(0, BG);
      fade.addColorStop(1, "rgba(245,245,247,0)");
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

    /* The closing card, ported from drawFinalScreen() in
     * nba-comparison-video-generator.html rather than invented.
     *
     * The first version of this drew two centred heads over two centred stats
     * and shared almost nothing with the video it was supposed to end like.
     * The generator's final card has a shape: headshot outboard of an uppercase
     * name with a trophy on the winner, an oversized score in green under it, a
     * banded header per column reading "<NAME> BIGGEST WINS" with the scoreline
     * opposite, then alternating rows of a metric against "won - lost", and a
     * letter-spaced HOOPSMATIC.COM along the bottom. All of that is structure, so
     * all of it ports at any size; only the numbers change.
     *
     * Proportions are the generator's own: top block to 28%, header band to
     * 33%, rows to 96%, footer below. S scales off 1280, its design width, with
     * floors on the small type because this canvas is a third of that. */
    function outro(g, t) {
      var S = g.w / 1280;
      var px = function (v, min) { return Math.max(min || 0, Math.round(v * S)); };

      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, t));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, g.w, g.h);

      var sc = scoreAt(steps);
      var aWon = sc.a > sc.b, bWon = sc.b > sc.a;
      var pad = px(32, 8);
      var midX = g.w / 2;
      var topBot = Math.round(g.h * 0.28);
      var nameY = Math.round(g.h * 0.11);
      var scoreY = Math.round(g.h * 0.20);

      var hsD = px(90, 26), hsR = hsD / 2, hsGap = px(12, 4);
      var aColCenter = (pad + hsD + hsGap + midX) / 2;
      var bColCenter = (midX + g.w - pad - hsD - hsGap) / 2;

      var TROPHY = "\uD83C\uDFC6";
      var nameMax = g.w * 0.42;

      /* The trophy is measured into the name's width so a winner's name is
       * shrunk to fit the pair, not just itself, and the two sides stay level. */
      function fitName(name, winner) {
        var sz = px(52, 11), floor = px(28, 8);
        ctx.font = "800 " + sz + "px 'DM Sans',sans-serif";
        while (sz > floor &&
               ctx.measureText(name).width + (winner ? ctx.measureText(TROPHY + " ").width : 0) > nameMax) {
          sz -= 1;
          ctx.font = "800 " + sz + "px 'DM Sans',sans-serif";
        }
        return sz;
      }

      function nameBlock(im, name, cx, headCx, winner) {
        var up = String(name).toUpperCase();
        var ns = fitName(up, winner);
        var headCy = nameY - ns * 0.45;
        ctx.save();
        ctx.beginPath();
        ctx.arc(headCx, headCy, hsR, 0, Math.PI * 2);
        ctx.fillStyle = HEAD_TILE;
        ctx.fill();
        ctx.clip();
        if (im && im.complete && im.naturalWidth) ctx.drawImage(im, headCx - hsR, headCy - hsR, hsD, hsD);
        else {
          ctx.fillStyle = SEC;
          ctx.font = "700 " + Math.round(hsR * 0.8) + "px 'DM Sans',sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(initials(name), headCx, headCy + hsR * 0.04);
        }
        ctx.restore();

        ctx.font = "800 " + ns + "px 'DM Sans',sans-serif";
        ctx.fillStyle = "#111111";
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        var tw = winner ? ctx.measureText(TROPHY + " ").width : 0;
        var total = tw + ctx.measureText(up).width;
        var x0 = cx - total / 2;
        if (winner) ctx.fillText(TROPHY, x0, nameY);
        ctx.fillText(up, x0 + tw, nameY);
      }

      nameBlock(faceA, data.a.name, aColCenter, pad + hsR, aWon);
      nameBlock(faceB, data.b.name, bColCenter, g.w - pad - hsR, bWon);

      /* The score is the loudest thing on the card in the video, and green only
       * on the winner - a colour that means "this one won" rather than a colour
       * per player, which is what the rows above already do. */
      function fitScore(val) {
        var sz = px(160, 26), floor = px(80, 18);
        ctx.font = "900 " + sz + "px 'DM Sans',sans-serif";
        while (sz > floor && ctx.measureText(String(val)).width > g.w * 0.36) {
          sz -= 1;
          ctx.font = "900 " + sz + "px 'DM Sans',sans-serif";
        }
        return sz;
      }
      ctx.textAlign = "center";
      var as = fitScore(sc.a);
      ctx.font = "900 " + as + "px 'DM Sans',sans-serif";
      ctx.fillStyle = aWon ? WIN_GREEN : "#111111";
      ctx.fillText(String(sc.a), aColCenter, scoreY + as * 0.35);
      var bs = fitScore(sc.b);
      ctx.font = "900 " + bs + "px 'DM Sans',sans-serif";
      ctx.fillStyle = bWon ? WIN_GREEN : "#111111";
      ctx.fillText(String(sc.b), bColCenter, scoreY + bs * 0.35);

      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(0, topBot, g.w, 1);

      // --- header band, one per column -------------------------------------
      var hdrTop = topBot + 1, hdrBot = Math.round(g.h * 0.345), hdrH = hdrBot - hdrTop;
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, hdrTop, g.w, hdrH);

      function bandHeader(name, mine, theirs, x0, x1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, hdrTop, x1 - x0, hdrH);
        ctx.clip();
        ctx.textBaseline = "alphabetic";
        ctx.font = cond(700, px(22, 9));
        ctx.fillStyle = "#999999";
        ctx.textAlign = "left";
        ctx.fillText(ellipsis(ctx, String(name).toUpperCase() + " BIGGEST WINS", x1 - x0 - pad * 2 - px(34, 16)),
          x0 + pad, hdrTop + hdrH * 0.68);
        ctx.font = mono(400, px(18, 8));
        ctx.fillStyle = "#bbbbbb";
        ctx.textAlign = "right";
        ctx.fillText(mine + " \u2013 " + theirs, x1 - pad, hdrTop + hdrH * 0.68);
        ctx.restore();
      }
      bandHeader(data.a.name, sc.a, sc.b, 0, midX);
      bandHeader(data.b.name, sc.b, sc.a, midX, g.w);

      ctx.fillStyle = "#e8e8e8";
      ctx.fillRect(0, hdrBot, g.w, 1);

      // --- the wins themselves ---------------------------------------------
      var rowTop = hdrBot + 1, rowBot = Math.round(g.h * 0.95);
      var availH = rowBot - rowTop;
      var la = wins.a || [], lb = wins.b || [];
      var lines = Math.max(la.length, lb.length, 1);
      /* Dividing the space by the row count is what the generator does, but it
       * has ten rows to divide by. With six or fewer the rows would stretch into
       * bands, so they are capped and the column simply ends early. */
      var rowH = Math.min(availH / lines, px(48, 17) * 1.5);

      function winCol(list, x0, colW) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, rowTop, colW, availH);
        ctx.clip();
        for (var i = 0; i < list.length && i < lines; i++) {
          var y = rowTop + i * rowH, w = list[i];
          var ty = y + rowH * 0.63;
          ctx.fillStyle = (i % 2 === 0) ? "#ffffff" : "#fafafa";
          ctx.fillRect(x0, y, colW, rowH);

          /* Older data files carry only the joined "6 vs 0"; newer ones carry
           * the halves. Split the joined form rather than refuse to draw it, so
           * the card is right before the next build as well as after it. */
          var won = w.w, lost = w.l;
          if (won === undefined) {
            var parts = String(w.val || "").split(" vs ");
            won = parts[0] || ""; lost = parts[1] || "";
          }

          ctx.textBaseline = "alphabetic";
          ctx.textAlign = "right";
          var rEdge = x0 + colW - pad;
          var dash = " \u2013 ";

          /* "top salary" pits $105,254,306 against $54,708,609, which at the
           * generator's fixed sizes eats the column and leaves "TOP SA..." for
           * the metric. So the pair shrinks until the label has at least 42% of
           * the column, and only then draws. Short pairs never shrink, so every
           * ordinary row keeps the size the video uses. */
          var loseSz = px(26, 8), winSz = px(30, 9);
          var floorSz = px(17, 7);
          var lw, dw, ww;
          function measure() {
            ctx.font = mono(400, loseSz); lw = ctx.measureText(String(lost)).width;
            dw = ctx.measureText(dash).width;
            ctx.font = mono(700, winSz); ww = ctx.measureText(String(won)).width;
            return lw + dw + ww;
          }
          var labelFloor = (colW - pad * 2) * 0.42;
          while (measure() > colW - pad * 2 - labelFloor && loseSz > floorSz) {
            loseSz -= 1; winSz -= 1;
          }

          ctx.font = mono(400, loseSz);
          ctx.fillStyle = "#aaaaaa";
          ctx.fillText(String(lost), rEdge, ty);
          ctx.fillStyle = "#cccccc";
          ctx.fillText(dash, rEdge - lw, ty);
          ctx.font = mono(700, winSz);
          ctx.fillStyle = WIN_GREEN;
          ctx.fillText(String(won), rEdge - lw - dw, ty);

          ctx.textAlign = "left";
          ctx.font = cond(600, px(26, 10));
          ctx.fillStyle = "#555555";
          ctx.fillText(ellipsis(ctx, String(w.stat).toUpperCase(), colW - pad * 2 - lw - dw - ww - 6),
            x0 + pad, ty);

          if (i < list.length - 1 && i < lines - 1) {
            ctx.fillStyle = "#f0f0f0";
            ctx.fillRect(x0 + pad, y + rowH - 1, colW - pad * 2, 1);
          }
        }
        ctx.restore();
      }
      winCol(la, 0, midX);
      winCol(lb, midX, g.w - midX);

      ctx.fillStyle = "#eeeeee";
      ctx.fillRect(midX - 0.5, rowTop, 1, Math.min(availH, lines * rowH));

      // --- footer -----------------------------------------------------------
      ctx.fillStyle = "#fafafa";
      ctx.fillRect(0, rowBot, g.w, g.h - rowBot);
      var bSize = px(16, 7), bSpace = Math.max(1, Math.round(bSize * 0.18));
      ctx.font = cond(600, bSize);
      ctx.fillStyle = "#bbbbbb";
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      var bStr = "HOOPSMATIC.COM", bw = 0, k;
      for (k = 0; k < bStr.length; k++) bw += ctx.measureText(bStr[k]).width + (k < bStr.length - 1 ? bSpace : 0);
      var bx = (g.w - bw) / 2;
      for (k = 0; k < bStr.length; k++) {
        ctx.fillText(bStr[k], bx, rowBot + (g.h - rowBot) * 0.68);
        bx += ctx.measureText(bStr[k]).width + bSpace;
      }

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
