/* §10: the Guess the Player difficulty mix, and the veil on the easier tiers.
 *
 *     node tools/test_quiz_difficulty.mjs
 *
 * TWO THINGS THAT COULD EACH FAIL SILENTLY
 *
 * The mix is a rotation in js/schedule.js, not a weighting. A rotation that
 * quietly stops rotating still serves quiz cards, just all of one tier - which
 * is exactly the state this change was undoing, and it looks fine from the
 * outside. So the tier shares are measured over enough cards to be an
 * arithmetic fact rather than a sample.
 *
 * The veil is CSS over the same 96x96 tile, reversed when the card is answered.
 * Two ways it breaks without erroring: the veil rules land AFTER the .revealed
 * rules in the stylesheet, in which case answering never unveils - both
 * selectors have identical specificity, so source order is the whole mechanism
 * - or the hard tier picks up a veil, which would put the blur back on the
 * cards that are supposed to be shown clear and whole. Both are checked.
 *
 * The renderer and the scheduler are loaded headless, so this exercises the
 * files the browser runs.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(__dirname, "..");

let fail = 0;
const ck = (name, ok, d) => {
  console.log((ok ? "  ok   " : "  FAIL ") + name + (d ? "   " + d : ""));
  if (!ok) fail++;
};

/* ---- the shipped modules, headless ---- */
const win = {};
new Function("window", "document", fs.readFileSync(path.join(REPO, "js", "cards.js"), "utf8"))(
  win, { createElement: () => ({}) });
for (const f of ["editorial.js", "schedule.js"]) {
  new Function("window", fs.readFileSync(path.join(REPO, "js", f), "utf8"))(win);
}
const C = win.DoomCards;
const S = win.DoomSchedule;
const ED = win.DoomEditorial;
const css = fs.readFileSync(path.join(REPO, "css", "styles.css"), "utf8");
const appSrc = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");

console.log("\nall three tiers are admitted again");

{
  /* js/app.js refuses any tier absent from QUIZ_QUALITY at addCards, so a tier
   * missing here never reaches the feed however the scheduler rotates. */
  const m = appSrc.match(/var QUIZ_QUALITY = \{([^}]*)\}/);
  const tiers = m ? m[1].split(",").map(x => x.split(":")[0].trim()).filter(Boolean) : [];
  ck("QUIZ_QUALITY admits hard, medium and easy",
     ["hard", "medium", "easy"].every(t => tiers.indexOf(t) >= 0),
     tiers.join(", "));
  /* Equal weights on purpose: quality_score maps to a 0.7x-1.3x band, and a
   * weight pulling against the rotation would blunt it without being able to
   * replace it. */
  const vals = m ? m[1].split(",").map(x => parseFloat(x.split(":")[1])) : [];
  ck("and weights them equally, so they do not fight the rotation",
     vals.length > 0 && vals.every(v => v === vals[0]), vals.join(", "));
}

console.log("\nthe pool still has all three tiers to draw from");

const pool = JSON.parse(fs.readFileSync(path.join(REPO, "data", "quiz-pool.json"), "utf8"));
{
  const t = {};
  for (const c of (pool.cards || [])) t[c.payload.difficulty] = (t[c.payload.difficulty] || 0) + 1;
  ck("hard, medium and easy all exist on disk",
     t.hard > 0 && t.medium > 0 && t.easy > 0,
     Object.entries(t).map(([k, v]) => `${k} ${v}`).join(", "));
  ck("and every card has a photograph to veil",
     (pool.cards || []).every(c => c.payload.img),
     (pool.cards || []).filter(c => !c.payload.img).length + " without");
}

console.log("\nthe rotation is declared, and adds up");

