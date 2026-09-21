/* The Career Map card's markup, against what answers it.
 *
 *     node tools/test_careermap_markup.mjs
 *
 * WHY A TEST FOR FOUR CLASS NAMES
 *
 * This card deliberately has no answering code of its own. It borrows the
 * ballot mechanic: the same .quiz-opts wrapper, the same data-answer-idx, the
 * same data-action="ballot" on each button, so answerQuiz() in js/app.js marks
 * it, shows the result line and logs the engagement without a line of new
 * interaction code.
 *
 * Borrowing means the contract is written in two files and enforced in
 * neither. A renamed class or a dropped attribute would render a card that
 * looks completely right and cannot be answered: four buttons, no reaction,
 * nothing in the console. Nobody would see it in a build log.
 *
 * So this renders the real card through js/cards.js and asserts the handful of
 * hooks app.js reaches for, by reading them out of app.js rather than by
 * restating them here - a copy of the contract in a third file would be one
 * more thing to drift.
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

/* cards.js is an IIFE over `window` and needs nothing else to define its
 * renderers. */
const win = {};
new Function("window", "document", fs.readFileSync(path.join(REPO, "js", "cards.js"), "utf8"))(
  win, { createElement: () => ({}) });
const C = win.DoomCards;
const appSrc = fs.readFileSync(path.join(REPO, "js", "app.js"), "utf8");

const card = {
  id: "careermap-test-man", type: "careermap", tab: ["quiz"],
  tags: { content_type: "careermap", players: ["Test Man"], teams: [], era: "2010s", category: "game" },
  payload: {
    question: "Which of these NBA teams did Test Man never play for?",
    options: [
      { key: "celtics", name: "Boston Celtics", logo: "https://example.invalid/1.svg" },
      { key: "lakers", name: "Los Angeles Lakers", logo: "https://example.invalid/2.svg" },
      { key: "bulls", name: "Chicago Bulls", logo: "https://example.invalid/3.svg" },
      { key: "heat", name: "Miami Heat", logo: "https://example.invalid/4.svg" }
    ],
    answer_idx: 2,
    detail: "Test Man played for 3 franchises between 2004-05 and 2015-16, 840 games in all.",
    url: "https://hoopsmatic.com/nba-career-map/",
    cta: "See every team he played for"
  }
};

const html = C.render ? String(C.render(card)) : "";

console.log("\nit renders at all");

ck("the renderer is reached", !!html && html.length > 100, String(html.length) + " chars");
ck("the question is on it", html.indexOf(card.payload.question) >= 0);
ck("all four teams are named", card.payload.options.every(o => html.indexOf(o.name) >= 0));
ck("all four badges are sourced", card.payload.options.every(o => html.indexOf(o.logo) >= 0));

console.log("\nthe hooks app.js reaches for");

/* Each of these is read straight out of answerQuiz() and its dispatch, so a
 * rename on either side fails here rather than in a reader's hands. */
ck("app.js still routes data-action=\"ballot\" to the answer handler",
   /action === "quiz" \|\| action === "ballot"/.test(appSrc));
ck("and the card's buttons carry it",
   (html.match(/data-action="ballot"/g) || []).length === 4,
   String((html.match(/data-action="ballot"/g) || []).length) + " buttons");

ck("app.js reads the answer from .quiz-opts[data-answer-idx]",
   /querySelector\(["']\.quiz-opts["']\)/.test(appSrc) && /dataset\.answerIdx/.test(appSrc));
ck("and the card puts it there",
   /class="quiz-opts" data-answer-idx="2"/.test(html),
   (html.match(/data-answer-idx="[^"]*"/) || ["(absent)"])[0]);

ck("app.js indexes the winning button by that number",
   /wrap\.children\[Number\(wrap\.dataset\.answerIdx\)\]/.test(appSrc));
ck("so the buttons must be the wrapper's own children, in order",
   /data-pick="0"[\s\S]*data-pick="1"[\s\S]*data-pick="2"[\s\S]*data-pick="3"/.test(html));

ck("app.js writes the outcome into .quiz-result",
   /querySelector\(["']\.quiz-result["']\)/.test(appSrc));
ck("and the card provides one, hidden", /<div class="quiz-result" hidden><\/div>/.test(html));

ck("app.js shows payload.detail there", /card\.payload\.detail/.test(appSrc));
ck("and this card has a detail to show", !!card.payload.detail);

console.log("\nthe classes the stylesheet styles");

const css = fs.readFileSync(path.join(REPO, "css", "styles.css"), "utf8");
for (const cls of ["cm-opt", "cm-logo", "cm-team"]) {
  const inHtml = html.indexOf(cls) >= 0;
  const inCss = css.indexOf("." + cls) >= 0;
  ck(`.${cls} is both rendered and styled`, inHtml && inCss,
     inHtml ? (inCss ? "" : "not in the stylesheet") : "not rendered");
}
/* The badge frame turns green or red through .quiz-opt, which the card must
 * therefore keep alongside its own class. */
ck("the buttons keep .quiz-opt, which carries the correct and wrong states",
   (html.match(/class="quiz-opt cm-opt"/g) || []).length === 4);
ck("and the stylesheet still colours those states",
   /\.quiz-opt\.correct/.test(css) && /\.quiz-opt\.wrong/.test(css));

console.log("\nescaping");

{
  const nasty = JSON.parse(JSON.stringify(card));
  nasty.payload.question = 'Which "team" did <script>alert(1)</script> never play for?';
  nasty.payload.options[0].name = '<img src=x onerror=alert(1)>';
  nasty.payload.options[0].logo = '"><script>alert(1)</script>';
  const h = String(C.render(nasty));
  ck("no raw script tag survives", h.indexOf("<script>") < 0);
  /* NOT "contains no onerror". cards.js puts its own on every badge -
   * onerror="this.style.visibility='hidden'", the fallback for a logo that
   * 404s - so a test banning the substring would fail on correct code and
   * teach whoever hit it to stop trusting this file. What must not appear is
   * the ATTACKER'S handler. */
  /* The quote is what separates the two. A live attribute is onerror="...";
   * the escaped payload reads onerror=alert(1) inside a span's text, with no
   * quote, because esc() turned its angle brackets into entities. Counting
   * `onerror="` therefore counts only handlers the browser will run, and all
   * four of those are the badge's own. */
  ck("every onerror that is really an attribute is the badge's own",
     (h.match(/onerror="/g) || []).length === 4 &&
     (h.match(/onerror="this\.style\.visibility='hidden'"/g) || []).length === 4,
     String((h.match(/onerror="/g) || []).length) + " live, " +
     String((h.match(/onerror=/g) || []).length) + " counting escaped text");
  ck("the payload came through escaped instead",
     h.indexOf("&lt;img src=x onerror=alert(1)&gt;") >= 0);
  ck("and the button attributes are not broken out of",
     (h.match(/data-action="ballot"/g) || []).length === 4);
}

console.log(fail ? `\n${fail} failed` : "\n0 failed");
console.log(fail ? "the card would render and never answer"
                 : "it renders, and the handler it borrows can still find it");
process.exit(fail ? 1 : 0);
