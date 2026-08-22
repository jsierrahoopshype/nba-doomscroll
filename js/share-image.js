/* NBA Doomscroll — shareable card images
 *
 * Renders any feed card to a 1080x1350 PNG in the site's own palette, with
 * HoopsMatic branding, for downloading or handing to the native share sheet.
 *
 * Cross-origin note: headshots and logos live on jsierrahoopshype.github.io.
 * While the feed is served from that same origin nothing special is needed,
 * but once it moves to hoopsmatic.com those images become cross-origin and a
 * tainted canvas would make toBlob() throw. Images are therefore requested
 * with crossOrigin="anonymous" and any that fail are simply skipped — the card
 * still renders, just without that face.
 */
(function (root) {
  "use strict";

  var W = 1080, H = 1350;
  var PAD = 64;
  var CARD_TOP = 150, CARD_BOTTOM = H - 210;

  var C = {
    bg: "#f5f5f7", surface: "#ffffff", border: "#d1d1d6",
    text: "#1d1d1f", text2: "#6e6e73", accent: "#3b82f6",
    green: "#1d8a40", orange: "#b26b00", purple: "#7c3aed",
    teal: "#0f766e", red: "#d12c2c"
  };
  var TYPE = {
    trade:  { label: "TRADE", color: C.green },
    rumor:  { label: "RUMOR", color: C.orange },
    vs:     { label: "VS", color: C.accent },
    trivia: { label: "TRIVIA", color: C.accent },
    quiz:   { label: "QUIZ", color: C.purple },
    ballot: { label: "BALLOT", color: C.purple },
    salary: { label: "VAULT", color: C.teal },
    oddity: { label: "BALLOT ODDITY", color: C.teal },
    otd:    { label: "ON THIS DAY", color: C.teal },
    race:   { label: "RACE", color: C.teal }
  };

  var SANS = '"DM Sans", -apple-system, BlinkMacSystemFont, sans-serif';
  var MONO = '"JetBrains Mono", monospace';
  var f = function (weight, size, family) { return weight + " " + size + "px " + (family || SANS); };

  function loadImage(src) {
    return new Promise(function (resolve) {
      if (!src) return resolve(null);
      var im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = function () { resolve(im); };
      im.onerror = function () { resolve(null); }; // skip rather than fail the render
      im.src = src;
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function circleImage(ctx, im, cx, cy, r) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = "#f0f0f2";
    ctx.fill();
    if (im) {
      ctx.clip();
      // cover-fit the source into the circle
      var s = Math.max(2 * r / im.width, 2 * r / im.height);
      var w = im.width * s, h = im.height * s;
      ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = C.border;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function wrap(ctx, text, maxWidth) {
    var words = String(text).split(/\s+/), lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + " " + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = words[i]; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawLines(ctx, lines, x, y, lh, max) {
    var n = Math.min(lines.length, max || lines.length);
    for (var i = 0; i < n; i++) {
      var t = lines[i];
      if (max && i === max - 1 && lines.length > max) t = t.replace(/\s\S*$/, "") + "…";
      ctx.fillText(t, x, y + i * lh);
    }
    return y + n * lh;
  }

  /* ---------------- per-type bodies ---------------- */
  // Each returns the y it finished at. ctx text baseline is "top" throughout.

  function bodyVs(ctx, p, imgs, x, y, w) {
    var cx1 = x + w * 0.25, cx2 = x + w * 0.75;
    circleImage(ctx, imgs[0], cx1, y + 90, 82);
    circleImage(ctx, imgs[1], cx2, y + 90, 82);
    ctx.textAlign = "center";
    ctx.fillStyle = C.text; ctx.font = f(600, 30);
    ctx.fillText(fit(ctx, p.p1.name, w * 0.44), cx1, y + 190);
    ctx.fillText(fit(ctx, p.p2.name, w * 0.44), cx2, y + 190);
    ctx.font = f(700, 76, MONO);
    ctx.fillText(String(p.p1.score), cx1, y + 232);
    ctx.fillText(String(p.p2.score), cx2, y + 232);
    ctx.fillStyle = C.text2; ctx.font = f(500, 26, MONO);
    ctx.fillText("VS", x + w / 2, y + 110);

    var yy = y + 340;
    ctx.font = f(700, 36);
    ctx.fillStyle = C.text;
    yy = drawLines(ctx, wrap(ctx, p.headline, w), x + w / 2, yy, 46, 2) + 26;

    ctx.textAlign = "left";
    (p.sections || []).forEach(function (s) {
      ctx.fillStyle = C.text2; ctx.font = f(500, 27);
      ctx.fillText(s.label, x, yy);
      ctx.textAlign = "right";
      ctx.font = f(700, 27, MONO);
      ctx.fillStyle = s.p1 >= s.p2 ? C.text : C.text2;
      ctx.fillText(String(s.p1), x + w - 70, yy);
      ctx.fillStyle = C.text2; ctx.font = f(400, 27, MONO);
      ctx.fillText("–", x + w - 46, yy);
      ctx.fillStyle = s.p2 > s.p1 ? C.text : C.text2;
      ctx.font = f(700, 27, MONO);
      ctx.fillText(String(s.p2), x + w, yy);
      ctx.textAlign = "left";
      yy += 44;
    });
    yy += 14;
    (p.biggest_wins || []).forEach(function (bw) {
      var who = bw.who === "p1" ? p.p1.name : p.p2.name;
      ctx.fillStyle = C.text; ctx.font = f(600, 26);
      var nw = ctx.measureText(who).width;
      ctx.fillText(who, x, yy);
      ctx.fillStyle = C.text2; ctx.font = f(400, 26);
      var sw = ctx.measureText(" " + bw.stat + " ").width;
      ctx.fillText(" " + bw.stat + " ", x + nw, yy);
      ctx.fillStyle = C.accent; ctx.font = f(500, 26, MONO);
      ctx.fillText(bw.val, x + nw + sw, yy);
      yy += 40;
    });
    return yy;
  }

  function bodyStatement(ctx, kicker, headline, detail, x, y, w, color) {
    var yy = y;
    if (kicker) {
      ctx.fillStyle = color || C.text2; ctx.font = f(600, 24, MONO);
      ctx.fillText(String(kicker).toUpperCase(), x, yy);
      yy += 44;
    }
    ctx.fillStyle = C.text; ctx.font = f(700, 48);
    yy = drawLines(ctx, wrap(ctx, headline, w), x, yy, 60, 5) + 18;
    if (detail) {
      ctx.fillStyle = C.text2; ctx.font = f(400, 30);
      yy = drawLines(ctx, wrap(ctx, detail, w), x, yy, 42, 6);
    }
    return yy;
  }

  function bodySalary(ctx, p, imgs, x, y, w) {
    circleImage(ctx, imgs[0], x + 70, y + 70, 70);
    ctx.fillStyle = C.text; ctx.font = f(700, 42);
    ctx.fillText(fit(ctx, p.player, w - 180), x + 165, y + 34);
    ctx.fillStyle = C.text2; ctx.font = f(500, 27, MONO);
    ctx.fillText(p.team + "  ·  " + p.season, x + 165, y + 88);

    var yy = y + 190;
    ctx.fillStyle = C.text2; ctx.font = f(500, 32);
    ctx.fillText("made", x, yy);
    ctx.fillStyle = C.teal; ctx.font = f(700, 60, MONO);
    ctx.fillText(p.salary, x + 110, yy - 12);
    yy += 76;
    ctx.fillStyle = C.text; ctx.font = f(700, 40);
    var line = p.bargain ? "just " + p.cap_pct + "% of that season's cap"
                         : p.cap_pct + "% of the entire salary cap";
    yy = drawLines(ctx, wrap(ctx, line, w), x, yy, 50, 2) + 16;
    if (p.note) {
      ctx.fillStyle = C.text2; ctx.font = f(400, 30);
      yy = drawLines(ctx, wrap(ctx, p.note, w), x, yy, 42, 3);
    }
    return yy;
  }

  function bodyOtd(ctx, p, imgs, x, y, w) {
    ctx.fillStyle = C.teal; ctx.font = f(600, 24, MONO);
    ctx.fillText((p.year + " · " + p.label).toUpperCase(), x, y);
    var yy = y + 80;
    var cx1 = x + w * 0.28, cx2 = x + w * 0.72;
    if (imgs[0]) ctx.drawImage(imgs[0], cx1 - 48, yy, 96, 96);
    if (imgs[1]) ctx.drawImage(imgs[1], cx2 - 48, yy, 96, 96);
    ctx.textAlign = "center";
    ctx.fillStyle = C.text2; ctx.font = f(600, 28, MONO);
    ctx.fillText(p.away, cx1, yy + 108);
    ctx.fillText(p.home, cx2, yy + 108);
    var homeWin = p.home_score > p.away_score;
    ctx.font = f(700, 80, MONO);
    ctx.fillStyle = homeWin ? C.text2 : C.text;
    ctx.fillText(String(p.away_score), cx1, yy + 150);
    ctx.fillStyle = homeWin ? C.text : C.text2;
    ctx.fillText(String(p.home_score), cx2, yy + 150);
    ctx.fillStyle = C.text2; ctx.font = f(500, 30, MONO);
    ctx.fillText("@", x + w / 2, yy + 168);
    ctx.textAlign = "left";
    yy += 280;
    ctx.fillStyle = C.text; ctx.font = f(600, 36);
    yy = drawLines(ctx, wrap(ctx, p.story, w), x, yy, 48, 3);
    return yy;
  }

  function bodyQuiz(ctx, p, imgs, x, y, w) {
    var yy = bodyStatement(ctx, "Guess the player · " + p.difficulty, "Who is this?", "", x, y, w, C.purple);
    var cx = x + w / 2, r = 150;
    // silhouette: the headshot painted solid black, same as the feed card
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, yy + r + 20, r, 0, Math.PI * 2); ctx.closePath();
    ctx.fillStyle = "#f0f0f2"; ctx.fill();
    if (imgs[0]) {
      ctx.clip();
      var sc = Math.max(2 * r / imgs[0].width, 2 * r / imgs[0].height);
      var iw = imgs[0].width * sc, ih = imgs[0].height * sc;
      ctx.filter = "brightness(0)";
      ctx.drawImage(imgs[0], cx - iw / 2, yy + r + 20 - ih / 2, iw, ih);
      ctx.filter = "none";
    }
    ctx.restore();
    yy += r * 2 + 56;
    if (p.hint) {
      ctx.textAlign = "center";
      ctx.fillStyle = C.text2; ctx.font = f(400, 30);
      ctx.fillText(p.hint, cx, yy);
      ctx.textAlign = "left";
      yy += 44;
    }
    return yy;
  }

  function bodyTrivia(ctx, p, imgs, x, y, w) {
    ctx.fillStyle = C.text; ctx.font = f(700, 46);
    var yy = drawLines(ctx, wrap(ctx, p.question, w), x, y, 58, 3) + 40;
    var cx1 = x + w * 0.25, cx2 = x + w * 0.75;
    circleImage(ctx, imgs[0], cx1, yy + 80, 76);
    circleImage(ctx, imgs[1], cx2, yy + 80, 76);
    ctx.textAlign = "center";
    ctx.fillStyle = C.text; ctx.font = f(600, 30);
    ctx.fillText(fit(ctx, p.a.name, w * 0.44), cx1, yy + 180);
    ctx.fillText(fit(ctx, p.b.name, w * 0.44), cx2, yy + 180);
    ctx.fillStyle = C.text2; ctx.font = f(500, 26, MONO);
    ctx.fillText("or", x + w / 2, yy + 74);
    ctx.textAlign = "left";
    return yy + 230;
  }

  function bodyTrade(ctx, p, imgs, x, y, w) {
    var yy = y;
    ctx.fillStyle = C.text2; ctx.font = f(600, 24, MONO);
    ctx.fillText("BUILT IN THE TRADE MACHINE", x, yy);
    yy += 56;
    var half = (w - 40) / 2, k = 0;
    (p.sides || []).forEach(function (s, si) {
      var sx = x + si * (half + 40);
      ctx.fillStyle = C.text; ctx.font = f(700, 32);
      ctx.fillText(s.team + " get", sx, yy);
      var py = yy + 54;
      (s.gets || []).forEach(function (pl) {
        circleImage(ctx, imgs[k++], sx + 34, py + 32, 34);
        ctx.fillStyle = C.text; ctx.font = f(600, 27);
        ctx.fillText(fit(ctx, pl.name, half - 86), sx + 82, py + 12);
        ctx.fillStyle = C.text2; ctx.font = f(400, 24, MONO);
        ctx.fillText("$" + pl.salary + "M", sx + 82, py + 46);
        py += 90;
      });
    });
    yy += 300;
    ctx.fillStyle = p.balance_pct >= 95 ? C.green : p.balance_pct >= 85 ? C.orange : C.red;
    ctx.font = f(700, 36, MONO);
    ctx.fillText(p.balance_pct + "% balanced", x, yy);
    ctx.fillStyle = C.text2; ctx.font = f(400, 32);
    yy = drawLines(ctx, wrap(ctx, p.verdict, w), x, yy + 52, 42, 2);
    return yy;
  }

  function fit(ctx, text, maxW) {
    var t = String(text);
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }

  /* ---------------- main ---------------- */

  function imagesFor(card) {
    var p = card.payload || {};
    switch (card.type) {
      case "vs": return [p.p1.img, p.p2.img];
      case "trivia": return [p.a.img, p.b.img];
      case "salary": return [p.img];
      case "quiz": return [p.img];
      case "otd": return [p.away_logo, p.home_logo];
      case "trade": return (p.sides || []).reduce(function (acc, s) {
        return acc.concat((s.gets || []).map(function (g) { return g.img; }));
      }, []);
      default: return [];
    }
  }

  function render(card) {
    var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    return ready.then(function () {
      return Promise.all(imagesFor(card).map(loadImage));
    }).then(function (imgs) {
      // Pass 1 measures: the body renderers return the y they finished at, so
      // the real canvas can be sized to its content rather than leaving a card
      // half-empty on the short types.
      var measure = document.createElement("canvas");
      measure.width = W; measure.height = 4000;
      var mctx = measure.getContext("2d");
      mctx.textBaseline = "top";
      var contentEnd = paint(mctx, card, imgs, 4000, true);
      var cardH = Math.max(560, contentEnd - CARD_TOP + 56);
      var height = CARD_TOP + cardH + 190;

      var cv = document.createElement("canvas");
      cv.width = W; cv.height = height;
      var ctx = cv.getContext("2d");
      ctx.textBaseline = "top";
      paint(ctx, card, imgs, height, false);

      return new Promise(function (resolve, reject) {
        try {
          cv.toBlob(function (blob) {
            blob ? resolve(blob) : reject(new Error("could not encode the image"));
          }, "image/png");
        } catch (e) {
          // tainted canvas: only possible once images are served cross-origin
          reject(new Error("image blocked by the browser (cross-origin images)"));
        }
      });
    });
  }

  function paint(ctx, card, imgs, height, measuring) {
      var cardBottom = height - 190;
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, height);

      var meta = TYPE[card.type] || { label: card.type.toUpperCase(), color: C.text2 };

      // card
      if (!measuring) {
        ctx.fillStyle = C.surface;
        roundRect(ctx, PAD, CARD_TOP, W - PAD * 2, cardBottom - CARD_TOP, 28);
        ctx.fill();
        ctx.strokeStyle = C.border; ctx.lineWidth = 2; ctx.stroke();
      }

      // type chip
      ctx.font = f(600, 24, MONO);
      var label = meta.label;
      var cw = ctx.measureText(label).width + 56;
      ctx.fillStyle = meta.color + "1a";
      roundRect(ctx, PAD + 44, CARD_TOP + 44, cw, 44, 8);
      ctx.fill();
      ctx.fillStyle = meta.color;
      ctx.beginPath(); ctx.arc(PAD + 44 + 20, CARD_TOP + 66, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillText(label, PAD + 44 + 38, CARD_TOP + 55);

      var x = PAD + 44, y = CARD_TOP + 128, w = W - PAD * 2 - 88;
      var p = card.payload || {};
      var endY = y;

      switch (card.type) {
        case "vs": endY = bodyVs(ctx, p, imgs, x, y, w); break;
        case "trivia": endY = bodyTrivia(ctx, p, imgs, x, y, w); break;
        case "salary": endY = bodySalary(ctx, p, imgs, x, y, w); break;
        case "otd": endY = bodyOtd(ctx, p, imgs, x, y, w); break;
        case "trade": endY = bodyTrade(ctx, p, imgs, x, y, w); break;
        case "quiz": endY = bodyQuiz(ctx, p, imgs, x, y, w); break;
        case "rumor":
          endY = bodyStatement(ctx, p.on_this_day ? p.years_ago + " years ago today" : "From the archive",
            p.text, p.quote ? "“" + p.quote + "”" : p.outlet, x, y, w, C.orange);
          break;
        case "oddity":
          endY = bodyStatement(ctx, p.season + " · " + p.award, p.headline, p.detail, x, y, w, C.teal);
          break;
        case "ballot":
          endY = bodyStatement(ctx, p.season + " · ballot trivia", p.question, p.detail || "", x, y, w, C.purple);
          break;
        case "race":
          endY = bodyStatement(ctx, "Bar chart race", p.title,
            p.subtitle + (p.span ? " · " + p.span : ""), x, y, w, C.teal);
          break;
        default:
          endY = bodyStatement(ctx, meta.label, p.headline || p.title || p.question || "",
            p.detail || "", x, y, w, meta.color);
      }
      // Pass 1 only needs to know where the content ended.
      if (measuring) return endY;

      // footer branding
      ctx.textAlign = "left";
      ctx.fillStyle = C.text; ctx.font = f(700, 36);
      ctx.fillText("Hoops", PAD, height - 130);
      var hw = ctx.measureText("Hoops").width;
      ctx.fillStyle = C.accent;
      ctx.fillText("Matic", PAD + hw, height - 130);
      ctx.fillStyle = C.text2; ctx.font = f(500, 24, MONO);
      ctx.fillText("NBA DOOMSCROLL", PAD, height - 84);
      ctx.textAlign = "right";
      ctx.fillText("hoopsmatic.com", W - PAD, height - 84);
      ctx.textAlign = "left";
      return endY;
  }

  function filename(card) {
    return "hoopsmatic-doomscroll-" + String(card.id).replace(/[^\w-]/g, "") + ".png";
  }

  root.ShareImage = { render: render, filename: filename };
})(window);