{
  const q = S.QUOTAS.guess_the_player;
  ck("Guess the Player carries a tier cycle", Array.isArray(q.cycle), JSON.stringify(q.cycle));
  ck("and a way to read a card's tier", typeof q.cycleOf === "function");

  const n = {};
  for (const t of q.cycle) n[t] = (n[t] || 0) + 1;
  const pct = t => 100 * (n[t] || 0) / q.cycle.length;
  ck("hard is 60-65% of the cycle", pct("hard") >= 60 && pct("hard") <= 65,
     pct("hard").toFixed(0) + "%");
  ck("medium is 25-30%", pct("medium") >= 25 && pct("medium") <= 30,
     pct("medium").toFixed(0) + "%");
  ck("easy is 10%", pct("easy") === 10, pct("easy").toFixed(0) + "%");

  /* An easy card opening a session, or two easy cards in a row, would undo the
   * point of veiling them: the first quiz card a reader meets should be one
   * worth thinking about. */
  ck("the cycle does not open on an easy card", q.cycle[0] !== "easy", q.cycle[0]);
  let adjacentEasy = 0;
  for (let i = 0; i < q.cycle.length; i++) {
    if (q.cycle[i] === "easy" && q.cycle[(i + 1) % q.cycle.length] === "easy") adjacentEasy++;
  }
  ck("and never puts two easy cards together", adjacentEasy === 0);
  ck("cycleOf reads payload.difficulty",
     q.cycleOf({ payload: { difficulty: "medium" } }) === "medium" &&
     q.cycleOf({}) === null);
}

console.log("\nthe rotation holds the mix in a real run");

{
  /* Quiz cards only, so every admitted slot is a tier decision and the shares
   * are not diluted by whatever else the plan drew. */
  const quiz = (pool.cards || []).map(c => ({
    id: c.id, type: "quiz",
    tags: { content_type: "quiz", category: "guess-the-player", players: [c.payload.answer] },
    payload: { difficulty: c.payload.difficulty }
  }));
  const filler = [];
  for (let i = 0; i < 4000; i++) {
    filler.push({ id: "otd-" + i, type: "otd",
      tags: { content_type: "otd", category: "on-this-day", players: ["P" + i] }, payload: {} });
  }
  const all = quiz.concat(filler);

  const used = {};
  const feed = [];
  const since = S.newCounters();
  let seed = 11;
  const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let guard = 0;
  while (feed.length < 2400 && guard++ < 400) {
    const avail = all.filter(c => !used[c.id]);
    if (!avail.length) break;
    const r = S.build({
      pool: avail, size: 8, position: feed.length,
      tail: feed.slice(Math.max(0, feed.length - 12)), since,
      sample: (list, n) => list.slice(0, n), rng
    });
    if (!r.cards.length) break;
    for (const c of r.cards) {
      if (feed.length >= 2400) break;
      used[c.id] = 1; feed.push(c); S.countCard(since, c);
    }
  }

  const served = feed.filter(c => ED.hasTrait(c, "guess_the_player"));
  ck("enough quiz cards were served to measure", served.length >= 60,
     served.length + " in " + feed.length + " cards");

  const n = {};
  for (const c of served) n[c.payload.difficulty] = (n[c.payload.difficulty] || 0) + 1;
  const pct = t => 100 * (n[t] || 0) / served.length;
  const shown = ["hard", "medium", "easy"]
    .map(t => `${t} ${pct(t).toFixed(0)}%`).join(", ");

  /* THE ASSERTION THIS FILE EXISTS FOR. Bands rather than exact values, because
   * the rotation is a hint and an exhausted tier falls back - but wide enough
   * that a rotation which has stopped rotating cannot pass. */
  ck("hard lands in its band", pct("hard") >= 55 && pct("hard") <= 70, shown);
  ck("medium lands in its band", pct("medium") >= 22 && pct("medium") <= 35, shown);
  ck("easy stays around a tenth", pct("easy") >= 5 && pct("easy") <= 15, shown);

  /* And the gap rule still holds with a rotation layered on top of it. */
  const at = [];
  served.forEach(c => at.push(feed.indexOf(c)));
  let closest = Infinity;
  for (let i = 1; i < at.length; i++) closest = Math.min(closest, at[i] - at[i - 1]);
  ck("the spacing rule survives the rotation",
     closest >= S.QUOTAS.guess_the_player.gap,
     "closest pair " + closest + ", gap " + S.QUOTAS.guess_the_player.gap);
}

console.log("\nthe veil is on the two easier tiers and nowhere else");

const quizCard = (difficulty) => ({
  id: "quiz-" + difficulty, type: "quiz",
  tags: { content_type: "quiz", category: "guess-the-player" },
  payload: {
    difficulty, answer: "Somebody Real", img: "data/faces/somebody.png",
    options: ["Somebody Real", "Another Name", "Third Name", "Fourth Name"],
    hints: ["played in the 1970s"], detail: "the detail"
  }
});

{
  const easy = C.render(quizCard("easy"));
  const medium = C.render(quizCard("medium"));
  const hard = C.render(quizCard("hard"));

  ck("an easy card veils its picture", /data-veil="easy"/.test(easy));
  ck("a medium card veils its picture", /data-veil="medium"/.test(medium));
  /* THE ONE THAT MATTERS MOST. The hard tier is the 625 players who never made
   * an All-Star team, and the whole argument for that tier is that the
   * photograph is shown clear: blurring it turns a basketball question into a
   * question about a blur. */
  ck("a hard card does NOT", !/data-veil/.test(hard),
     "the hard tier is shown clear and whole, on purpose");

  /* The veil must not leak into anything else the card shows. */
  ck("the answer is still not in the pre-answer markup",
     easy.indexOf("quiz-result") >= 0 && !/Somebody Real<\/span>/.test(easy));
  ck("all four options are still rendered",
     (easy.match(/class="quiz-opt"/g) || []).length === 4);
  ck("and the tier label is still shown", /quiz-diff mono easy/.test(easy));
}

console.log("\nanswering unveils, and source order is what makes that work");

{
  /* revealFace() adds .revealed to the mask, and the mask's .revealed rule has
   * the same specificity as the veil rule - so the ONLY reason answering wins
   * is that it comes later in the file. An edit that moved the veil rules down
   * would leave every easy card blurred forever, with nothing erroring. */
  const veil = css.search(/\.quiz-sil-mask\[data-veil\] \.quiz-sil\{/);
  const revealed = css.search(/\.quiz-sil-mask\.revealed \.quiz-sil,/);
  ck("both rule sets exist", veil >= 0 && revealed >= 0,
     `veil at ${veil}, revealed at ${revealed}`);
  ck("and the veil comes FIRST, so .revealed overrides it", veil < revealed,
     veil < revealed ? "" : "answering would no longer unveil the picture");

  ck("the veil actually obscures", /\.quiz-sil-mask\[data-veil\] \.quiz-sil\{[^}]*blur\(/.test(css));
  ck("and crops in, so the hairline and shoulders go too",
     /\.quiz-sil-mask\[data-veil\] \.quiz-sil\{[^}]*transform:scale\(/.test(css));
  ck("easy is veiled harder than medium", (() => {
    const b = (sel) => {
      const m = css.match(new RegExp(sel.replace(/[.[\]"=]/g, "\\$&") + "\\s*\\{[^}]*blur\\(([0-9.]+)px"));
      return m ? parseFloat(m[1]) : null;
    };
    const base = b('.quiz-sil-mask[data-veil] .quiz-sil');
    const ez = b('.quiz-sil-mask[data-veil="easy"] .quiz-sil');
    return base != null && ez != null && ez > base;
  })(), "an easy card is a household face");

  ck("revealFace still adds .revealed to the mask",
     /mask\.classList\.add\("revealed"\)/.test(appSrc));
  ck("and answering a quiz card calls it",
     /revealFace\(cardEl\);/.test(appSrc));

  /* A player with no photograph renders as initials, which must never be
   * blurred: "MP" gives nothing away and a blurred pair of letters looks like
   * a rendering fault. */
  ck("initials are never blurred",
     /\.quiz-sil-mask \.mt-ini\{[^}]*filter:none/.test(css));
  /* Reduced motion drops the transition, not the veil. */
  ck("reduced motion keeps the veil and drops the animation",
     /prefers-reduced-motion[\s\S]{0,200}data-veil\][^}]*transition:none/.test(css));
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the quiz mix or the veil is not what it claims"
                 : "six hard, three medium, one easy, and only the easy ones hidden");
process.exit(fail ? 1 : 0);
